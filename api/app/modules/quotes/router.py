"""/quotes - the quote builder, staff side.

  Price list   GET /quotes/price-list (quotes.view) · POST, PATCH /quotes/price-list[/{id}] (quotes.pricing)
  Links        GET/POST /quotes/links · GET/PATCH /quotes/links/{id} · POST /quotes/links/{id}/revoke
               POST /quotes/links/{id}/new-url · POST /quotes/links/{id}/price (preview)
  Requests     GET /quotes/requests · GET/PATCH /quotes/requests/{id} · GET /quotes/requests/{id}/pdf
  Summary      GET /quotes/summary

Read: quotes.view. Send links: quotes.edit. Special pricing on a link:
quotes.discount. Editing the price list: quotes.pricing.

A link's URL carries a random token; only its SHA-256 is stored, so the URL is
shown once (on create, and on "new URL", which retires the old one). Link and
price changes are written to the audit log, without the URL.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.capabilities import has_capability
from app.common.deps import AuthenticatedUser, require_capability
from app.common.pagination import PageMeta
from app.db.session import get_db
from app.models import quotes as m
from app.models.audit import AuditLog
from app.models.deals import Deal
from app.models.enums import AuditAction, AuditOutcome
from app.modules.deals import service as deal_service
from app.modules.quotes import notify, pdf, service, signing
from app.modules.quotes.price_sheet import SECTIONS
from app.modules.quotes.pricing import apply_bundles
from app.schemas import quotes as dto

router = APIRouter(prefix="/quotes", tags=["Quotes"])

_view = require_capability("quotes.view")
_edit = require_capability("quotes.edit")
_pricing = require_capability("quotes.pricing")


async def _audit(db: AsyncSession, request: Request, user: AuthenticatedUser, action: AuditAction, entity_type: str,
                 entity_id: str, before: Optional[dict], after: Optional[dict]) -> None:
    changed = sorted(k for k in set(before or {}) | set(after or {}) if (before or {}).get(k) != (after or {}).get(k)) \
        if action == AuditAction.UPDATE else []
    db.add(AuditLog(
        actor_id=user.id, actor_email=user.email, actor_role=user.role, action=action, entity_type=entity_type,
        entity_id=entity_id, before=before, after=after, changed_fields=changed, method=request.method,
        path=str(request.url.path), outcome=AuditOutcome.SUCCESS, status_code=200,
        ip=request.client.host if request.client else None, user_agent=request.headers.get("user-agent"),
    ))
    await db.commit()


def _plain(model) -> dict:
    return model.model_dump(mode="json")


# ── price list ────────────────────────────────────────────────────────────
@router.get("/price-list", response_model=dto.PriceListDto)
async def get_price_list(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    return dto.PriceListDto(data=[service.price_item_dto(r) for r in await service.list_price_items(db)])


@router.get("/sections")
async def get_sections(user: AuthenticatedUser = Depends(_view)):
    return {"data": SECTIONS}


@router.post("/price-list", response_model=dto.PriceItemDto, status_code=201)
async def create_price_item(
    body: dto.PriceItemCreateDto, request: Request, db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_pricing),
):
    if (await db.execute(select(m.PriceItem.id).where(m.PriceItem.sku == body.sku))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An item with this SKU already exists")
    await _check_bundle_sku(db, body.sku, body.bundledInSku)
    sort = body.sortOrder
    if sort is None:
        rows = [r for r in await service.list_price_items(db) if r.section == body.section]
        sort = (max((r.sort_order for r in rows), default=0) + 10)
    row = m.PriceItem(
        sku=body.sku, name=body.name, description=body.description, note=body.note, section=body.section,
        kind=body.kind, unit_label=body.unitLabel, monthly_price=body.monthlyPrice, purchase_price=body.purchasePrice,
        lease_price=body.leasePrice, is_station=body.isStation, bundled_in_sku=body.bundledInSku,
        max_qty=body.maxQty, sort_order=sort,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    out = service.price_item_dto(row)
    await _audit(db, request, user, AuditAction.CREATE, "PriceItem", row.id, None, _plain(out))
    return out


_FIELD_MAP = {
    "name": "name", "description": "description", "note": "note", "unitLabel": "unit_label",
    "monthlyPrice": "monthly_price", "purchasePrice": "purchase_price", "leasePrice": "lease_price",
    "maxQty": "max_qty", "sortOrder": "sort_order", "active": "active", "bundledInSku": "bundled_in_sku",
}


async def _check_bundle_sku(db: AsyncSession, item_sku: str, bundle_sku: Optional[str]) -> None:
    if not bundle_sku:
        return
    if bundle_sku == item_sku:
        raise HTTPException(status_code=400, detail="An item can't be bundled into itself")
    if not (await db.execute(select(m.PriceItem.id).where(m.PriceItem.sku == bundle_sku))).scalar_one_or_none():
        raise HTTPException(status_code=400, detail=f"No price-list item has the SKU {bundle_sku}")


@router.patch("/price-list/{id}", response_model=dto.PriceItemDto)
async def update_price_item(
    id: str, body: dto.PriceItemUpdateDto, request: Request, db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_pricing),
):
    row = await db.get(m.PriceItem, id)
    if not row:
        raise HTTPException(status_code=404, detail="Price-list item not found")
    before = _plain(service.price_item_dto(row))
    changes = {k: getattr(body, k) for k in body.model_fields_set if k != "clear"}
    if "name" in changes and not changes["name"]:
        raise HTTPException(status_code=400, detail="Name can't be empty")
    if changes.get("bundledInSku"):
        await _check_bundle_sku(db, row.sku, changes["bundledInSku"])
    if changes.get("active") is False and not row.selectable:
        # A pricing rule (the first station's software price) isn't a product:
        # switching it off would silently bill every station at the add-on price.
        raise HTTPException(status_code=400, detail="This is a pricing rule, not a product: change its price instead of turning it off")
    for key, value in changes.items():
        if value is None and key not in ("description", "note", "unitLabel"):
            continue  # null means "leave as is"; use `clear` to remove a price
        setattr(row, _FIELD_MAP[key], value)
    for key in body.clear:
        setattr(row, _FIELD_MAP[key], None)
    # Keep each kind priceable.
    need = {"DEVICE": ("purchase_price", "monthly_price"), "HARDWARE": ("purchase_price",),
            "SOFTWARE": ("monthly_price",), "SERVICE": ("purchase_price",)}[row.kind]
    if any(getattr(row, f) is None for f in need):
        detail = f"a {row.kind.lower()} must keep a price ({', '.join(need)})"
        await db.rollback()  # expires `row`: don't touch it after this
        raise HTTPException(status_code=400, detail=detail)
    await db.commit()
    await db.refresh(row)
    out = service.price_item_dto(row)
    await _audit(db, request, user, AuditAction.UPDATE, "PriceItem", row.id, before, _plain(out))
    return out


# ── links ─────────────────────────────────────────────────────────────────
async def _get_link(db: AsyncSession, id: str) -> m.QuoteLink:
    link = await db.get(m.QuoteLink, id)
    if not link:
        raise HTTPException(status_code=404, detail="Quote link not found")
    return link


def _check_discount_rights(user: AuthenticatedUser, discount, items) -> None:
    if service.has_special_pricing(discount, items) and not has_capability(user.role, "quotes.discount"):
        raise HTTPException(status_code=403, detail="Special pricing needs a manager or admin")


@router.get("/links", response_model=dto.PaginatedLinksDto)
async def list_links(
    db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view),
    page: int = Query(1, ge=1), limit: int = Query(25, ge=1, le=100),
    q: Optional[str] = Query(None, max_length=160), status: Optional[str] = Query(None, pattern="^(ACTIVE|REVOKED)$"),
    mine: bool = False,
):
    stmt = select(m.QuoteLink)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(m.QuoteLink.restaurant_name.ilike(like), m.QuoteLink.contact_name.ilike(like),
                              m.QuoteLink.contact_email.ilike(like)))
    if status:
        stmt = stmt.where(m.QuoteLink.status == status)
    if mine:
        stmt = stmt.where(m.QuoteLink.created_by_id == user.id)
    total = await service.count(db, stmt)
    rows = list((await db.execute(
        stmt.order_by(m.QuoteLink.created_at.desc()).offset((page - 1) * limit).limit(limit)
    )).scalars())
    stats = await service.request_stats(db, [r.id for r in rows])
    return dto.PaginatedLinksDto(data=[service.link_dto(r, stats.get(r.id)) for r in rows],
                                 meta=PageMeta.build(page, limit, total))


@router.post("/links", response_model=dto.LinkCreatedDto, status_code=201)
async def create_link(
    body: dto.CreateLinkDto, request: Request, db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_edit),
):
    _check_discount_rights(user, body.discountPercent, body.items)
    await service.validate_link_items(db, body.items)
    token, token_hash = service.new_token()
    link = m.QuoteLink(
        token_hash=token_hash, mode=body.mode, status="ACTIVE", restaurant_name=body.restaurantName,
        contact_name=body.contactName, contact_email=str(body.contactEmail) if body.contactEmail else None,
        contact_phone=body.contactPhone, merchant_id=body.merchantId, message=body.message,
        discount_percent=body.discountPercent, allow_lease=body.allowLease,
        expires_at=service.now() + dt.timedelta(days=body.expiresInDays) if body.expiresInDays else None,
        created_by_id=user.id, created_by_email=user.email, items=[],
    )
    service.replace_link_items(link, body.items)
    db.add(link)
    if body.dealId:
        deal = await db.get(Deal, body.dealId)
        if deal is None:
            raise HTTPException(status_code=422, detail="Deal not found")
        if not link.merchant_id:
            link.merchant_id = deal.merchant_id
        await db.flush()
        await deal_service.attach_quote_link(db, deal, link, user_id=user.id)
    await db.commit()
    await db.refresh(link)
    out = service.link_dto(link)
    await _audit(db, request, user, AuditAction.CREATE, "QuoteLink", link.id, None, _plain(out))
    return dto.LinkCreatedDto(link=out, url=service.link_url(token))


@router.get("/links/{id}", response_model=dto.LinkDto)
async def get_link(id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    link = await _get_link(db, id)
    stats = await service.request_stats(db, [link.id])
    return service.link_dto(link, stats.get(link.id))


@router.patch("/links/{id}", response_model=dto.LinkDto)
async def update_link(
    id: str, body: dto.UpdateLinkDto, request: Request, db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(_edit),
):
    link = await _get_link(db, id)
    before = _plain(service.link_dto(link))
    fields = body.model_fields_set
    if ("discountPercent" in fields or "items" in fields) and not has_capability(user.role, "quotes.discount"):
        _check_discount_rights(user, body.discountPercent, body.items)
    if "restaurantName" in fields:
        if not body.restaurantName:
            raise HTTPException(status_code=400, detail="Restaurant name can't be empty")
        link.restaurant_name = body.restaurantName
    for f, attr in (("contactName", "contact_name"), ("contactPhone", "contact_phone"), ("message", "message")):
        if f in fields:
            setattr(link, attr, getattr(body, f))
    if "contactEmail" in fields:
        link.contact_email = str(body.contactEmail) if body.contactEmail else None
    if "discountPercent" in fields and body.discountPercent is not None:
        link.discount_percent = body.discountPercent
    if "allowLease" in fields and body.allowLease is not None:
        link.allow_lease = body.allowLease
    if "expiresInDays" in fields and body.expiresInDays:
        link.expires_at = service.now() + dt.timedelta(days=body.expiresInDays)
    if "items" in fields and body.items is not None:
        await service.validate_link_items(db, body.items)
        service.replace_link_items(link, body.items)
    await db.commit()
    await db.refresh(link)
    stats = await service.request_stats(db, [link.id])
    out = service.link_dto(link, stats.get(link.id))
    await _audit(db, request, user, AuditAction.UPDATE, "QuoteLink", link.id, before, _plain(out))
    return out


@router.post("/links/{id}/revoke", response_model=dto.LinkDto)
async def revoke_link(id: str, request: Request, db: AsyncSession = Depends(get_db),
                      user: AuthenticatedUser = Depends(_edit)):
    link = await _get_link(db, id)
    before = _plain(service.link_dto(link))
    link.status = "REVOKED"
    await db.commit()
    await db.refresh(link)
    out = service.link_dto(link)
    await _audit(db, request, user, AuditAction.UPDATE, "QuoteLink", link.id, before, _plain(out))
    return out


@router.post("/links/{id}/new-url", response_model=dto.LinkCreatedDto)
async def new_link_url(id: str, request: Request, db: AsyncSession = Depends(get_db),
                       user: AuthenticatedUser = Depends(_edit)):
    """A fresh URL for the same link (the old one stops working). Re-opens a revoked or expired link."""
    link = await _get_link(db, id)
    before = _plain(service.link_dto(link))
    token, token_hash = service.new_token()
    link.token_hash = token_hash
    link.status = "ACTIVE"
    if service.is_expired(link):
        link.expires_at = service.now() + dt.timedelta(days=30)
    await db.commit()
    await db.refresh(link)
    stats = await service.request_stats(db, [link.id])
    out = service.link_dto(link, stats.get(link.id))
    await _audit(db, request, user, AuditAction.UPDATE, "QuoteLink", link.id, before, _plain(out))
    return dto.LinkCreatedDto(link=out, url=service.link_url(token))


@router.post("/links/{id}/price", response_model=dto.PricedDto)
async def preview_link_price(id: str, body: dto.PriceRequestDto, db: AsyncSession = Depends(get_db),
                             user: AuthenticatedUser = Depends(_view)):
    """What a selection would cost this client (staff preview; works for both modes)."""
    link = await _get_link(db, id)
    offer, first = await service.build_offer(db, link)
    selections, dropped = apply_bundles(offer, [(s.itemId, s.qty) for s in body.items])
    return service.priced_dto(service.price_or_400_pairs(offer, selections, body.hardwarePlan, first), dropped)


# ── requests ──────────────────────────────────────────────────────────────
@router.get("/requests", response_model=dto.PaginatedRequestsDto)
async def list_requests(
    db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view),
    page: int = Query(1, ge=1), limit: int = Query(25, ge=1, le=100),
    status: Optional[str] = Query(None), linkId: Optional[str] = Query(None, max_length=30),
    q: Optional[str] = Query(None, max_length=160),
):
    if status and status not in m.REQUEST_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {', '.join(m.REQUEST_STATUSES)}")
    stmt = select(m.QuoteRequest)
    if status:
        stmt = stmt.where(m.QuoteRequest.status == status)
    if linkId:
        stmt = stmt.where(m.QuoteRequest.link_id == linkId)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(m.QuoteRequest.restaurant_name.ilike(like), m.QuoteRequest.contact_name.ilike(like),
                              m.QuoteRequest.contact_email.ilike(like), m.QuoteRequest.number.ilike(like)))
    total = await service.count(db, stmt)
    rows = list((await db.execute(
        stmt.order_by(m.QuoteRequest.created_at.desc()).offset((page - 1) * limit).limit(limit)
    )).scalars())
    links = {}
    if rows:
        links = {lk.id: lk for lk in (await db.execute(
            select(m.QuoteLink).where(m.QuoteLink.id.in_({r.link_id for r in rows})))).scalars()}
    return dto.PaginatedRequestsDto(data=[service.request_dto(r, links.get(r.link_id)) for r in rows],
                                    meta=PageMeta.build(page, limit, total))


async def _get_request(db: AsyncSession, id: str) -> m.QuoteRequest:
    r = await db.get(m.QuoteRequest, id)
    if not r:
        raise HTTPException(status_code=404, detail="Quote request not found")
    return r


@router.get("/requests/{id}", response_model=dto.RequestDto)
async def get_request(id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    r = await _get_request(db, id)
    return service.request_dto(r, await db.get(m.QuoteLink, r.link_id), events=await service.list_events(db, r.id))


@router.patch("/requests/{id}", response_model=dto.RequestDto)
async def update_request(id: str, body: dto.UpdateRequestDto, request: Request, db: AsyncSession = Depends(get_db),
                         user: AuthenticatedUser = Depends(_edit)):
    r = await _get_request(db, id)
    link = await db.get(m.QuoteLink, r.link_id)
    before = _plain(service.request_dto(r, link))
    if r.status in m.WON_STATUSES and body.status:
        raise HTTPException(status_code=409, detail="This proposal was signed; send a revision instead of changing its status")
    if body.status:
        if body.status != r.status:
            db.add(service.record_event(r, "STATUS_CHANGED", rev_no=r.current_revision_no, actor=user.email,
                                        detail={"from": r.status, "to": body.status}))
        r.status = body.status
    if "staffNote" in body.model_fields_set:
        r.staff_note = body.staffNote
    await db.commit()
    await service.refresh_request(db, r)
    out = service.request_dto(r, link, events=await service.list_events(db, r.id))
    await _audit(db, request, user, AuditAction.UPDATE, "QuoteRequest", r.id, before, _plain(out))
    return out


@router.post("/requests/{id}/revise", response_model=dto.RequestDto)
async def revise_request(id: str, body: dto.StaffReviseDto, request: Request, db: AsyncSession = Depends(get_db),
                         user: AuthenticatedUser = Depends(_edit)):
    """Send the client a counter-offer: a new revision priced from the link.

    Pricing authority stays on the link: to change this client's prices, set
    special pricing on the link (quotes.discount) first, then revise. A
    revision on a signed or accepted request voids the signatures - everyone
    signs the new numbers. On a hidden-price link, ``revealPrices`` shows the
    client this request's prices (the link's catalog stays hidden).
    """
    r = await _get_request(db, id)
    link = await db.get(m.QuoteLink, r.link_id)
    if not link:
        raise HTTPException(status_code=404, detail="This request's link no longer exists")
    if r.status == m.STATUS_EXECUTED:
        raise HTTPException(status_code=409, detail="This quote is fully signed; start a new quote for further changes")
    before = _plain(service.request_dto(r, link))
    offer, first = await service.build_offer(db, link)
    selections, _dropped = apply_bundles(offer, [(s.itemId, s.qty) for s in body.items])
    quote = service.price_or_400_pairs(offer, selections, body.hardwarePlan, first)
    kept = [{"itemId": i, "qty": q} for i, q in selections if q > 0]
    rev = service.add_revision(db, r, author_kind=m.AUTHOR_STAFF, author_name=user.email, author_email=user.email,
                               note=body.note, hardware_plan=body.hardwarePlan, selections=kept, quote=quote)
    for e in service.void_signatures(r, actor=user.email):
        db.add(e)
    if body.revealPrices and r.mode == m.MODE_HIDE and not r.prices_revealed:
        r.prices_revealed = True
        db.add(service.record_event(r, "PRICES_REVEALED", rev_no=rev.rev_no, actor=user.email))
    r.status = m.STATUS_PROPOSED if service.public_show(r) else m.STATUS_REQUESTED
    r.declined_reason = None
    db.add(service.record_event(r, "REVISED_STAFF", rev_no=rev.rev_no, actor=user.email,
                                detail={"note": body.note} if body.note else None))
    await db.commit()
    await service.refresh_request(db, r)
    r.notified = {**(r.notified or {}), "revised_staff": await notify.notify("revised_staff", r, link)}
    await db.commit()
    await service.refresh_request(db, r)
    out = service.request_dto(r, link, events=await service.list_events(db, r.id))
    await _audit(db, request, user, AuditAction.UPDATE, "QuoteRequest", r.id, before, _plain(out))
    return out


@router.post("/requests/{id}/countersign", response_model=dto.RequestDto)
async def countersign_request(id: str, body: dto.CountersignDto, request: Request, db: AsyncSession = Depends(get_db),
                              user: AuthenticatedUser = Depends(_edit)):
    """Innowi's countersignature on a client-signed revision: the quote is then fully executed."""
    r = await _get_request(db, id)
    link = await db.get(m.QuoteLink, r.link_id)
    if r.status != m.STATUS_SIGNED:
        raise HTTPException(status_code=409, detail="Countersigning needs the client's signature first")
    try:
        data = signing.validate_signature_data(body.method, body.signatureData)
    except signing.SignatureDataError as e:
        raise HTTPException(status_code=400, detail=str(e))
    before = _plain(service.request_dto(r, link))
    rev = service.current_revision(r)
    ip = request.client.host if request.client else None
    db.add(m.QuoteSignature(
        request_id=r.id, rev_no=r.current_revision_no, role=m.SIGN_INNOWI, name=body.name, title=body.title,
        email=user.email, method=body.method, signature_data=data, consent_version=signing.CONSENT_VERSION,
        content_hash=rev.content_hash if rev else "", ip=ip and ip[:64],
        user_agent=(request.headers.get("user-agent") or "")[:300],
    ))
    r.status = m.STATUS_EXECUTED
    db.add(service.record_event(r, "SIGNED_INNOWI", rev_no=r.current_revision_no, actor=user.email,
                                ip=ip and ip[:64], user_agent=(request.headers.get("user-agent") or "")[:300]))
    if link is not None and link.deal_id:
        # The deal this quote hangs off moves to ORDER_FORM_SIGNED and takes the signed totals.
        await deal_service.on_quote_executed(db, r, link, user_id=user.id)
    await db.commit()
    await service.refresh_request(db, r)
    events = await service.list_events(db, r.id)
    pdf_bytes = pdf.render_proposal(r, prepared_by=link.created_by_email if link else None,
                                    valid_until=link.expires_at if link else None, events=events)
    r.notified = {**(r.notified or {}),
                  "executed": await notify.notify("executed", r, link, pdf_bytes=pdf_bytes)}
    await db.commit()
    await service.refresh_request(db, r)
    out = service.request_dto(r, link, events=events)
    await _audit(db, request, user, AuditAction.UPDATE, "QuoteRequest", r.id, before, _plain(out))
    return out


