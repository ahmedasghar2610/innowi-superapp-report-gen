"""/public/quotes/{token} - the quote builder page a restaurant opens. No login.

  GET  /public/quotes/{token}                         what this link offers (prices only on a price link)
  POST /public/quotes/{token}/price                   live price of a selection (price links only)
  POST /public/quotes/{token}/requests                submit: proposal (price link) or request (hidden prices);
                                                      with requestId, a counter-revision on that request
  GET  /public/quotes/{token}/requests/{id}           a submitted proposal/request, with its revision trail
  POST /public/quotes/{token}/requests/{id}/sign      sign the current revision (priced requests only)
  POST /public/quotes/{token}/requests/{id}/decline   decline the proposal
  GET  /public/quotes/{token}/requests/{id}/pdf       proposal PDF (priced requests only)

The token is the only key: 192 random bits, stored as a SHA-256, so guessing
one is not a practical attack and there is no per-address throttle on wrong
tokens (behind the web app's proxy every visitor shares one address, so such a
throttle would mostly lock out real customers). Submissions are rate-limited
per link. On a hidden-price link no price, total or discount ever leaves the
server - the catalog and the request come back with quantities only - until
staff send a priced revision with "reveal prices" for that request.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.security.throttle import FailureThrottle
from app.db.session import get_db
from app.models import quotes as m
from app.modules.quotes import notify, pdf, service, signing
from app.modules.quotes.price_sheet import GOLD_INCLUDED, LEASE_MONTHS, SECTIONS, TERMS
from app.modules.quotes.pricing import apply_bundles
from app.schemas import quotes as dto

router = APIRouter(prefix="/public/quotes", tags=["Quotes (public)"])

# Submissions per link: a burst guard, not a business rule.
submit_throttle = FailureThrottle(limit=20, window_seconds=600)

GONE = "This quote link isn't active any more. Ask your Innowi contact for a new one."
VIEW_EVENT_GAP = dt.timedelta(minutes=10)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "-")[:64]


def _ua(request: Request) -> str:
    return (request.headers.get("user-agent") or "")[:300]


async def _link(db: AsyncSession, token: str, request: Request) -> m.QuoteLink:
    if not (20 <= len(token) <= 100):
        raise HTTPException(status_code=404, detail=GONE)
    link = (await db.execute(select(m.QuoteLink).where(m.QuoteLink.token_hash == service.hash_token(token)))).scalar_one_or_none()
    if not link or not service.is_usable(link):
        raise HTTPException(status_code=404, detail=GONE)
    return link


def _quotes_list_price(it, first) -> bool:
    """True when this item's note may quote a list price that this link overrides.

    Notes on the price sheet mention list prices ("First station $99/mo ...").
    On a link with special pricing for the item (or for the first-station rule a
    station note talks about) that note would contradict the price shown.
    """
    changed = (it.monthly != it.list_monthly) or (it.purchase != it.list_purchase) or (it.lease != it.list_lease)
    if it.is_station and first is not None:
        changed = changed or first.monthly != first.list_monthly
    return changed


def _public_item(it, show: bool, first=None, names: dict[str, str] | None = None) -> dto.PublicItemDto:
    base = dict(id=it.id, sku=it.sku, name=it.name, description=it.description, note=it.note, kind=it.kind,
                unitLabel=it.unit_label, isStation=it.is_station, maxQty=it.max_qty)
    if it.bundled_in_sku and names and it.bundled_in_sku in names:
        # Only name bundles this link actually offers: the UI rule needs both sides present.
        base.update(bundledInSku=it.bundled_in_sku, bundledInName=names[it.bundled_in_sku])
    # A note that quotes a price is dropped when prices are hidden (it would leak
    # list pricing) and when this link prices the item differently (it would
    # contradict the price on screen).
    if base["note"] and "$" in base["note"] and (not show or _quotes_list_price(it, first)):
        base["note"] = None
    if show:
        base.update(listMonthly=it.list_monthly, listPurchase=it.list_purchase, listLease=it.list_lease,
                    monthly=it.monthly, purchase=it.purchase, lease=it.lease)
    return dto.PublicItemDto(**base)


@router.get("/{token}", response_model=dto.PublicOfferDto, response_model_exclude_none=True)
async def get_offer(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    link = await _link(db, token, request)
    show = link.mode == m.MODE_SHOW
    offer, first = await service.build_offer(db, link)
    names = {it.sku: it.name for it in offer.values()}
    sections = []
    for s in SECTIONS:
        # offer keeps the price list's order (section, sort order, name).
        items = [_public_item(it, show, first, names) for it in offer.values() if it.section == s["key"]]
        if items:
            sections.append(dto.PublicSectionDto(key=s["key"], title=s["title"], blurb=s.get("blurb"), items=items))
    latest = (await db.execute(
        select(m.QuoteRequest).where(m.QuoteRequest.link_id == link.id).order_by(m.QuoteRequest.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    link.open_count = (link.open_count or 0) + 1
    link.last_opened_at = service.now()
    await db.commit()
    return dto.PublicOfferDto(
        restaurantName=link.restaurant_name, contactName=link.contact_name, message=link.message, showPrices=show,
        allowLease=link.allow_lease, leaseMonths=LEASE_MONTHS,
        firstStationMonthly=first.monthly if (show and first) else None, sections=sections,
        goldIncluded=GOLD_INCLUDED, terms=TERMS if show else [], preparedBy=link.created_by_email,
        latestRequest=dto.PublicRequestBriefDto(id=latest.id, number=latest.number, status=latest.status,
                                                createdAt=latest.created_at) if latest else None,
    )


def _plan(link: m.QuoteLink, plan: str) -> str:
    return plan if link.allow_lease else "BUY"


@router.post("/{token}/price", response_model=dto.PricedDto)
async def price(token: str, body: dto.PriceRequestDto, request: Request, db: AsyncSession = Depends(get_db)):
    link = await _link(db, token, request)
    if link.mode != m.MODE_SHOW:
        raise HTTPException(status_code=403, detail="Prices aren't shown on this quote")
    offer, first = await service.build_offer(db, link)
    selections, dropped = apply_bundles(offer, [(s.itemId, s.qty) for s in body.items])
    quote = service.price_or_400_pairs(offer, selections, _plan(link, body.hardwarePlan), first)
    return service.priced_dto(quote, dropped)


async def _request(db: AsyncSession, link: m.QuoteLink, id: str) -> m.QuoteRequest:
    r = await db.get(m.QuoteRequest, id)
    if not r or r.link_id != link.id:
        raise HTTPException(status_code=404, detail="Not found")
    return r


@router.post("/{token}/requests", response_model=dto.PublicRequestDto, status_code=201, response_model_exclude_none=True)
async def submit(token: str, body: dto.SubmitRequestDto, request: Request, db: AsyncSession = Depends(get_db)):
    link = await _link(db, token, request)
    if submit_throttle.is_blocked(link.id):
        raise HTTPException(status_code=429, detail="Too many submissions on this quote. Try again in a few minutes.")
    offer, first = await service.build_offer(db, link)
    plan = _plan(link, body.hardwarePlan)
    selections, _dropped = apply_bundles(offer, [(s.itemId, s.qty) for s in body.items])
    quote = service.price_or_400_pairs(offer, selections, plan, first)
    submit_throttle.record_failure(link.id)  # counts submissions, not failures
    show = link.mode == m.MODE_SHOW
    kept = [{"itemId": i, "qty": q} for i, q in selections if q > 0]
    ip, ua = _client_ip(request), _ua(request)

    if body.requestId:
        # A counter on an existing request: the next revision, not a new request.
        r = await _request(db, link, body.requestId)
        if r.status == m.STATUS_EXECUTED:
            raise HTTPException(status_code=409, detail="This quote is fully signed. Ask your Innowi contact for changes.")
        r.contact_name = body.contact.name
        r.contact_email = str(body.contact.email)
        r.contact_phone = body.contact.phone
        r.notes = body.notes
        rev = service.add_revision(db, r, author_kind=m.AUTHOR_RESTAURANT, author_name=body.contact.name,
                                   author_email=str(body.contact.email), note=body.notes, hardware_plan=plan,
                                   selections=kept, quote=quote)
        for e in service.void_signatures(r, actor=body.contact.name):
            db.add(e)
        r.status = m.STATUS_PROPOSED if service.public_show(r) else m.STATUS_REQUESTED
        r.declined_reason = None
        db.add(service.record_event(r, "REVISED_CLIENT", rev_no=rev.rev_no, actor=body.contact.name,
                                    ip=ip, user_agent=ua))
        event = "revised_client"
    else:
        r = m.QuoteRequest(
            number=service.new_request_number(), link_id=link.id, mode=link.mode,
            status=m.STATUS_PROPOSED if show else m.STATUS_REQUESTED,
            restaurant_name=body.restaurantName or link.restaurant_name, contact_name=body.contact.name,
            contact_email=str(body.contact.email), contact_phone=body.contact.phone, notes=body.notes,
            current_revision_no=0,
            hardware_plan=plan, selections=kept,
            lines=[line.as_dict() for line in quote.lines], one_time_total=quote.one_time_total,
            monthly_software_total=quote.monthly_software_total, monthly_lease_total=quote.monthly_lease_total,
            list_one_time_total=quote.list_one_time_total, list_monthly_total=quote.list_monthly_total,
            client_ip=ip, user_agent=ua, notified={},
        )
        db.add(r)
        await db.flush()  # the revision and event rows need r.id
        service.add_revision(db, r, author_kind=m.AUTHOR_RESTAURANT, author_name=body.contact.name,
                             author_email=str(body.contact.email), note=body.notes, hardware_plan=plan,
                             selections=kept, quote=quote)
        db.add(service.record_event(r, "SUBMITTED", rev_no=1, actor=body.contact.name, ip=ip, user_agent=ua))
        event = "submitted"
    await db.commit()
    await service.refresh_request(db, r)
    r.notified = {**(r.notified or {}), event: await notify.notify(event, r, link)}
    await db.commit()
    await service.refresh_request(db, r)
    return service.public_request_dto(r)


@router.get("/{token}/requests/{id}", response_model=dto.PublicRequestDto, response_model_exclude_none=True)
async def get_request(token: str, id: str, request: Request, db: AsyncSession = Depends(get_db)):
    link = await _link(db, token, request)
    r = await _request(db, link, id)
    # Evidence trail: record that the client opened it (at most one entry per gap).
    last = (await db.execute(
        select(m.QuoteEvent).where(m.QuoteEvent.request_id == r.id, m.QuoteEvent.kind == "VIEWED")
        .order_by(m.QuoteEvent.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    if last is None or (service.now() - last.created_at) > VIEW_EVENT_GAP:
        db.add(service.record_event(r, "VIEWED", rev_no=r.current_revision_no, actor=r.contact_email,
                                    ip=_client_ip(request), user_agent=_ua(request)))
        await db.commit()
        await service.refresh_request(db, r)
    return service.public_request_dto(r)


@router.post("/{token}/requests/{id}/sign", response_model=dto.PublicRequestDto, response_model_exclude_none=True)
async def sign(token: str, id: str, body: dto.SignDto, request: Request, db: AsyncSession = Depends(get_db)):
    """The client signs the current revision. Innowi countersigns in the Super App."""
    link = await _link(db, token, request)
    r = await _request(db, link, id)
    if not service.public_show(r):
        raise HTTPException(status_code=403, detail="Your Innowi contact will send the agreement for this quote")
    if r.status in (m.STATUS_SIGNED, m.STATUS_EXECUTED, m.STATUS_ACCEPTED):
        return service.public_request_dto(r)  # idempotent: the first signature stands
    if r.status != m.STATUS_PROPOSED:
        raise HTTPException(status_code=409, detail="This proposal can't be signed any more")
    if body.revisionNo != r.current_revision_no:
        raise HTTPException(status_code=409,
                            detail="This proposal was updated since you opened it. Reload to review the latest version, then sign.")
    try:
        data = signing.validate_signature_data(body.method, body.signatureData)
    except signing.SignatureDataError as e:
        raise HTTPException(status_code=400, detail=str(e))
    rev = service.current_revision(r)
    ip, ua = _client_ip(request), _ua(request)
    db.add(m.QuoteSignature(
        request_id=r.id, rev_no=r.current_revision_no, role=m.SIGN_CLIENT, name=body.name, title=body.title,
        email=r.contact_email, method=body.method, signature_data=data, consent_version=signing.CONSENT_VERSION,
        content_hash=rev.content_hash if rev else "", ip=ip, user_agent=ua,
    ))
    r.status = m.STATUS_SIGNED
    r.accepted_at = service.now()
    r.accepted_name = body.name
    r.accepted_title = body.title
    r.accepted_ip = ip
    db.add(service.record_event(r, "SIGNED_CLIENT", rev_no=r.current_revision_no, actor=body.name,
                                ip=ip, user_agent=ua))
    await db.commit()
    await service.refresh_request(db, r)
    r.notified = {**(r.notified or {}), "signed": await notify.notify("signed", r, link)}
    await db.commit()
    await service.refresh_request(db, r)
    return service.public_request_dto(r)


@router.post("/{token}/requests/{id}/decline", response_model=dto.PublicRequestDto, response_model_exclude_none=True)
async def decline(token: str, id: str, body: dto.DeclineDto, request: Request, db: AsyncSession = Depends(get_db)):
    link = await _link(db, token, request)
    r = await _request(db, link, id)
    if r.status not in (m.STATUS_PROPOSED, m.STATUS_REQUESTED):
        raise HTTPException(status_code=409, detail="This quote can't be declined any more")
    r.status = m.STATUS_DECLINED
    r.declined_reason = body.reason
    db.add(service.record_event(r, "DECLINED", rev_no=r.current_revision_no, actor=body.name,
                                detail={"reason": body.reason} if body.reason else None,
                                ip=_client_ip(request), user_agent=_ua(request)))
    await db.commit()
    await service.refresh_request(db, r)
    r.notified = {**(r.notified or {}), "declined": await notify.notify("declined", r, link)}
    await db.commit()
    await service.refresh_request(db, r)
    return service.public_request_dto(r)


@router.get("/{token}/requests/{id}/pdf")
async def request_pdf(token: str, id: str, request: Request, db: AsyncSession = Depends(get_db)):
    link = await _link(db, token, request)
    r = await _request(db, link, id)
    if not service.public_show(r):
        raise HTTPException(status_code=403, detail="Prices aren't shown on this quote")
    events = await service.list_events(db, r.id)
    body = pdf.render_proposal(r, prepared_by=link.created_by_email, valid_until=link.expires_at, events=events)
    return Response(content=body, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="Innowi-proposal-{r.number}.pdf"'})
