"""Link every module to its merchant in one go ("Data setup" in Settings).

Every module already keeps its own `merchant_id` (GBP listing, Google Ads account,
Website, SEO site). This module fills the empty ones across all of them:

    A. GBP listings  → merchants   ordering link · own website · phone · name + city
       (listings with no match can become new merchants, one per listing name)
    B. Ads accounts  → merchants   exact name · name of a linked GBP listing
    C. Websites      → merchants   exact name / phone, only when nothing conflicts
    D. SEO sites     → merchant    domain = merchant website · = a linked listing's website
                                   · domain spells the merchant's name
       then the site's GBP listing / Ads account through that merchant, and GA4 by host.

Rules: only empty links are filled (a link set by hand is never changed); sample
(DEMO) rows are never touched; "sure" matches apply directly, the rest wait for a
person in the review list. Each apply is recorded so the last run can be undone.
Nothing here calls Google.
Refreshing a module later never removes these links (the syncs don't write
merchant_id; SEO only fills empty ones).
"""
from __future__ import annotations

import collections
import datetime as dt
import os
import re
from difflib import SequenceMatcher
from dataclasses import dataclass, field
from typing import Iterable, Optional
from urllib.parse import urlparse

from sqlalchemy import delete, false, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.models.ads import AdsAccount
from app.models.common import cuid
from app.models.enums import ContactRole
from app.models.gbp import GbpLocation
from app.models.ops import AppSetting
from app.models.profiling import Contact, Location, Merchant
from app.models.seo import SeoConnection, SeoSite, utcnow
from app.models.sources import detail as source_detail
from app.models.website import Website

RUNS_KEY = "data_link_runs"
KEEP_RUNS = 5
NAME_STOP = {"the", "and", "restaurant", "grill", "kitchen", "cafe", "food", "halal", "authentic", "llc", "inc", "co", "bar", "house"}
DAYS = {"MONDAY": "Mon", "TUESDAY": "Tue", "WEDNESDAY": "Wed", "THURSDAY": "Thu", "FRIDAY": "Fri", "SATURDAY": "Sat", "SUNDAY": "Sun"}


# ----------------------------------------------------------------- helpers ---


