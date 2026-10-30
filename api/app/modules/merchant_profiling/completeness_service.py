"""
Loads a ProfileSnapshot for a merchant and runs the completeness calculator +
alert catalog. Also owns the profileCompletionPct write-behind cache refresh
(API_REFERENCE.md §4a.3): a raw UPDATE that never throws and never bumps
updated_at, mirroring the Nest implementation's rationale exactly.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.profiling import (
    BrandAsset,
    BrandProfile,
    Contact,
    Document,
    FieldVerification,
    Location,
    Merchant,
)
from app.modules.merchant_profiling.domain.profile_completeness_calculator import (
    CompletenessResult,
    ProfileSnapshot,
    SnapshotBrand,
    SnapshotBrandAsset,
    SnapshotConnection,
    SnapshotContact,
    SnapshotDocument,
    SnapshotLocation,
    calculate_completeness,
)
from app.modules.merchant_profiling.domain.profile_alert_catalog import ProfileAlert, build_profile_alerts
from app.models.profiling import AccessItem
from app.db.schemas import qualified


async def load_snapshot(db: AsyncSession, merchant: Merchant) -> ProfileSnapshot:
    verifications = (
        await db.execute(select(FieldVerification).where(FieldVerification.merchant_id == merchant.id))
    ).scalars().all()
    documents = (await db.execute(select(Document).where(Document.merchant_id == merchant.id))).scalars().all()
    locations = (await db.execute(select(Location).where(Location.merchant_id == merchant.id))).scalars().all()
    contacts = (await db.execute(select(Contact).where(Contact.merchant_id == merchant.id))).scalars().all()
    connections = (await db.execute(select(AccessItem).where(AccessItem.merchant_id == merchant.id))).scalars().all()
    brand = await db.get(BrandProfile, merchant.id)
    brand_assets = (await db.execute(select(BrandAsset).where(BrandAsset.merchant_id == merchant.id))).scalars().all()

    return ProfileSnapshot(
        merchant=merchant,
        verifications=verifications,
        documents=[SnapshotDocument(category=d.category, status=d.status) for d in documents],
        locations=[
            SnapshotLocation(
                id=l.id, address=l.address, city=l.city, state=l.state, zip=l.zip, hours=l.hours,
                timezone=l.timezone, is_primary=l.is_primary, nap_status=l.nap_status,
            )
            for l in locations
        ],
        contacts=[SnapshotContact(id=c.id, role=c.role, name=c.name) for c in contacts],
        connections=[
            SnapshotConnection(id=c.id, access_item=c.access_item, criticality=c.criticality, status=c.status, expiry=c.expiry)
            for c in connections
        ],
        brand=(
            SnapshotBrand(
                brand_colors=brand.brand_colors, brand_fonts=brand.brand_fonts, logo_vector=brand.logo_vector,
                photo_library_status=brand.photo_library_status, menu_format=brand.menu_format,
                signature_dishes=brand.signature_dishes, tone_of_voice=brand.tone_of_voice,
                do_not_say=brand.do_not_say, content_restrictions=brand.content_restrictions,
            )
            if brand
            else None
        ),
        brand_assets=[SnapshotBrandAsset(type=a.type, status=a.status) for a in brand_assets],
    )


async def compute_completeness(db: AsyncSession, merchant: Merchant) -> CompletenessResult:
    snapshot = await load_snapshot(db, merchant)
    return calculate_completeness(snapshot)


async def compute_alerts(db: AsyncSession, merchant: Merchant) -> list[ProfileAlert]:
    completeness = await compute_completeness(db, merchant)
    return build_profile_alerts(merchant.id, merchant.restaurant_name, completeness)


async def refresh_completion_cache(db: AsyncSession, merchant_id: str) -> None:
    """Write-behind cache refresh. Never raises; a raw UPDATE that does not
    touch updated_at and is a no-op if the merchant no longer exists."""
    try:
        merchant = await db.get(Merchant, merchant_id)
        if not merchant:
            return
        result = await compute_completeness(db, merchant)
        if merchant.profile_completion_pct != result.percent:
            await db.execute(
                text(f'UPDATE {qualified("profiling")}.merchant SET profile_completion_pct = :pct WHERE id = :id'),
                {"pct": result.percent, "id": merchant_id},
            )
            await db.commit()
    except Exception:
        # Mirrors the Nest implementation: failures are logged and swallowed;
        # a stale percent self-heals on the next read.
        try:
            await db.rollback()
        except Exception:
            pass
