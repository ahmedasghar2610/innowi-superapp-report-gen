"""The merchant connector: how merchants link themselves to the other modules.

Settings (Settings → Data setup → Connector, stored in AppSetting "connector_settings"):

    modules              which modules are linked: seo, ads, gbp, website
    autoLinkSure         sure matches (same domain, same name apart from common words) link without asking
    runAfterCreate       a new merchant / an XLS import links its sure matches right after saving
    offerCreateMerchants SEO sites no merchant matches show up as "New merchant" rows (with their Ads account)
    ignoreDomains        websites / SEO domains never used to match (Innowi's own site, localhost)
    ignoreAdsNames       Ads accounts whose name contains one of these are never linked (Innowi's own)
    extraStopWords       extra words left out when comparing names (like "restaurant", "grill")

Also the per-merchant side: what is linked, what is suggested, link / unlink by hand, and
`connect()` which links the sure matches for some (or all) merchants.
"""
from __future__ import annotations

import re
from typing import Optional

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ads import AdsAccount
from app.models.gbp import GbpLocation
from app.models.ops import AppSetting
from app.models.profiling import Merchant
from app.models.seo import SeoSite

SETTINGS_KEY = "connector_settings"
MODULES = ("seo", "ads", "gbp", "website")
DEFAULTS: dict = {
    "modules": {"seo": True, "ads": True, "gbp": False, "website": True},
    "autoLinkSure": True,
    "runAfterCreate": True,
    "offerCreateMerchants": True,
    "ignoreDomains": ["innowi.com", "localhost", "127.0.0.1"],
    "ignoreAdsNames": ["innowi"],
    "extraStopWords": [],
}


def _words(v, lower: bool = True) -> list[str]:
    if isinstance(v, str):
        v = re.split(r"[,\n]", v)
    out: list[str] = []
    for x in v or []:
        x = str(x).strip()
        if lower:
            x = x.lower()
        if x and x not in out:
            out.append(x[:120])
    return out[:100]


def clean(raw: Optional[dict]) -> dict:
    """Defaults filled in, unknown keys dropped, lists tidied."""
    raw = raw or {}
    mods = {**DEFAULTS["modules"], **{k: bool(v) for k, v in (raw.get("modules") or {}).items() if k in MODULES}}
    out = {"modules": mods}
    for k in ("autoLinkSure", "runAfterCreate", "offerCreateMerchants"):
        out[k] = bool(raw[k]) if k in raw and raw[k] is not None else DEFAULTS[k]
    for k in ("ignoreDomains", "ignoreAdsNames", "extraStopWords"):
        out[k] = _words(raw[k]) if k in raw and raw[k] is not None else list(DEFAULTS[k])
    out["ignoreDomains"] = _words([re.sub(r"^www\.", "", re.sub(r"^https?://", "", d)).split("/")[0] for d in out["ignoreDomains"]])
    return out


async def get_settings(db: AsyncSession) -> dict:
    row = await db.get(AppSetting, SETTINGS_KEY)
    return clean(row.value if row else None)


async def save_settings(db: AsyncSession, value: dict) -> dict:
    v = clean(value)
    row = await db.get(AppSetting, SETTINGS_KEY)
    if row:
        row.value = v
    else:
        db.add(AppSetting(key=SETTINGS_KEY, value=v))
    await db.flush()
    return v


def domain_ignored(h: str, settings: dict) -> bool:
    h = (h or "").lower()
    return any(h == d or h.endswith("." + d) for d in settings["ignoreDomains"])


def ads_ignored(name: Optional[str], settings: dict) -> bool:
    n = (name or "").lower()
    return any(w in n for w in settings["ignoreAdsNames"])


# ------------------------------------------------------------ per merchant ---

MODELS = {"seo": SeoSite, "ads": AdsAccount, "gbp": GbpLocation}


def describe(module: str, o) -> dict:
    if module == "seo":
        return {"id": o.id, "name": o.name, "detail": o.domain, "url": o.home_url}
    if module == "ads":
        cid = o.customer_id or ""
        return {"id": o.id, "name": o.name, "detail": f"{cid[:3]}-{cid[3:6]}-{cid[6:]}" if len(cid) == 10 else cid, "state": o.state}
    return {"id": o.id, "name": o.title, "detail": ", ".join(x for x in (o.city, o.state) if x) or o.address_line}


def _usable(module: str):
    m = MODELS[module]
    conds = [m.source != "DEMO"]
    if module == "ads":
        conds.append(m.state != "ignored")
    return conds


