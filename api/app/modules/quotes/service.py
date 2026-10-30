"""Quote builder: database work shared by the staff and public routers."""
from __future__ import annotations

import datetime as dt
import hashlib
import secrets
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import quotes as m
from app.modules.quotes import pricing, signing
from app.modules.quotes.price_sheet import FIRST_STATION_SKU, GOLD_INCLUDED, LEASE_MONTHS, SECTIONS, TERMS
from app.schemas import quotes as dto

SECTION_ORDER = {s["key"]: i for i, s in enumerate(SECTIONS)}
_NUMBER_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# ── tokens ────────────────────────────────────────────────────────────────
def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def new_token() -> tuple[str, str]:
    token = secrets.token_urlsafe(24)
    return token, hash_token(token)


def link_url(token: str) -> str:
    return f"{get_settings().APP_WEB_URL.rstrip('/')}/q/{token}"


def new_request_number() -> str:
    stamp = now().strftime("%y%m%d")
    tail = "".join(secrets.choice(_NUMBER_ALPHABET) for _ in range(4))
    return f"Q{stamp}-{tail}"


# ── price list ────────────────────────────────────────────────────────────
def item_sort_key(row: m.PriceItem):
    return (SECTION_ORDER.get(row.section, 99), row.sort_order, row.name)


async def list_price_items(db: AsyncSession, *, active_only: bool = False) -> list[m.PriceItem]:
    stmt = select(m.PriceItem)
    if active_only:
        stmt = stmt.where(m.PriceItem.active.is_(True))
    rows = list((await db.execute(stmt)).scalars())
    return sorted(rows, key=item_sort_key)


def price_item_dto(row: m.PriceItem) -> dto.PriceItemDto:
    return dto.PriceItemDto(
        id=row.id, sku=row.sku, name=row.name, description=row.description, note=row.note, section=row.section,
        kind=row.kind, unitLabel=row.unit_label, monthlyPrice=row.monthly_price, purchasePrice=row.purchase_price,
        leasePrice=row.lease_price, isStation=row.is_station, bundledInSku=row.bundled_in_sku,
        selectable=row.selectable, maxQty=row.max_qty,
        sortOrder=row.sort_order, active=row.active, updatedAt=row.updated_at,
    )


# ── links ─────────────────────────────────────────────────────────────────
def is_expired(link: m.QuoteLink, at: Optional[dt.datetime] = None) -> bool:
    return link.expires_at is not None and link.expires_at <= (at or now())


def is_usable(link: m.QuoteLink) -> bool:
    return link.status == "ACTIVE" and not is_expired(link)


def overrides_for(link: m.QuoteLink) -> dict[str, pricing.Override]:
    return {
        li.item_id: pricing.Override(
            percent_off=li.percent_off, monthly_price=li.monthly_price, purchase_price=li.purchase_price,
            lease_price=li.lease_price, hidden=li.hidden,
        )
        for li in link.items
    }


async def build_offer(db: AsyncSession, link: m.QuoteLink) -> tuple[dict[str, pricing.OfferItem], Optional[pricing.OfferItem]]:
    """What this link offers, priced for this client. Returns (selectable items by id, first-station rule)."""
    overrides = overrides_for(link)
    offer: dict[str, pricing.OfferItem] = {}
    first_station: Optional[pricing.OfferItem] = None
    for row in await list_price_items(db, active_only=True):
        o = overrides.get(row.id)
        item = pricing.resolve_item(row, o, link.discount_percent)
        if row.sku == FIRST_STATION_SKU:
            first_station = item
            continue
        if o is not None and o.hidden:
            continue
        if row.selectable:
            offer[row.id] = item
    return offer, first_station


def priced_dto(quote: pricing.Quote, bundled_out: Optional[list[str]] = None) -> dto.PricedDto:
    return dto.PricedDto(lines=[dto.LineDto(**line.as_dict()) for line in quote.lines],
                         totals=dto.TotalsDto(**quote.totals()), bundledOut=bundled_out or [])


def price_or_400(offer, selections: list[dto.SelectionDto], plan: str, first_station) -> pricing.Quote:
    return price_or_400_pairs(offer, [(s.itemId, s.qty) for s in selections], plan, first_station)


def price_or_400_pairs(offer, selections: list[tuple[str, int]], plan: str, first_station) -> pricing.Quote:
    try:
        return pricing.price_quote(offer, selections, plan, first_station)
    except pricing.PricingError as e:
        raise HTTPException(status_code=400, detail=str(e))


