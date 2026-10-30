"""Deals — the rules that make the pipeline move the rest of the app.

* A deal for a restaurant that is not yet a merchant creates the merchant at
  the same moment, as a PROSPECT, so every quote, ticket and call from day one
  hangs off a real merchant row.
* The merchant's lifecycle follows the deal:
    ORDER_FORM_SIGNED … DEPLOYED  → merchant ONBOARDING
    LIVE                          → merchant ACTIVE (+ go_live_date)
    LOST on a PROSPECT merchant   → stays PROSPECT (nothing to undo)
  A merchant that is already ACTIVE is never downgraded automatically; only
  PROSPECT/ONBOARDING merchants are moved.
* When a quote request is EXECUTED (countersigned) and its link belongs to a
  deal, the deal moves to ORDER_FORM_SIGNED if it is earlier than that, the
  signed totals are copied onto the deal, and a QUOTE_EXECUTED event is logged.

Everything here is session-local: callers commit.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import quotes as qm
from app.models.deals import ONBOARDING_STAGES, Deal, DealEvent, stage_index, utcnow
from app.models.enums import ContactRole, DealEventKind, DealStage, MerchantStatus
from app.models.profiling import Contact, Location, Merchant
from app.schemas.deals import NewMerchantIn

# Merchant statuses the pipeline is allowed to move. ACTIVE / PAUSED / CHURNED
# are owned by the account team and never changed from a deal.
_FOLLOWS_DEAL = frozenset({MerchantStatus.PROSPECT, MerchantStatus.ONBOARDING})


def record_event(db: AsyncSession, deal: Deal, kind: DealEventKind, *, user_id: Optional[str],
                 body: Optional[str] = None, from_stage: Optional[DealStage] = None,
                 to_stage: Optional[DealStage] = None) -> DealEvent:
    # Added to the session directly (not via ``deal.events``) so a deal loaded
    # without its events collection never triggers a lazy load mid-request.
    ev = DealEvent(deal_id=deal.id, user_id=user_id, kind=kind, body=body, from_stage=from_stage, to_stage=to_stage)
    db.add(ev)
    return ev


# ============================================================ merchants =====
def new_prospect_merchant(data: NewMerchantIn) -> Merchant:
    """Build (not persist) a PROSPECT merchant from the new-deal form."""
    m = Merchant(restaurant_name=data.restaurantName, region=data.region, status=MerchantStatus.PROSPECT,
                 source="NEW_DEAL")
    if data.contactName or data.contactEmail or data.contactPhone:
        m.contacts.append(Contact(name=data.contactName, email=data.contactEmail, phone=data.contactPhone,
                                  role=ContactRole.OWNER))
    if data.address or data.city or data.state or data.zip:
        m.locations.append(Location(address=data.address, city=data.city, state=data.state, zip=data.zip, is_primary=True))
    return m


def sync_merchant_to_stage(merchant: Merchant, stage: DealStage, *, go_live: Optional[dt.date] = None) -> bool:
    """Move the merchant with the deal. Returns True if the merchant changed."""
    if merchant.status not in _FOLLOWS_DEAL:
        return False
    changed = False
    if stage in ONBOARDING_STAGES and merchant.status != MerchantStatus.ONBOARDING:
        merchant.status = MerchantStatus.ONBOARDING
        if merchant.onboarding_date is None:
            merchant.onboarding_date = utcnow()
        changed = True
    elif stage == DealStage.LIVE:
        merchant.status = MerchantStatus.ACTIVE
        when = go_live or dt.date.today()
        merchant.go_live_date = dt.datetime(when.year, when.month, when.day, tzinfo=dt.timezone.utc)
        changed = True
    # NEW…QUOTE_SENT and LOST: nothing to do (a PROSPECT stays a PROSPECT).
    return changed


# ================================================================ stages =====
def change_stage(db: AsyncSession, deal: Deal, merchant: Merchant, to: DealStage, *, user_id: Optional[str],
                 lost_reason: Optional[str] = None, go_live: Optional[dt.date] = None) -> bool:
    """Apply a stage change with its side effects. Returns False if nothing changed."""
    if to == deal.stage:
        if to == DealStage.LOST and lost_reason is not None:
            deal.lost_reason = lost_reason
        return False
    if to == DealStage.LOST and not (lost_reason or deal.lost_reason):
        raise HTTPException(status_code=422,
                            detail="A reason is required to mark a deal lost")
    frm = deal.stage
    deal.stage = to
    deal.stage_changed_at = utcnow()
    if to == DealStage.LOST:
        deal.lost_reason = lost_reason or deal.lost_reason
    else:
        deal.lost_reason = None
    if to == DealStage.LIVE:
        deal.go_live_date = go_live or deal.go_live_date or dt.date.today()
    record_event(db, deal, DealEventKind.STAGE_CHANGED, user_id=user_id, from_stage=frm, to_stage=to)
    sync_merchant_to_stage(merchant, to, go_live=deal.go_live_date)
    return True


# ================================================================ quotes =====
def quote_totals(r: qm.QuoteRequest) -> tuple[Decimal, Decimal]:
    """(monthly, one-time) a signed request commits the restaurant to."""
    monthly = (r.monthly_software_total or Decimal("0")) + (r.monthly_lease_total or Decimal("0"))
    return monthly, r.one_time_total or Decimal("0")


async def on_quote_executed(db: AsyncSession, r: qm.QuoteRequest, link: qm.QuoteLink, *, user_id: Optional[str]) -> Optional[Deal]:
    """Countersign hook. No-op when the link is not attached to a deal."""
    if not link.deal_id:
        return None
    deal = await db.get(Deal, link.deal_id)
    if deal is None:
        return None
    merchant = await db.get(Merchant, deal.merchant_id)
    monthly, one_time = quote_totals(r)
    deal.amount_monthly = monthly
    deal.amount_one_time = one_time
    record_event(db, deal, DealEventKind.QUOTE_EXECUTED, user_id=user_id,
                 body=f"Quote {r.number} signed by both parties — ${monthly:,.2f}/mo, ${one_time:,.2f} one-time")
    if deal.stage != DealStage.LOST and stage_index(deal.stage) < stage_index(DealStage.ORDER_FORM_SIGNED) and merchant is not None:
        change_stage(db, deal, merchant, DealStage.ORDER_FORM_SIGNED, user_id=user_id)
    return deal


async def attach_quote_link(db: AsyncSession, deal: Deal, link: qm.QuoteLink, *, user_id: Optional[str]) -> None:
    """Point a quote link at a deal (and the deal's merchant if the link had none)."""
    if link.deal_id == deal.id:
        return
    if link.deal_id and link.deal_id != deal.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This quote link already belongs to another deal")
    link.deal_id = deal.id
    if not link.merchant_id:
        link.merchant_id = deal.merchant_id
    record_event(db, deal, DealEventKind.QUOTE_LINKED, user_id=user_id, body=f"Quote link for {link.restaurant_name} attached")
    # An already-executed request on this link counts immediately.
    executed = (await db.execute(
        select(qm.QuoteRequest).where(qm.QuoteRequest.link_id == link.id, qm.QuoteRequest.status == qm.STATUS_EXECUTED)
        .order_by(qm.QuoteRequest.updated_at.desc()).limit(1)
    )).scalar_one_or_none()
    if executed is not None:
        await on_quote_executed(db, executed, link, user_id=user_id)