@router.get("/requests/{id}/pdf")
async def request_pdf(id: str, db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view),
                      rev: Optional[int] = Query(None, ge=1, le=10000)):
    """The proposal PDF: the current revision, or ``?rev=N`` for an earlier one."""
    r = await _get_request(db, id)
    link = await db.get(m.QuoteLink, r.link_id)
    revision = None
    if rev is not None and rev != r.current_revision_no:
        revision = next((x for x in r.revisions if x.rev_no == rev), None)
        if revision is None:
            raise HTTPException(status_code=404, detail="No such revision")
    events = await service.list_events(db, r.id)
    body = pdf.render_proposal(r, prepared_by=link.created_by_email if link else None,
                               valid_until=link.expires_at if link else None, events=events, revision=revision)
    suffix = f"-rev{rev}" if revision is not None else ""
    return Response(content=body, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="Innowi-proposal-{r.number}{suffix}.pdf"'})


@router.get("/summary", response_model=dto.QuoteSummaryDto)
async def summary(db: AsyncSession = Depends(get_db), user: AuthenticatedUser = Depends(_view)):
    since = service.now() - dt.timedelta(days=30)
    active = [lk for lk in (await db.execute(select(m.QuoteLink).where(m.QuoteLink.status == "ACTIVE"))).scalars()
              if not service.is_expired(lk)]
    open_count = await service.count(db, select(m.QuoteRequest).where(
        m.QuoteRequest.status.in_((m.STATUS_REQUESTED, m.STATUS_PROPOSED))))
    accepted = list((await db.execute(select(m.QuoteRequest).where(
        m.QuoteRequest.status.in_(m.WON_STATUSES), m.QuoteRequest.accepted_at >= since))).scalars())
    monthly = sum(((r.monthly_software_total + r.monthly_lease_total) for r in accepted), start=service.pricing.ZERO)
    return dto.QuoteSummaryDto(activeLinks=len(active), requestsOpen=open_count, accepted30d=len(accepted),
                               acceptedMonthly30d=service.pricing.money(monthly))