async def validate_link_items(db: AsyncSession, items: list[dto.LinkItemDto]) -> None:
    if not items:
        return
    ids = {i.itemId for i in items}
    if len(ids) != len(items):
        raise HTTPException(status_code=400, detail="each item can have only one special price")
    found = set((await db.execute(select(m.PriceItem.id).where(m.PriceItem.id.in_(ids)))).scalars())
    if found != ids:
        raise HTTPException(status_code=400, detail="unknown price-list item in special pricing")


def has_special_pricing(discount: Optional[Decimal], items: Optional[list[dto.LinkItemDto]]) -> bool:
    if discount:
        return True
    return any(
        i.percentOff or i.monthlyPrice is not None or i.purchasePrice is not None or i.leasePrice is not None
        for i in (items or [])
    )


def replace_link_items(link: m.QuoteLink, items: list[dto.LinkItemDto]) -> None:
    link.items.clear()
    for i in items:
        if not (i.hidden or i.percentOff or i.monthlyPrice is not None or i.purchasePrice is not None
                or i.leasePrice is not None):
            continue  # nothing special about this item
        link.items.append(m.QuoteLinkItem(
            item_id=i.itemId, percent_off=i.percentOff or None, monthly_price=i.monthlyPrice,
            purchase_price=i.purchasePrice, lease_price=i.leasePrice, hidden=i.hidden,
        ))


async def request_stats(db: AsyncSession, link_ids: list[str]) -> dict[str, tuple[int, Optional[m.QuoteRequest]]]:
    if not link_ids:
        return {}
    rows = list((await db.execute(
        select(m.QuoteRequest).where(m.QuoteRequest.link_id.in_(link_ids)).order_by(m.QuoteRequest.created_at.desc())
    )).scalars())
    out: dict[str, tuple[int, Optional[m.QuoteRequest]]] = {}
    for r in rows:
        count, latest = out.get(r.link_id, (0, None))
        out[r.link_id] = (count + 1, latest or r)
    return out


def request_brief(r: m.QuoteRequest) -> dto.RequestBriefDto:
    return dto.RequestBriefDto(
        id=r.id, number=r.number, status=r.status, createdAt=r.created_at, oneTimeTotal=r.one_time_total,
        monthlyTotal=pricing.money(r.monthly_software_total + r.monthly_lease_total),
    )


def link_dto(link: m.QuoteLink, stats: Optional[tuple[int, Optional[m.QuoteRequest]]] = None) -> dto.LinkDto:
    count, latest = stats or (0, None)
    return dto.LinkDto(
        id=link.id, mode=link.mode, status=link.status, restaurantName=link.restaurant_name,
        contactName=link.contact_name, contactEmail=link.contact_email, contactPhone=link.contact_phone,
        merchantId=link.merchant_id, dealId=link.deal_id, message=link.message, discountPercent=link.discount_percent,
        allowLease=link.allow_lease, expiresAt=link.expires_at, expired=is_expired(link),
        createdByEmail=link.created_by_email, createdAt=link.created_at, lastOpenedAt=link.last_opened_at,
        openCount=link.open_count, requestCount=count, latestRequest=request_brief(latest) if latest else None,
        items=[dto.LinkItemOutDto(itemId=i.item_id, percentOff=i.percent_off, monthlyPrice=i.monthly_price,
                                  purchasePrice=i.purchase_price, leasePrice=i.lease_price, hidden=i.hidden)
               for i in link.items],
    )


# ── requests, revisions, signatures, events ───────────────────────────────
def public_show(r: m.QuoteRequest) -> bool:
    """Does the restaurant see prices on this request?"""
    return r.mode == m.MODE_SHOW or bool(r.prices_revealed)