def norm_name(v: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", (v or "").lower())


def name_tokens(v: Optional[str], extra_stop: Iterable[str] = ()) -> set[str]:
    stop = NAME_STOP | set(extra_stop) if extra_stop else NAME_STOP
    return {t for t in re.sub(r"[^a-z0-9 ]", " ", (v or "").lower()).split() if len(t) > 2 and t not in stop}


def ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio() if a and b else 0.0


def digits(v: Optional[str]) -> str:
    d = re.sub(r"\D", "", v or "")
    return d[-10:] if len(d) >= 10 else ""


def host(v: Optional[str]) -> str:
    v = (v or "").strip()
    if not v:
        return ""
    h = (urlparse(v if "://" in v else f"https://{v}").hostname or "").lower()
    return h[4:] if h.startswith("www.") else h


def norm_url(v: Optional[str]) -> str:
    v = (v or "").strip().lower()
    if not v:
        return ""
    p = urlparse(v if "://" in v else f"https://{v}")
    h = (p.hostname or "")
    h = h[4:] if h.startswith("www.") else h
    return f"{h}{p.path.rstrip('/')}"


def overlap(a: set[str], b: set[str]) -> float:
    return len(a & b) / max(1, len(a | b)) if a and b else 0.0


def hours_text(periods: list) -> Optional[str]:
    by: dict[str, list[str]] = collections.OrderedDict((d, []) for d in DAYS)
    for p in periods or []:
        d = p.get("day")
        if d in by:
            by[d].append(f"{p.get('open')}–{p.get('close')}")
    parts = [f"{DAYS[d]} {', '.join(v)}" for d, v in by.items() if v]
    return "; ".join(parts) or None


def _city(v: Optional[str]) -> str:
    return (v or "").strip().lower()


@dataclass
class MerchantIndex:
    """Merchants keyed every way a listing / account / site can point at one."""

    by_id: dict[str, Merchant]
    by_norm: dict[str, list[str]] = field(default_factory=lambda: collections.defaultdict(list))
    by_phone: dict[str, set[str]] = field(default_factory=lambda: collections.defaultdict(set))
    by_host: dict[str, set[str]] = field(default_factory=lambda: collections.defaultdict(set))
    by_order: dict[str, set[str]] = field(default_factory=lambda: collections.defaultdict(set))
    cities: dict[str, set[str]] = field(default_factory=lambda: collections.defaultdict(set))
    tokens: dict[str, set[str]] = field(default_factory=dict)
    token_df: collections.Counter = field(default_factory=collections.Counter)  # how many merchant names use each word
    shared_hosts: set[str] = field(default_factory=set)
    stop: set[str] = field(default_factory=set)  # extra words left out of names (connector settings)

    def ref(self, mid: str) -> dict:
        m = self.by_id[mid]
        city = next((l.city for l in m.locations or [] if l.is_primary and l.city), None) or next((l.city for l in m.locations or [] if l.city), None)
        return {"merchantId": mid, "name": m.restaurant_name, "city": city, "code": m.merchant_code}


async def merchant_index(db: AsyncSession, extra_hosts: Iterable[str] = (), extra_stop: Iterable[str] = ()) -> MerchantIndex:
    ms = (await db.execute(select(Merchant).options(selectinload(Merchant.locations), selectinload(Merchant.contacts)))).scalars().all()
    ix = MerchantIndex(by_id={m.id: m for m in ms}, stop=set(extra_stop))
    host_owners: dict[str, set[str]] = collections.defaultdict(set)
    for m in ms:
        ix.by_norm[norm_name(m.restaurant_name)].append(m.id)
        ix.tokens[m.id] = name_tokens(m.restaurant_name, ix.stop)
        ix.token_df.update(ix.tokens[m.id])
        for c in m.contacts or []:
            if digits(c.phone):
                ix.by_phone[digits(c.phone)].add(m.id)
        for l in m.locations or []:
            if l.city:
                ix.cities[m.id].add(_city(l.city))
        if host(m.website_url):
            host_owners[host(m.website_url)].add(m.id)
        if norm_url(m.online_ordering):
            ix.by_order[norm_url(m.online_ordering)].add(m.id)
            host_owners[host(m.online_ordering)].add(m.id)
    # A host used by several merchants (an ordering platform, a site builder) says nothing about which one.
    ix.shared_hosts = {h for h, owners in host_owners.items() if len(owners) > 1} | {h for h in extra_hosts if h}
    ix.shared_hosts |= {h for h in host_owners if h.endswith("innowi.com")}
    ignored = [h for h in extra_hosts if h]
    ix.shared_hosts |= {h for h in host_owners if any(h.endswith("." + d) for d in ignored)}
    for m in ms:
        h = host(m.website_url)
        if h and h not in ix.shared_hosts:
            ix.by_host[h].add(m.id)
    return ix


def _unique(ids: Iterable[str]) -> Optional[str]:
    s = set(ids)
    return next(iter(s)) if len(s) == 1 else None


# ------------------------------------------------------------------ matching ---


def match_listing(loc: GbpLocation, ix: MerchantIndex) -> tuple[Optional[str], list[str], list[dict]]:
    """(sure merchant id, reasons, review candidates) for one GBP listing."""
    sure: dict[str, list[str]] = collections.defaultdict(list)
    for u in (loc.ordering_url, loc.website_url):
        mid = _unique(ix.by_order.get(norm_url(u), ()))
        if norm_url(u) and mid:
            sure[mid].append("Same ordering link")
            break
    h = host(loc.website_url)
    if h and h not in ix.shared_hosts:
        mid = _unique(ix.by_host.get(h, ()))
        if mid:
            sure[mid].append("Same website")
    mid = _unique(ix.by_phone.get(digits(loc.phone), ())) if digits(loc.phone) else None
    if mid:
        sure[mid].append("Same phone")
    same_name = ix.by_norm.get(norm_name(loc.title), [])
    in_city = [m for m in same_name if _city(loc.city) and _city(loc.city) in ix.cities.get(m, set())]
    if len(in_city) == 1:
        sure[in_city[0]].append("Same name and city")
    elif len(same_name) == 1 and not ix.cities.get(same_name[0]):
        sure[same_name[0]].append("Same name")
    if len(sure) == 1:
        mid, reasons = next(iter(sure.items()))
        return mid, reasons, []
    cands = [{**ix.ref(m), "score": 90, "reasons": r} for m, r in sure.items()]
    if not cands:
        lt = name_tokens(loc.title, ix.stop)
        for m, mt in ix.tokens.items():
            o = overlap(lt, mt)
            # One shared distinctive word ("Atulya Express" vs "Atulya Bharat") is enough to ask rather than
            # create a duplicate merchant.
            shared = any(len(t) >= 5 and ix.token_df[t] <= 2 for t in lt & mt)  # a rare word, not "pizza"
            if o >= 0.5 or shared or (norm_name(loc.title) and norm_name(loc.title) == norm_name(ix.by_id[m].restaurant_name)):
                reasons = ["Same name" if o >= 0.99 else "Similar name" if o >= 0.5 else "Shares a name word"]
                score = int(60 * o) + (10 if shared else 0)
                if _city(loc.city) and _city(loc.city) in ix.cities.get(m, set()):
                    score, reasons = score + 20, reasons + ["Same city"]
                cands.append({**ix.ref(m), "score": score, "reasons": reasons})
    cands.sort(key=lambda c: -c["score"])
    return None, [], cands[:4]


def _contains(a: set[str], b: set[str], ix: MerchantIndex) -> bool:
    """One name is the other plus at most one word ("HolyLand" / "Holyland Restaurant and Catering")."""
    small, big = (a, b) if len(a) <= len(b) else (b, a)
    if not small or not small <= big or len(big - small) > 1:
        return False
    # A lone common word ("pizza") says nothing.
    return len(small) >= 2 or any(len(t) >= 5 and ix.token_df[t] <= 2 for t in small)


def match_account(acc: AdsAccount, ix: MerchantIndex, listing_names: dict[str, set[str]]) -> tuple[Optional[str], list[str], list[dict]]:
    n = norm_name(acc.name)
    mid = _unique(ix.by_norm.get(n, ()))
    if n and mid:
        return mid, ["Same name"], []
    mid = _unique(listing_names.get(n, ()))
    if n and mid:
        return mid, ["Same name as its GBP listing"], []
    at = name_tokens(acc.name, ix.stop)
    same_core = [m for m, mt in ix.tokens.items() if at and mt == at]
    if len(same_core) == 1:
        return same_core[0], ["Same name apart from common words"], []
    cands = []
    for m, mt in ix.tokens.items():
        nm = norm_name(ix.by_id[m].restaurant_name)
        r = ratio(n, nm)
        o = overlap(at, mt)
        if _contains(at, mt, ix):
            score, reasons = 85, ["One name contains the other"]
        elif r >= 0.8:
            score, reasons = min(89, int(100 * r)), ["Nearly the same name"]
        elif len(os.path.commonprefix([n, nm])) >= 8:
            score, reasons = 80, ["Names start the same"]
        elif o >= 0.5:
            score, reasons = int(80 * o), ["Similar name"]
        else:
            continue
        cands.append({**ix.ref(m), "score": score, "reasons": reasons})
    cands.sort(key=lambda c: -c["score"])
    return None, [], cands[:4]


def _label(domain: str) -> str:
    return norm_name(domain.split(".")[0]) if domain else ""


def match_site(site: SeoSite, ix: MerchantIndex, listing_hosts: dict[str, set[str]]) -> tuple[Optional[str], list[str], list[dict]]:
    d = host(site.domain)
    mid = _unique(ix.by_host.get(d, ())) if d and d not in ix.shared_hosts else None
    if mid:
        return mid, ["Merchant website is this domain"], []
    mid = _unique(listing_hosts.get(d, ()))
    if mid:
        return mid, ["Its GBP listing links to this domain"], []
    lab = _label(d)
    mid = _unique(ix.by_norm.get(lab, ())) if len(lab) >= 5 else None
    if mid:
        return mid, ["Domain spells the merchant's name"], []
    cands = []
    for m in ix.by_id.values():
        mh = host(m.website_url)
        if lab and mh and mh not in ix.shared_hosts and mh != d:
            r = ratio(lab, _label(mh))
            if r >= 0.8:
                cands.append({**ix.ref(m.id), "score": min(89, int(100 * r)), "reasons": [f"Domain is close to the merchant's website ({mh})"]})
                continue
        if len(lab) >= 5:
            nm = norm_name(m.restaurant_name)
            if len(nm) >= 5 and (nm in lab or lab in nm):
                cands.append({**ix.ref(m.id), "score": 60, "reasons": ["Domain contains the merchant's name"]})
    cands.sort(key=lambda c: -c["score"])
    return None, [], cands[:4]


def website_name(w: Website) -> str:
    v = w.values or {}
    return ((v.get("business") or {}).get("name") or w.name or "").strip()


def website_phone(w: Website) -> str:
    return digits(((w.values or {}).get("business") or {}).get("phone"))


# ---------------------------------------------------------------------- plan ---


def _gbp_label(loc: GbpLocation) -> str:
    return ", ".join(x for x in (loc.city, loc.state) if x) or (loc.address_line or "")


SUGGEST_AT = 85  # a review candidate this good (and clearly ahead of the next) is pre-chosen


def _suggest(cands: list[dict]) -> Optional[str]:
    if cands and cands[0]["score"] >= SUGGEST_AT and (len(cands) == 1 or cands[1]["score"] < cands[0]["score"] - 5):
        return cands[0]["merchantId"]
    return None


async def build_plan(db: AsyncSession, decisions: Optional[dict] = None, settings: Optional[dict] = None) -> dict:
    """What "Link all" would do right now. `decisions` (review choices) only matter on apply.
    `settings` = the connector settings (modules on/off, ignore lists); loaded when not given."""
    from app.modules.linking import connector
    from app.modules.websites import merchant_link

    cfg = settings or await connector.get_settings(db)
    on = cfg["modules"]
    ix = await merchant_index(db, extra_hosts=cfg["ignoreDomains"], extra_stop=cfg["extraStopWords"])
    out: dict = {"modules": {}, "sure": [], "review": [], "create": [], "unmatched": [],
                 "settings": {"modules": on, "offerCreateMerchants": cfg["offerCreateMerchants"]}}

    # A. GBP listings ---------------------------------------------------------
    locs = (await db.execute(select(GbpLocation).where(GbpLocation.source != "DEMO"))).scalars().all() if on["gbp"] else []
    listing_merchant = {l.id: l.merchant_id for l in locs if l.merchant_id}
    unmatched_locs = []
    for loc in locs:
        if loc.merchant_id:
            continue
        mid, reasons, cands = match_listing(loc, ix)
        item = {"id": f"gbp:{loc.id}", "module": "gbp", "entityId": loc.id, "entity": loc.title, "detail": _gbp_label(loc)}
        if mid:
            out["sure"].append({**item, **ix.ref(mid), "reasons": reasons})
            listing_merchant[loc.id] = mid
        elif cands:
            out["review"].append({**item, "candidates": cands, "canCreate": True, "suggested": _suggest(cands)})
        else:
            unmatched_locs.append(loc)
    groups: dict[str, list[GbpLocation]] = collections.defaultdict(list)
    for loc in unmatched_locs:
        groups[norm_name(loc.title) or loc.id].append(loc)
    for key, ls in groups.items():
        out["create"].append({
            "id": f"create:{key}", "name": ls[0].title, "category": ls[0].primary_category,
            "phone": ls[0].phone, "ordering": ls[0].ordering_url or (ls[0].website_url if host(ls[0].website_url) in ix.shared_hosts else None),
            "listings": [{"id": l.id, "title": l.title, "detail": _gbp_label(l)} for l in ls],
        })
    out["modules"]["gbp"] = {"total": len(locs), "linked": sum(1 for l in locs if l.merchant_id), "enabled": on["gbp"]}

    # Names / hosts of listings that are (or are about to be) linked.
    listing_names: dict[str, set[str]] = collections.defaultdict(set)
    listing_hosts: dict[str, set[str]] = collections.defaultdict(set)
    for loc in locs:
        mid = listing_merchant.get(loc.id)
        if mid:
            listing_names[norm_name(loc.title)].add(mid)
            h = host(loc.website_url)
            if h and h not in ix.shared_hosts:
                listing_hosts[h].add(mid)

    # B. Ads accounts ---------------------------------------------------------
    accs = (await db.execute(select(AdsAccount).where(AdsAccount.source != "DEMO", AdsAccount.state != "ignored"))).scalars().all() if on["ads"] else []
    accs = [a for a in accs if not connector.ads_ignored(a.name, cfg)]
    acc_by_id = {a.id: a for a in accs}
    for acc in accs:
        if acc.merchant_id:
            continue
        mid, reasons, cands = match_account(acc, ix, listing_names)
        cid = acc.customer_id or ""
        item = {"id": f"ads:{acc.id}", "module": "ads", "entityId": acc.id, "entity": acc.name,
                "detail": f"{cid[:3]}-{cid[3:6]}-{cid[6:]}" if len(cid) == 10 else cid}
        if mid:
            out["sure"].append({**item, **ix.ref(mid), "reasons": reasons})
        elif cands:
            out["review"].append({**item, "candidates": cands, "suggested": _suggest(cands)})
        else:
            out["unmatched"].append(item)
    out["modules"]["ads"] = {"total": len(accs), "linked": sum(1 for a in accs if a.merchant_id), "enabled": on["ads"]}

    # C. Websites (managed sites) ---------------------------------------------
    sites = (await db.execute(select(Website))).scalars().all() if on["website"] else []
    for w in sites:
        if w.merchant_id:
            continue
        item = {"id": f"website:{w.id}", "module": "website", "entityId": w.id, "entity": website_name(w) or w.slug, "detail": f"/{w.slug}"}
        n = norm_name(website_name(w))
        mid = _unique(ix.by_norm.get(n, ())) if n else None
        reasons = ["Same name"] if mid else []
        if not mid and website_phone(w):
            mid = _unique(ix.by_phone.get(website_phone(w), ()))
            reasons = ["Same phone"] if mid else []
        if mid:
            m = await merchant_link.load_merchant(db, mid)
            clash = merchant_link.conflicts(w, m) if m else []
            if not clash:
                out["sure"].append({**item, **ix.ref(mid), "reasons": reasons})
            else:
                out["review"].append({**item, "candidates": [{**ix.ref(mid), "score": 80, "reasons": reasons}], "manual": True,
                                      "note": f"{len(clash)} field(s) differ from the Profile — link it on the Website page so you can choose which value wins."})
        else:
            out["unmatched"].append(item)
    out["modules"]["website"] = {"total": len(sites), "linked": sum(1 for w in sites if w.merchant_id), "enabled": on["website"]}

    # D. SEO sites ------------------------------------------------------------
    seo = (await db.execute(select(SeoSite).where(SeoSite.source != "DEMO"))).scalars().all() if on["seo"] else []
    seo = [s for s in seo if not connector.domain_ignored(host(s.domain), cfg)]
    lonely_sites: list[SeoSite] = []
    for s in seo:
        if s.merchant_id:
            continue
        mid, reasons, cands = match_site(s, ix, listing_hosts)
        item = {"id": f"seo:{s.id}", "module": "seo", "entityId": s.id, "entity": s.name, "detail": s.domain}
        if mid:
            out["sure"].append({**item, **ix.ref(mid), "reasons": reasons})
        elif cands:
            out["review"].append({**item, "candidates": cands, "suggested": _suggest(cands)})
        else:
            lonely_sites.append(s)
    out["modules"]["seo"] = {"total": len(seo), "linked": sum(1 for s in seo if s.merchant_id), "enabled": on["seo"]}

    # E. SEO sites no merchant matches → new merchants, with the Ads account that goes with them.
    lonely_ads = {i["entityId"] for i in out["unmatched"] if i["module"] == "ads"}
    for s in lonely_sites:
        item = {"id": f"seo:{s.id}", "module": "seo", "entityId": s.id, "entity": s.name, "detail": s.domain}
        if not cfg["offerCreateMerchants"]:
            out["unmatched"].append(item)
            continue
        acc, why = _pair_account(s, acc_by_id, lonely_ads)
        if acc:
            lonely_ads.discard(acc.id)
        name = acc.name if acc else (s.name if s.name and s.name != s.domain else s.domain)
        out["create"].append({
            "id": f"create:seo:{s.id}", "kind": "seo", "name": name, "category": None, "phone": None, "ordering": None,
            "website": f"https://{host(s.domain)}", "listings": [],
            "seo": {"id": s.id, "domain": s.domain}, "ads": {"id": acc.id, "name": acc.name, "why": why} if acc else None,
            "preselect": bool(acc),
        })
    out["unmatched"] = [i for i in out["unmatched"] if not (i["module"] == "ads" and i["entityId"] not in lonely_ads)]
    out["create"].sort(key=lambda g: (not g.get("preselect", True), (g["name"] or "").lower()))
    out["counts"] = {"sure": len(out["sure"]), "review": len(out["review"]), "create": len(out["create"]),
                     "createListings": sum(len(c["listings"]) for c in out["create"]), "unmatched": len(out["unmatched"])}
    out["merchants"] = len(ix.by_id)
    return out


def _pair_account(s: SeoSite, acc_by_id: dict[str, AdsAccount], free: set[str]) -> tuple[Optional[AdsAccount], Optional[str]]:
    """The Ads account that belongs with an SEO site no merchant has: the one the site already points
    at, or the one whose name is the domain ("Cairo Grill" / cairogrill.us)."""
    if s.ads_account_id in free:
        return acc_by_id[s.ads_account_id], "The site already uses this Ads account"
    lab = _label(host(s.domain))
    best: tuple[float, Optional[AdsAccount]] = (0.0, None)
    for aid in free:
        a = acc_by_id[aid]
        if a.state != "active":
            continue
        n = norm_name(a.name)
        if len(lab) >= 5 and len(n) >= 5 and (n == lab or n in lab or lab in n):
            r = 1.0 if n == lab else 0.95
        else:
            r = ratio(lab, n)
        if r >= 0.85 and r > best[0]:
            best = (r, a)
    return (best[1], "Ads account name matches the domain") if best[1] else (None, None)


# --------------------------------------------------------------------- apply ---


async def _create_from_listings(db: AsyncSession, ls: list[GbpLocation], shared_hosts: set[str]) -> Merchant:
    first = ls[0]
    own_site = first.website_url if host(first.website_url) and host(first.website_url) not in shared_hosts else None
    ordering = first.ordering_url or (first.website_url if not own_site else None)
    code = (first.store_code or "").strip() or None
    if code and (await db.execute(select(Merchant.id).where(Merchant.merchant_code == code))).scalar_one_or_none():
        code = None
    m = Merchant(restaurant_name=first.title, merchant_code=code, cuisine_category=first.primary_category, website_url=own_site,
                 online_ordering=ordering, notes="Created from Google Business Profile (Settings → Data setup).",
                 source="GOOGLE_PROFILE", source_detail=source_detail(first.title))
    db.add(m)
    await db.flush()
    for i, l in enumerate(ls):
        db.add(Location(merchant_id=m.id, address=l.address_line, city=l.city, state=l.state, zip=l.postal_code,
                        hours=hours_text(l.regular_hours), is_primary=i == 0))
    if first.phone:
        db.add(Contact(merchant_id=m.id, role=ContactRole.OWNER, phone=first.phone))
    return m


async def _create_from_seo(db: AsyncSession, grp: dict) -> Optional[Merchant]:
    s = await db.get(SeoSite, grp["seo"]["id"])
    if not s or s.merchant_id:
        return None
    m = Merchant(restaurant_name=grp["name"][:255], website_url=grp["website"],
                 notes="Created from its SEO site / Google Ads account (Settings → Data setup).",
                 source="SEO_ADS", source_detail=source_detail(grp["website"]))
    db.add(m)
    await db.flush()
    return m


async def apply(db: AsyncSession, decisions: dict, create_keys: Optional[list[str]], user_id: Optional[str],
                merchant_ids: Optional[set[str]] = None, settings: Optional[dict] = None) -> dict:
    """Apply sure matches, the person's review choices and the merchants to create.

    decisions: {"gbp:<id>": "<merchantId>" | "create" | "skip", "ads:<id>": ..., "seo:<id>": ...}
    create_keys: create:<key> groups to turn into merchants (None = all the pre-ticked ones).
    merchant_ids: only link sure matches for these merchants (the connector after a create / import)."""
    from app.modules.linking import connector
    from app.modules.merchant_profiling.completeness_service import refresh_completion_cache
    from app.modules.seo import data as seo_data
    from app.modules.websites import merchant_link

    cfg = settings or await connector.get_settings(db)
    started = utcnow()
    changes: list[dict] = []
    summary = collections.Counter()
    touched_merchants: set[str] = set()

    def in_scope(item: dict) -> bool:
        return merchant_ids is None or item.get("merchantId") in merchant_ids

    # A. GBP --------------------------------------------------------------------
    plan = await build_plan(db, settings=cfg)
    ix = await merchant_index(db, extra_hosts=cfg["ignoreDomains"], extra_stop=cfg["extraStopWords"])
    sure = {i["id"]: i for i in plan["sure"] if in_scope(i)}
    review = {i["id"]: i for i in plan["review"]}
    for item in list(sure.values()) + list(review.values()):
        if item["module"] != "gbp":
            continue
        choice = item.get("merchantId") if item["id"] in sure else decisions.get(item["id"])
        loc = await db.get(GbpLocation, item["entityId"])
        if not loc or loc.merchant_id:
            continue
        if choice == "create":
            m = await _create_from_listings(db, [loc], ix.shared_hosts)
            changes.append({"k": "merchant", "id": m.id})
            summary["merchantsCreated"] += 1
            choice = m.id
        if choice in (None, "skip") or (choice not in ix.by_id and not await db.get(Merchant, choice)):
            continue
        if True:
            changes.append({"k": "gbp", "id": loc.id, "old": None})
            loc.merchant_id = choice
            touched_merchants.add(choice)
            summary["gbp"] += 1
    wanted = None if create_keys is None else set(create_keys)
    for grp in plan["create"]:
        if (wanted is None and not grp.get("preselect", True)) or (wanted is not None and grp["id"] not in wanted):
            continue
        if grp.get("kind") == "seo":
            m = await _create_from_seo(db, grp)
            if not m:
                continue
            changes.append({"k": "merchant", "id": m.id})
            summary["merchantsCreated"] += 1
            s = await db.get(SeoSite, grp["seo"]["id"])
            changes.append({"k": "seo", "id": s.id, "field": "merchant_id", "old": None})
            s.merchant_id = m.id
            summary["seo"] += 1
            acc = await db.get(AdsAccount, grp["ads"]["id"]) if grp.get("ads") else None
            if acc and not acc.merchant_id:
                changes.append({"k": "ads", "id": acc.id, "old": None})
                acc.merchant_id = m.id
                summary["ads"] += 1
            touched_merchants.add(m.id)
            continue
        ls = [l for l in [await db.get(GbpLocation, x["id"]) for x in grp["listings"]] if l and not l.merchant_id]
        if not ls:
            continue
        m = await _create_from_listings(db, ls, ix.shared_hosts)
        changes.append({"k": "merchant", "id": m.id})
        summary["merchantsCreated"] += 1
        for l in ls:
            changes.append({"k": "gbp", "id": l.id, "old": None})
            l.merchant_id = m.id
            summary["gbp"] += 1
        touched_merchants.add(m.id)
    await db.flush()

    # B–D: recompute with the new GBP links in place ---------------------------
    plan = await build_plan(db, settings=cfg)
    sure = {i["id"]: i for i in plan["sure"] if in_scope(i)}
    review = {i["id"]: i for i in plan["review"] if not i.get("manual")}
    for item in list(sure.values()) + list(review.values()):
        mod = item["module"]
        if mod == "gbp":
            continue
        choice = item.get("merchantId") if item["id"] in sure else decisions.get(item["id"])
        if not choice or choice in ("skip", "create") or not await db.get(Merchant, choice):
            continue
        if mod == "ads":
            acc = await db.get(AdsAccount, item["entityId"])
            if acc and not acc.merchant_id:
                changes.append({"k": "ads", "id": acc.id, "old": None})
                acc.merchant_id = choice
                summary["ads"] += 1
                touched_merchants.add(choice)
        elif mod == "seo":
            s = await db.get(SeoSite, item["entityId"])
            if s and not s.merchant_id:
                changes.append({"k": "seo", "id": s.id, "field": "merchant_id", "old": None})
                s.merchant_id = choice
                summary["seo"] += 1
        elif mod == "website" and item["id"] in sure:
            changes.append({"k": "website-pending", "id": item["entityId"], "merchant": choice})
    await db.flush()

    # D2. Every SEO site with a merchant gets its GBP listing / Ads account / GA4 (empty fields only).
    conn = (await db.execute(select(SeoConnection).limit(1))).scalar_one_or_none()
    ga4_by_host: dict[str, list[dict]] = collections.defaultdict(list)
    for p in (conn.ga4_properties if conn else []) or []:
        for h in p.get("hosts") or []:
            ga4_by_host[host(h)].append(p)
    changed_sites = []
    site_q = select(SeoSite).where(SeoSite.source != "DEMO")
    if merchant_ids is not None:
        site_q = site_q.where(SeoSite.merchant_id.in_(merchant_ids | touched_merchants))
    if not cfg["modules"]["seo"]:
        site_q = site_q.where(false())
    for s in (await db.execute(site_q)).scalars().all():
        before = {"merchant_id": s.merchant_id, "gbp_location_id": s.gbp_location_id, "ads_account_id": s.ads_account_id, "ga4_property": s.ga4_property,
                  "ga4_name": s.ga4_name, "name": s.name}
        await seo_data.link_by_domain(db, s)
        if not s.ga4_property and len(ga4_by_host.get(host(s.domain), [])) == 1:
            p = ga4_by_host[host(s.domain)][0]
            s.ga4_property, s.ga4_name = p["property"], p.get("name")
        for f, old in before.items():
            if getattr(s, f) != old:
                if not any(c["k"] == "seo" and c["id"] == s.id and c["field"] == f for c in changes):
                    changes.append({"k": "seo", "id": s.id, "field": f, "old": old})
                summary["seoFields"] += 1 if f not in ("merchant_id", "name") else 0
        if any(getattr(s, f) != old for f, old in before.items()) or any(c["k"] == "seo" and c["id"] == s.id for c in changes):
            changed_sites.append(s)
    await db.commit()

    # C. Websites: their own link routine (commits; keeps the Profile as the source of truth).
    for c in [c for c in changes if c["k"] == "website-pending"]:
        w = await db.get(Website, c["id"])
        m = await merchant_link.load_merchant(db, c["merchant"])
        if w and m and not w.merchant_id and not merchant_link.conflicts(w, m):
            await merchant_link.link(db, w, m)
            c["k"] = "website"
            summary["website"] += 1
            touched_merchants.add(m.id)
    changes = [c for c in changes if c["k"] != "website-pending"]

    # Scores pick up the new Local / Paid links; Profile completeness picks up new locations.
    psi = bool(get_settings().PAGESPEED_API_KEY)
    for s in changed_sites:
        try:
            await seo_data.recompute(db, s, psi_configured=psi)
        except Exception:  # a score refresh must never undo the links
            pass
    await db.commit()
    for mid in touched_merchants:
        try:
            await refresh_completion_cache(db, mid)
        except Exception:
            pass
    await db.commit()

    run = {"id": cuid(), "at": started.isoformat(), "finishedAt": utcnow().isoformat(), "by": user_id,
           "summary": dict(summary), "changes": changes, "undone": False}
    if changes:  # an empty run would only push a real one out of "Undo last run"
        await _save_run(db, run)
    return run


async def _runs(db: AsyncSession) -> list[dict]:
    row = await db.get(AppSetting, RUNS_KEY)
    return list((row.value or {}).get("runs", [])) if row else []


async def _save_run(db: AsyncSession, run: dict) -> None:
    row = await db.get(AppSetting, RUNS_KEY)
    runs = ([run] + (await _runs(db)))[:KEEP_RUNS]
    if row:
        row.value = {"runs": runs}
    else:
        db.add(AppSetting(key=RUNS_KEY, value={"runs": runs}))
    await db.commit()


async def last_run(db: AsyncSession) -> Optional[dict]:
    runs = await _runs(db)
    return runs[0] if runs else None


async def undo_last(db: AsyncSession) -> dict:
    """Put back every link the last run filled; delete merchants it created unless edited since."""
    from app.modules.websites import merchant_link

    runs = await _runs(db)
    run = next((r for r in runs if not r.get("undone")), None)
    if not run:
        return {"undone": 0, "kept": []}
    n, kept = 0, []
    for c in reversed(run["changes"]):
        k = c["k"]
        if k == "gbp":
            o = await db.get(GbpLocation, c["id"])
            if o:
                o.merchant_id, n = c["old"], n + 1
        elif k == "ads":
            o = await db.get(AdsAccount, c["id"])
            if o:
                o.merchant_id, n = c["old"], n + 1
        elif k == "seo":
            o = await db.get(SeoSite, c["id"])
            if o:
                setattr(o, c["field"], c["old"])
                n += 1
        elif k == "website":
            w = await db.get(Website, c["id"])
            if w and w.merchant_id:
                await merchant_link.unlink(db, w)
                n += 1
    await db.flush()
    finished = dt.datetime.fromisoformat(run["finishedAt"])
    for c in run["changes"]:
        if c["k"] != "merchant":
            continue
        m = await db.get(Merchant, c["id"])
        if not m:
            continue
        still = 0
        for model in (GbpLocation, AdsAccount, SeoSite, Website):
            still += (await db.execute(select(func.count()).select_from(model).where(model.merchant_id == m.id))).scalar_one()
        edited = m.updated_at and m.updated_at > finished + dt.timedelta(minutes=2)
        if still or edited:
            kept.append(m.restaurant_name)
            continue
        # Database-level delete: its locations / contacts / other profile rows go with it (ON DELETE CASCADE).
        await db.execute(delete(Merchant).where(Merchant.id == m.id))
        n += 1
    run["undone"] = True
    row = await db.get(AppSetting, RUNS_KEY)
    row.value = {"runs": runs}
    await db.commit()
    return {"undone": n, "kept": kept}


# ------------------------------------------------------------------ coverage ---


async def coverage(db: AsyncSession) -> dict:
    """One row per merchant: what each module has for it, and what's missing."""
    ms = (await db.execute(select(Merchant.id, Merchant.restaurant_name, Merchant.merchant_code, Merchant.website_url, Merchant.online_ordering)
                           .order_by(Merchant.restaurant_name))).all()

    async def per(model, *conds):
        q = select(model.merchant_id, func.count()).where(model.merchant_id.is_not(None), *conds).group_by(model.merchant_id)
        return dict((await db.execute(q)).all())

    gbp = await per(GbpLocation, GbpLocation.source != "DEMO")
    ads = await per(AdsAccount, AdsAccount.source != "DEMO", AdsAccount.state != "ignored")
    web = await per(Website)
    seo_rows = (await db.execute(select(SeoSite.merchant_id, SeoSite.gsc_property, SeoSite.ga4_property, SeoSite.domain)
                                 .where(SeoSite.merchant_id.is_not(None), SeoSite.source != "DEMO"))).all()
    seo: dict[str, dict] = {}
    for mid, gsc, ga4, dom in seo_rows:
        r = seo.setdefault(mid, {"sites": 0, "gsc": False, "ga4": False, "domains": []})
        r["sites"] += 1
        r["gsc"] = r["gsc"] or bool(gsc)
        r["ga4"] = r["ga4"] or bool(ga4)
        r["domains"].append(dom)
    rows = []
    for mid, name, code, site, order in ms:
        s = seo.get(mid)
        rows.append({"merchantId": mid, "name": name, "code": code, "websiteUrl": site, "onlineOrdering": order,
                     "gbp": gbp.get(mid, 0), "ads": ads.get(mid, 0), "websites": web.get(mid, 0),
                     "seoSites": s["sites"] if s else 0, "gsc": bool(s and s["gsc"]), "ga4": bool(s and s["ga4"]),
                     "domains": s["domains"] if s else []})

    async def orphans(model, *conds):
        return (await db.execute(select(func.count()).select_from(model).where(model.merchant_id.is_(None), *conds))).scalar_one()

    return {
        "rows": rows,
        "unlinked": {"gbp": await orphans(GbpLocation, GbpLocation.source != "DEMO"),
                     "ads": await orphans(AdsAccount, AdsAccount.source != "DEMO", AdsAccount.state != "ignored"),
                     "website": await orphans(Website), "seo": await orphans(SeoSite, SeoSite.source != "DEMO")},
        "accessEmail": (await db.execute(select(SeoConnection.google_email).limit(1))).scalar_one_or_none(),
    }