async def connections(db: AsyncSession, merchant_id: str) -> dict:
    """Everything linked to one merchant, plus suggestions for the modules that are on."""
    from app.modules.linking import engine

    settings = await get_settings(db)
    out: dict = {"settings": {"modules": settings["modules"], "autoLinkSure": settings["autoLinkSure"]}, "modules": {}}
    for mod, model in MODELS.items():
        # Everything linked shows (sample rows too, so the tab and this list agree); only "ignored" Ads accounts don't.
        conds = [AdsAccount.state != "ignored"] if mod == "ads" else []
        rows = (await db.execute(select(model).where(model.merchant_id == merchant_id, *conds))).scalars().all()
        out["modules"][mod] = {"enabled": settings["modules"][mod], "linked": [describe(mod, r) for r in rows], "suggestions": []}
    plan = await engine.build_plan(db, settings=settings)
    for item in plan["sure"]:
        if item["merchantId"] == merchant_id and item["module"] in MODELS:
            out["modules"][item["module"]]["suggestions"].append(
                {"id": item["entityId"], "name": item["entity"], "detail": item["detail"], "score": 100, "reasons": item["reasons"], "sure": True})
    for item in plan["review"]:
        if item["module"] not in MODELS:
            continue
        c = next((c for c in item["candidates"] if c["merchantId"] == merchant_id), None)
        if c:
            out["modules"][item["module"]]["suggestions"].append(
                {"id": item["entityId"], "name": item["entity"], "detail": item["detail"], "score": c["score"], "reasons": c["reasons"], "sure": False})
    for m in out["modules"].values():
        m["suggestions"].sort(key=lambda s: -s["score"])
    return out


async def search(db: AsyncSession, module: str, q: str, limit: int = 20) -> list[dict]:
    """Records of a module that no merchant has yet, for picking by hand."""
    model = MODELS[module]
    conds = [model.merchant_id.is_(None), *_usable(module)]
    q = (q or "").strip()
    if q:
        like = f"%{q.lower()}%"
        if module == "seo":
            conds.append(or_(SeoSite.name.ilike(like), SeoSite.domain.ilike(like)))
        elif module == "ads":
            conds.append(or_(AdsAccount.name.ilike(like), AdsAccount.customer_id.ilike(f"%{re.sub(r'[^0-9]', '', q) or q}%")))
        else:
            conds.append(or_(GbpLocation.title.ilike(like), GbpLocation.city.ilike(like)))
    order = {"seo": SeoSite.domain, "ads": AdsAccount.name, "gbp": GbpLocation.title}[module]
    rows = (await db.execute(select(model).where(*conds).order_by(order).limit(limit))).scalars().all()
    return [describe(module, r) for r in rows]


class LinkError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


async def link(db: AsyncSession, merchant_id: str, module: str, entity_id: str) -> dict:
    model = MODELS[module]
    o = await db.get(model, entity_id)
    if not o or getattr(o, "source", None) == "DEMO":
        raise LinkError(404, "Record not found.")
    if o.merchant_id and o.merchant_id != merchant_id:
        other = await db.get(Merchant, o.merchant_id)
        raise LinkError(409, f"Already linked to {other.restaurant_name if other else 'another merchant'} — unlink it there first.")
    o.merchant_id = merchant_id
    if module == "seo":
        from app.modules.seo import data as seo_data
        await seo_data.link_by_domain(db, o)
    elif module == "ads":
        # SEO sites of this merchant without an Ads account get this one.
        for s in (await db.execute(select(SeoSite).where(SeoSite.merchant_id == merchant_id, SeoSite.ads_account_id.is_(None)))).scalars():
            s.ads_account_id = o.id
    await db.flush()
    return describe(module, o)


async def unlink(db: AsyncSession, merchant_id: str, module: str, entity_id: str) -> None:
    model = MODELS[module]
    o = await db.get(model, entity_id)
    if not o or o.merchant_id != merchant_id:
        raise LinkError(404, "That record isn't linked to this merchant.")
    o.merchant_id = None
    if module == "seo":
        # Its GBP listing / Ads account came through this merchant.
        if o.ads_account_id and (a := await db.get(AdsAccount, o.ads_account_id)) and a.merchant_id == merchant_id:
            o.ads_account_id = None
        if o.gbp_location_id and (g := await db.get(GbpLocation, o.gbp_location_id)) and g.merchant_id == merchant_id:
            o.gbp_location_id = None
    elif module in ("ads", "gbp"):
        col = SeoSite.ads_account_id if module == "ads" else SeoSite.gbp_location_id
        for s in (await db.execute(select(SeoSite).where(col == o.id))).scalars():
            setattr(s, "ads_account_id" if module == "ads" else "gbp_location_id", None)
    await db.flush()


async def connect(db: AsyncSession, merchant_ids: Optional[list[str]], user_id: Optional[str], *, automatic: bool = False) -> dict:
    """Link the sure matches for these merchants (None = every merchant). Recorded as a link run, so
    Data setup → Undo last run puts it back. `automatic` = after a create / import, honours runAfterCreate."""
    from app.modules.linking import engine

    settings = await get_settings(db)
    if not settings["autoLinkSure"] or (automatic and not settings["runAfterCreate"]):
        return {"skipped": True, "summary": {}}
    run = await engine.apply(db, {}, [], user_id, merchant_ids=set(merchant_ids) if merchant_ids is not None else None, settings=settings)
    return {"skipped": False, "id": run["id"], "summary": run["summary"]}


async def connect_quietly(db: AsyncSession, merchant_ids: list[str], user_id: Optional[str]) -> dict:
    """After a create / import: never let linking break the save that already happened."""
    try:
        return await connect(db, merchant_ids, user_id, automatic=True)
    except Exception:  # noqa: BLE001
        await db.rollback()
        return {"skipped": True, "summary": {}, "error": True}