def add_revision(
    db: AsyncSession,
    r: m.QuoteRequest,
    *,
    author_kind: str,
    author_name: Optional[str],
    author_email: Optional[str],
    note: Optional[str],
    hardware_plan: str,
    selections: list[dict],
    quote: pricing.Quote,
) -> m.QuoteRevision:
    """Add the next revision and mirror it onto the request's own columns.

    The row is added to the session directly (not through ``r.revisions``):
    touching an unloaded relationship here would lazy-load outside the async
    context and raise MissingGreenlet.
    """
    rev_no = (r.current_revision_no or 0) + 1
    lines = [line.as_dict() for line in quote.lines]
    totals = quote.totals()
    rev = m.QuoteRevision(
        request_id=r.id, rev_no=rev_no, author_kind=author_kind, author_name=author_name,
        author_email=author_email, note=note, hardware_plan=hardware_plan, selections=selections, lines=lines,
        one_time_total=quote.one_time_total, monthly_software_total=quote.monthly_software_total,
        monthly_lease_total=quote.monthly_lease_total, list_one_time_total=quote.list_one_time_total,
        list_monthly_total=quote.list_monthly_total,
        content_hash=signing.content_hash(
            number=r.number, rev_no=rev_no, restaurant_name=r.restaurant_name, contact_email=r.contact_email,
            hardware_plan=hardware_plan, lines=lines, totals=totals, terms=TERMS,
        ),
    )
    db.add(rev)
    r.current_revision_no = rev_no
    r.hardware_plan = hardware_plan
    r.selections = selections
    r.lines = lines
    r.one_time_total = quote.one_time_total
    r.monthly_software_total = quote.monthly_software_total
    r.monthly_lease_total = quote.monthly_lease_total
    r.list_one_time_total = quote.list_one_time_total
    r.list_monthly_total = quote.list_monthly_total
    return rev


def current_revision(r: m.QuoteRequest) -> Optional[m.QuoteRevision]:
    for rev in r.revisions:
        if rev.rev_no == r.current_revision_no:
            return rev
    return None


def void_signatures(r: m.QuoteRequest, *, actor: Optional[str]) -> list[m.QuoteEvent]:
    """A new revision voids any live signature: signing starts over on the new numbers."""
    events: list[m.QuoteEvent] = []
    at = now()
    for s in r.signatures:
        if s.voided_at is None:
            s.voided_at = at
            events.append(m.QuoteEvent(request_id=r.id, rev_no=s.rev_no, kind="SIGNATURE_VOIDED", actor=actor,
                                       detail={"role": s.role, "name": s.name}))
    r.accepted_at = None
    r.accepted_name = None
    r.accepted_title = None
    r.accepted_ip = None
    return events


def record_event(
    r: m.QuoteRequest, kind: str, *, rev_no: Optional[int] = None, actor: Optional[str] = None,
    detail: Optional[dict] = None, ip: Optional[str] = None, user_agent: Optional[str] = None,
) -> m.QuoteEvent:
    return m.QuoteEvent(request_id=r.id, rev_no=rev_no, kind=kind, actor=actor, detail=detail,
                        ip=ip, user_agent=(user_agent or None) and user_agent[:300])


async def refresh_request(db: AsyncSession, r: m.QuoteRequest) -> None:
    """Reload a request after commit, relationships included.

    After a commit the instance is expired; in an async session, touching an
    expired relationship raises MissingGreenlet, so load them explicitly.
    """
    await db.refresh(r)
    await db.refresh(r, attribute_names=["revisions", "signatures"])


async def list_events(db: AsyncSession, request_id: str) -> list[m.QuoteEvent]:
    return list((await db.execute(
        select(m.QuoteEvent).where(m.QuoteEvent.request_id == request_id).order_by(m.QuoteEvent.created_at)
    )).scalars())


def _rev_totals(rev: m.QuoteRevision) -> dto.TotalsDto:
    monthly = pricing.money(rev.monthly_software_total + rev.monthly_lease_total)
    return dto.TotalsDto(
        oneTime=rev.one_time_total, monthlySoftware=rev.monthly_software_total, monthlyLease=rev.monthly_lease_total,
        monthly=monthly, listOneTime=rev.list_one_time_total, listMonthly=rev.list_monthly_total,
        savingsOneTime=pricing.money(rev.list_one_time_total - rev.one_time_total),
        savingsMonthly=pricing.money(rev.list_monthly_total - monthly),
    )


def revision_dto(rev: m.QuoteRevision) -> dto.RevisionDto:
    return dto.RevisionDto(
        revNo=rev.rev_no, authorKind=rev.author_kind, authorName=rev.author_name, authorEmail=rev.author_email,
        note=rev.note, hardwarePlan=rev.hardware_plan, lines=[dto.LineDto(**line) for line in rev.lines],
        totals=_rev_totals(rev), contentHash=rev.content_hash, createdAt=rev.created_at,
    )


def public_revision_dto(rev: m.QuoteRevision, show: bool) -> dto.PublicRevisionDto:
    if show:
        lines = [dto.LineDto(**line) for line in rev.lines]
    else:
        lines = [dto.LineDto(**{k: line.get(k) for k in _QTY_ONLY}) for line in rev.lines]
    return dto.PublicRevisionDto(
        revNo=rev.rev_no, authorKind=rev.author_kind, note=rev.note, hardwarePlan=rev.hardware_plan,
        lines=lines, totals=_rev_totals(rev) if show else None, createdAt=rev.created_at,
    )


def signature_dto(s: m.QuoteSignature) -> dto.SignatureDto:
    return dto.SignatureDto(
        revNo=s.rev_no, role=s.role, name=s.name, title=s.title, email=s.email, method=s.method,
        signatureData=s.signature_data, consentVersion=s.consent_version, contentHash=s.content_hash,
        voidedAt=s.voided_at, ip=s.ip, userAgent=s.user_agent, signedAt=s.signed_at,
    )


def public_signature_dto(s: m.QuoteSignature) -> dto.PublicSignatureDto:
    return dto.PublicSignatureDto(revNo=s.rev_no, role=s.role, name=s.name, title=s.title, method=s.method,
                                  signatureData=s.signature_data, voidedAt=s.voided_at, signedAt=s.signed_at)


def event_dto(e: m.QuoteEvent) -> dto.EventDto:
    return dto.EventDto(revNo=e.rev_no, kind=e.kind, actor=e.actor, detail=e.detail, ip=e.ip, createdAt=e.created_at)


def live_signatures(r: m.QuoteRequest) -> list[m.QuoteSignature]:
    return [s for s in r.signatures if s.voided_at is None]


def totals_from_row(r: m.QuoteRequest) -> dto.TotalsDto:
    monthly = pricing.money(r.monthly_software_total + r.monthly_lease_total)
    return dto.TotalsDto(
        oneTime=r.one_time_total, monthlySoftware=r.monthly_software_total, monthlyLease=r.monthly_lease_total,
        monthly=monthly, listOneTime=r.list_one_time_total, listMonthly=r.list_monthly_total,
        savingsOneTime=pricing.money(r.list_one_time_total - r.one_time_total),
        savingsMonthly=pricing.money(r.list_monthly_total - monthly),
    )


def request_dto(
    r: m.QuoteRequest, link: Optional[m.QuoteLink] = None, *, events: Optional[list[m.QuoteEvent]] = None,
) -> dto.RequestDto:
    return dto.RequestDto(
        id=r.id, number=r.number, status=r.status, mode=r.mode, linkId=r.link_id, restaurantName=r.restaurant_name,
        contactName=r.contact_name, contactEmail=r.contact_email, contactPhone=r.contact_phone, notes=r.notes,
        hardwarePlan=r.hardware_plan, lines=[dto.LineDto(**line) for line in r.lines], totals=totals_from_row(r),
        createdAt=r.created_at, currentRevisionNo=r.current_revision_no, pricesRevealed=bool(r.prices_revealed),
        declinedReason=r.declined_reason, revisions=[revision_dto(rev) for rev in r.revisions],
        signatures=[signature_dto(s) for s in r.signatures],
        events=[event_dto(e) for e in events] if events is not None else [],
        acceptedAt=r.accepted_at, acceptedName=r.accepted_name,
        acceptedTitle=r.accepted_title, staffNote=r.staff_note, notified=r.notified or {},
        linkCreatedByEmail=link.created_by_email if link else None,
    )


_QTY_ONLY = ("sku", "name", "section", "category", "billing", "qty", "detail")


def public_request_dto(r: m.QuoteRequest) -> dto.PublicRequestDto:
    show = public_show(r)
    if show:
        lines = [dto.LineDto(**line) for line in r.lines]
    else:
        # Hidden-price link: quantities only. Prices never leave the server.
        lines = [dto.LineDto(**{k: line.get(k) for k in _QTY_ONLY}) for line in r.lines]
    return dto.PublicRequestDto(
        id=r.id, number=r.number, status=r.status, showPrices=show, createdAt=r.created_at,
        restaurantName=r.restaurant_name, contactName=r.contact_name, contactEmail=r.contact_email,
        hardwarePlan=r.hardware_plan, notes=r.notes, lines=lines, totals=totals_from_row(r) if show else None,
        currentRevisionNo=r.current_revision_no,
        revisions=[public_revision_dto(rev, show) for rev in r.revisions],
        signatures=[public_signature_dto(s) for s in r.signatures],
        consentText=signing.CONSENT_TEXT if show else None,
        consentVersion=signing.CONSENT_VERSION if show else None,
        declinedReason=r.declined_reason,
        acceptedAt=r.accepted_at, acceptedName=r.accepted_name, terms=TERMS if show else [],
        goldIncluded=GOLD_INCLUDED, leaseMonths=LEASE_MONTHS,
    )


async def count(db: AsyncSession, stmt) -> int:
    return (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
