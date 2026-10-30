"""Monthly client report in the SEO team's format (Zainab's September 2026 reports).

Sections: alert box · executive summary · key metrics + 4-month table · branded vs
non-branded · highlighted finding · top queries · pages · devices · countries ·
recommendations · sources & data notes.

Everything is computed from synced data; the written parts (summary, highlight,
recommendations) are sentence templates chosen by rules — no AI, no estimates.
Each template group has a few wordings, rotated by month so reports don't read
the same every time. The analyst can edit the summary before sign-off.

`build()` collects the numbers (async, database); everything else is pure and
unit-tested in tests/test_seo_logic.py.
"""
from __future__ import annotations

import datetime as dt
import re
from typing import Optional
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.seo import SeoGscPage, SeoGscQuery, SeoGscSplit, SeoSite
from app.modules.seo import data

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

# Words that don't make a search "branded" on their own (cuisine, place type, filler).
GENERIC = set("""
restaurant restaurants grill grille grillhouse cafe café kitchen bar house food foods pizza pizzeria wings wing kabob kebab kabab kabobs
kebabs taqueria cuisine mediterranean mexican indian pakistani afghan persian halal bistro bakery the and of de la el los las del
express fresh sushi burger burgers bbq deli diner pho thai chinese coffee tea market bazaar eatery cantina taco tacos shawarma gyro
gyros biryani curry chicken sandwich sandwiches noodle noodles ramen steakhouse seafood plus co company inc llc sv sj nyc ny ca
order online menu near me best spot place shop corner express station
""".split())

# Words that have no business on a restaurant site: injected / hacked spam pages (casino, adult, pharma, loans…).
SPAM_WORDS = ["casino", "slot", "slots", "onlyfans", "porn", "xxx", "escort", "viagra", "cialis", "pharmacy", "payday", "loan", "loans",
              "crypto", "bitcoin", "betting", "sportsbook", "poker", "roulette", "jackpot", "replica", "essay", "dating", "hookup",
              "nude", "sex", "vape", "cbd", "forex", "binary-options"]
# Searches too broad for their own landing page ("food near me", "restaurants near me").
PLAIN_WORDS = set("food foods restaurant restaurants near me open now best places place to eat good cheap takeout delivery dinner lunch".split())

_SPAM_RE = re.compile(r"(?<![a-z])(" + "|".join(re.escape(w) for w in SPAM_WORDS) + r")(?![a-z])", re.I)


# ------------------------------------------------------------------ helpers ----

def month_label(m: dt.date) -> str:
    return f"{MONTHS[m.month - 1]} {m.year}"


def pct_change(cur: float, prev: float) -> Optional[float]:
    return None if not prev else (cur - prev) / prev


def _n(v) -> str:
    return f"{round(v):,}"


def _pct(v: Optional[float], digits: int = 1) -> str:
    return "—" if v is None else f"{v * 100:.{digits}f}%"


def _chg(v: Optional[float]) -> str:
    return "—" if v is None else f"{v * 100:+.1f}%"


def _pick(options: list[str], seed: int) -> str:
    return options[seed % len(options)]


def _edit1(a: str, b: str) -> bool:
    """True when a and b are equal or one edit apart (typos, swapped letters, kabob/kabab-style spellings)."""
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        diff = [i for i, (x, y) in enumerate(zip(a, b)) if x != y]
        if len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]]:
            return True  # swapped letters: fusoin / fusion
        return len(diff) == 1
    s, t = (a, b) if len(a) < len(b) else (b, a)
    return any(s == t[:i] + t[i + 1:] for i in range(len(t)))


# ------------------------------------------------------------- branded split ----

def brand_tokens(name: str, domain: str) -> list[str]:
    """Distinctive words of the restaurant's name ("Kabob Fusion" → ["fusion"]); falls back to all name words
    when every word is generic ("Pizza Wings" → ["pizza", "wings"], all of which must then appear)."""
    words = [w for w in re.findall(r"[a-z]+", (name or "").lower()) if len(w) > 1 and w not in ("com", "net", "org", "www", "us", "co")]
    distinctive = [w for w in words if w not in GENERIC and len(w) >= 3]
    return distinctive or words


def is_branded(query: str, tokens: list[str], name: str, domain: str = "") -> bool:
    q = re.findall(r"[a-z0-9]+", query.lower())
    compact = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    if compact and compact in "".join(q):
        return True
    stem = re.sub(r"[^a-z]", "", (domain or "").lower().split(".")[0])
    joined = "".join(q)
    if len(joined) >= 6 and stem and joined in stem:
        return True  # "kabob fusion" inside orderkabobfusion.com
    all_generic = all(t in GENERIC for t in tokens)
    hits = [any(_edit1(t, w) if len(t) >= 5 else t == w for w in q) for t in tokens]
    return all(hits) if all_generic else any(hits)


def branded_split(rows: list[dict], name: str, domain: str) -> dict:
    """rows: [{"query", "clicks", "impressions"}] for one month."""
    tokens = brand_tokens(name, domain)
    out = {"branded": {"clicks": 0, "impressions": 0, "queries": 0}, "generic": {"clicks": 0, "impressions": 0, "queries": 0}, "tokens": tokens}
    for r in rows:
        k = "branded" if is_branded(r["query"], tokens, name, domain) else "generic"
        out[k]["clicks"] += r["clicks"]
        out[k]["impressions"] += r["impressions"]
        out[k]["queries"] += 1
    for k in ("branded", "generic"):
        b = out[k]
        b["ctr"] = round(b["clicks"] / b["impressions"], 4) if b["impressions"] else None
    total = out["branded"]["clicks"] + out["generic"]["clicks"]
    out["trackedClicks"] = total
    out["brandedShare"] = round(out["branded"]["clicks"] / total, 4) if total else None
    return out


# ---------------------------------------------------------------- spam check ----

def spam_pages(cur: list[dict], prev: list[dict]) -> list[dict]:
    """Pages whose address contains casino / adult / pharma / loan words: injected spam on a hacked site.
    cur/prev: [{"path", "impressions", "position"}]. Status: new / still indexed / faded."""
    pc = {p["path"]: p for p in cur if _SPAM_RE.search(p["path"].replace("_", "-"))}
    pp = {p["path"]: p for p in prev if _SPAM_RE.search(p["path"].replace("_", "-"))}
    out = []
    for path in sorted(set(pc) | set(pp), key=lambda x: -(pc.get(x, {}).get("impressions") or 0)):
        c, p = pc.get(path), pp.get(path)
        out.append({"path": path, "impressions": c["impressions"] if c else 0, "prevImpressions": p["impressions"] if p else 0,
                    "position": round(c["position"], 2) if c and c.get("position") else None,
                    "status": "new" if c and not p else ("still indexed" if c else "faded")})
    return out


def spam_queries(rows: list[dict]) -> list[str]:
    return [r["query"] for r in rows if _SPAM_RE.search(r["query"])][:5]


# -------------------------------------------------------------- opportunities ----

def opportunities(queries: list[dict], tokens: list[str], name: str, domain: str = "") -> dict:
    """page_two: generic searches with real demand sitting on page two (position 8–25) and almost no clicks.
    page_one_no_clicks: shown on page one (≤ 10) to many people but not chosen."""
    gen = [q for q in queries if not is_branded(q["query"], tokens, name, domain)]
    page_two = sorted([q for q in gen if q["impressions"] >= 150 and q["position"] and 8 <= q["position"] <= 25
                       and (q["clicks"] / q["impressions"] if q["impressions"] else 0) < 0.015], key=lambda q: -q["impressions"])[:5]
    page_one = sorted([q for q in gen if q["impressions"] >= 80 and q["position"] and q["position"] < 8 and q["clicks"] <= 1],
                      key=lambda q: -q["impressions"])[:5]
    return {"pageTwo": page_two, "pageOneNoClicks": page_one}


def spelling_gap(queries: list[dict], tokens: list[str], name: str, domain: str = "") -> Optional[dict]:
    """A branded search with a different spelling of the name that converts far worse than the main one
    (Kabob Fusion: "kabab fusion" 3.3% CTR vs "kabob fusion" 12.1%)."""
    br = [q for q in queries if is_branded(q["query"], tokens, name, domain) and q["impressions"] >= 60]
    if len(br) < 2:
        return None
    main = max(br, key=lambda q: q["clicks"])
    main_ctr = main["clicks"] / main["impressions"] if main["impressions"] else 0
    words_main = set(re.findall(r"[a-z]+", main["query"]))
    for q in sorted(br, key=lambda q: -q["impressions"]):
        if q is main:
            continue
        w = set(re.findall(r"[a-z]+", q["query"]))
        diff = w ^ words_main
        ctr = q["clicks"] / q["impressions"] if q["impressions"] else 0
        if len(diff) == 2 and any(_edit1(a, b) for a in (w - words_main) for b in (words_main - w)) and ctr < main_ctr / 2:
            return {"query": q["query"], "ctr": round(ctr, 4), "impressions": q["impressions"], "mainQuery": main["query"], "mainCtr": round(main_ctr, 4)}
    return None


# -------------------------------------------------------------------- devices ----

def device_rows(cur: list[dict], prev: list[dict]) -> list[dict]:
    order = ["MOBILE", "DESKTOP", "TABLET"]
    p = {r["key"]: r for r in prev}
    out = []
    for r in sorted(cur, key=lambda r: order.index(r["key"]) if r["key"] in order else 9):
        q = p.get(r["key"], {})
        out.append({"device": r["key"].capitalize(), "clicks": r["clicks"], "prevClicks": q.get("clicks"), "impressions": r["impressions"],
                    "prevImpressions": q.get("impressions"), "ctr": round(r["clicks"] / r["impressions"], 4) if r["impressions"] else None,
                    "position": round(r["position"], 2) if r.get("position") else None,
                    "prevPosition": round(q["position"], 2) if q.get("position") else None})
    return out


COUNTRY = {"USA": "United States", "CAN": "Canada", "MEX": "Mexico", "GBR": "United Kingdom", "IND": "India", "PAK": "Pakistan",
           "PHL": "Philippines", "AUS": "Australia", "DEU": "Germany", "FRA": "France", "ARE": "United Arab Emirates", "SAU": "Saudi Arabia"}


def country_block(cur: list[dict]) -> Optional[dict]:
    if not cur:
        return None
    total_c = sum(r["clicks"] for r in cur)
    total_i = sum(r["impressions"] for r in cur)
    home = max(cur, key=lambda r: (r["clicks"], r["impressions"]))
    return {"home": COUNTRY.get(home["key"], home["key"]), "homeClicks": home["clicks"], "totalClicks": total_c,
            "homeShare": round(home["clicks"] / total_c, 4) if total_c else None,
            "otherImpressions": total_i - home["impressions"], "otherClicks": total_c - home["clicks"],
            "top": [{"country": COUNTRY.get(r["key"], r["key"]), "clicks": r["clicks"], "impressions": r["impressions"]}
                    for r in sorted(cur, key=lambda r: -r["clicks"])[:5]]}


# -------------------------------------------------------------- written parts ----

def summary(ctx: dict) -> list[str]:
    """Executive summary: 2–3 paragraphs assembled from sentence templates. ctx comes from build()."""
    name, cur, prev = ctx["name"], ctx["cur"], ctx["prev"]
    seed = ctx["month"].month
    pm = MONTHS[ctx["prevMonth"].month - 1]
    paras: list[str] = []
    if not cur:
        return [f"Search Console isn't connected for {name}, so this month's report covers the technical review only."]

    # 1 · the headline numbers
    s: list[str] = []
    ch = pct_change(cur["clicks"], prev["clicks"]) if prev else None
    best = ctx["months"] and all(cur["clicks"] >= m["clicks"] for m in ctx["months"]) and len(ctx["months"]) >= 3
    if ch is None:
        s.append(f"{name} recorded {_n(cur['clicks'])} clicks from {_n(cur['impressions'])} Google impressions in {month_label(ctx['month'])}.")
    elif ch >= 0.02:
        lead = _pick([f"{name} recorded {_n(cur['clicks'])} clicks, up {ch * 100:.1f}% on {pm} ({_n(prev['clicks'])})",
                      f"Clicks rose {ch * 100:.1f}% to {_n(cur['clicks'])} (from {_n(prev['clicks'])} in {pm})"], seed)
        s.append(lead + (f" — its best month of the {len(ctx['months'])} we have tracked." if best else "."))
    elif ch <= -0.02:
        s.append(_pick([f"{name} recorded {_n(cur['clicks'])} clicks, down {abs(ch) * 100:.1f}% on {pm} ({_n(prev['clicks'])}).",
                        f"Clicks eased {abs(ch) * 100:.1f}% to {_n(cur['clicks'])} (from {_n(prev['clicks'])} in {pm})."], seed))
    else:
        s.append(f"{name} held steady at {_n(cur['clicks'])} clicks ({_n(prev['clicks'])} in {pm}).")
    if prev:
        ich = pct_change(cur["impressions"], prev["impressions"])
        if cur["ctr"] is not None and prev["ctr"] is not None and ich is not None:
            if ich < -0.03 and cur["ctr"] > prev["ctr"] * 1.05:
                s.append(f"Impressions eased {abs(ich) * 100:.1f}% ({_n(prev['impressions'])} → {_n(cur['impressions'])}) while CTR rose from "
                         f"{_pct(prev['ctr'], 2)} to {_pct(cur['ctr'], 2)} — the site is earning more clicks from less visibility.")
            elif ich > 0.03:
                s.append(f"Impressions grew {ich * 100:.1f}% to {_n(cur['impressions'])}, and CTR moved from {_pct(prev['ctr'], 2)} to {_pct(cur['ctr'], 2)}.")
            else:
                s.append(f"Impressions were {_n(cur['impressions'])} ({_chg(ich)}) at a {_pct(cur['ctr'], 2)} CTR.")
        if cur["position"] and prev["position"]:
            d = prev["position"] - cur["position"]
            if d >= 0.5:
                s.append(f"Average position improved from {prev['position']:.2f} to {cur['position']:.2f}.")
            elif d <= -0.5:
                s.append(f"Average position slipped from {prev['position']:.2f} to {cur['position']:.2f}.")
    paras.append(" ".join(s))

    # 2 · where the clicks came from
    s = []
    b = ctx.get("brand")
    if b and b["trackedClicks"]:
        share = b["brandedShare"] or 0
        if share >= 0.6:
            s.append(_pick([f"Growth was branded: searches for the restaurant by name gave {_n(b['branded']['clicks'])} of {_n(b['trackedClicks'])} tracked clicks ({share * 100:.0f}%) at a {_pct(b['branded']['ctr'])} CTR.",
                            f"Most clicks came from people searching for {name} by name — {_n(b['branded']['clicks'])} of {_n(b['trackedClicks'])} ({share * 100:.0f}%)."], seed))
        elif share <= 0.45:
            s.append(f"Non-branded search drove {(1 - share) * 100:.0f}% of tracked clicks ({_n(b['generic']['clicks'])} of {_n(b['trackedClicks'])}) — new customers finding the restaurant through generic searches.")
        else:
            s.append(f"Clicks were split between branded ({_n(b['branded']['clicks'])}) and generic searches ({_n(b['generic']['clicks'])}).")
    opp = ctx.get("opps") or {}
    if opp.get("pageTwo"):
        top = opp["pageTwo"][:3]
        names = " and ".join(f"“{q['query']}”" for q in top[:2])
        imp = sum(q["impressions"] for q in opp["pageTwo"])
        clk = sum(q["clicks"] for q in opp["pageTwo"])
        s.append(f"Generic searches such as {names} produced {_n(clk)} clicks from {_n(imp)} impressions — visible on page two but not chosen.")
    if opp.get("pageOneNoClicks"):
        q = opp["pageOneNoClicks"][0]
        s.append(f"“{q['query']}” is on page one (position {q['position']:.1f}, {_n(q['impressions'])} impressions) yet earned {q['clicks']} click{'s' if q['clicks'] != 1 else ''}.")
    if s:
        paras.append(" ".join(s))

    # 3 · device gap and security
    s = []
    dev = {d["device"]: d for d in ctx.get("devices") or []}
    mob, desk = dev.get("Mobile"), dev.get("Desktop")
    if mob and desk and mob["ctr"] is not None and desk["ctr"]:
        tot_i = sum(d["impressions"] for d in dev.values()) or 1
        if desk["ctr"] >= mob["ctr"] * 2 and mob["impressions"] / tot_i >= 0.6:
            s.append(f"Mobile carries {mob['impressions'] / tot_i * 100:.0f}% of impressions at a {_pct(mob['ctr'], 2)} CTR, while desktop converts at "
                     f"{_pct(desk['ctr'], 2)} — the mobile search result is the largest untouched lever.")
    if ctx.get("spam"):
        live = [p for p in ctx["spam"] if p["status"] != "faded"]
        if live:
            s.append(f"{len(live)} spam page{'s are' if len(live) != 1 else ' is'} indexed on this domain ({live[0]['path']}); removing {'them' if len(live) != 1 else 'it'} and securing the site comes first.")
    if s:
        paras.append(" ".join(s))
    return paras


def highlight(ctx: dict) -> Optional[dict]:
    """One highlighted finding section, most important first: spam > page-one-no-clicks > page-two cluster > mobile gap."""
    spam = [p for p in ctx.get("spam") or [] if p["status"] != "faded"]
    if spam:
        return {"kind": "security", "title": "Security Finding: Spam Pages Indexed on This Domain",
                "text": f"{len(spam)} page{'s' if len(spam) != 1 else ''} with casino, adult or similar spam addresses "
                        f"{'are' if len(spam) != 1 else 'is'} being shown by Google for this site. This is the pattern of an injected (hacked) "
                        "WordPress install: the pages should be deleted, the site scanned for the injection source (rogue plugin or theme file, "
                        "unknown admin users, scheduled tasks), credentials rotated and the URLs removed in Search Console.",
                "rows": ctx["spam"][:8]}
    opp = ctx.get("opps") or {}
    if opp.get("pageOneNoClicks"):
        q = opp["pageOneNoClicks"]
        return {"kind": "opportunity", "title": f"Page One, No Clicks: “{q[0]['query']}”",
                "text": "These searches already show the site on page one, but searchers aren't choosing it. That is a snippet problem, not a "
                        "ranking problem: the title and description shown for these searches need to say what the searcher wants to hear "
                        "(cuisine, area, ordering).", "queries": q}
    if opp.get("pageTwo"):
        q = opp["pageTwo"]
        return {"kind": "opportunity", "title": "Generic Searches Stuck on Page Two",
                "text": f"{len(q)} generic searches with real demand sit at positions 8–25 with almost no clicks. Moving them onto page one "
                        "is the clearest growth opportunity for new customers.", "queries": q}
    return None


def recommendations(ctx: dict) -> list[str]:
    out: list[str] = []
    name = ctx["name"]
    if any(p["status"] != "faded" for p in ctx.get("spam") or []):
        out.append("Remove the spam pages and secure the domain. Delete the injected URLs, scan WordPress for the injection source, "
                   "rotate all passwords, and request removal of the URLs in Search Console.")
    dev = {d["device"]: d for d in ctx.get("devices") or []}
    mob, desk = dev.get("Mobile"), dev.get("Desktop")
    opp = ctx.get("opps") or {}
    if mob and desk and mob["ctr"] is not None and desk["ctr"] and desk["ctr"] >= mob["ctr"] * 2:
        example = (f" (e.g. “{name} — {ctx['cuisine']} in {ctx['city']} | Order Online”)" if ctx.get("cuisine") and ctx.get("city") else "")
        out.append("Rewrite the homepage title and meta description for mobile searchers. Lead with what a phone searcher needs: "
                   f"cuisine, area and “Order Online”{example}.")
    specific = [q for q in opp.get("pageTwo") or [] if not set(re.findall(r"[a-z]+", q["query"])) <= PLAIN_WORDS]
    if specific:
        q = specific[0]
        out.append(f"Build a landing page for “{q['query']}”. It has {_n(q['impressions'])} impressions at position {q['position']:.1f}; "
                   "a dedicated page (menu highlights, neighbourhoods served, hours, ordering) gives Google something better than the homepage to rank.")
    if opp.get("pageOneNoClicks"):
        q = opp["pageOneNoClicks"][0]
        out.append(f"Fix the snippet for “{q['query']}”: it ranks at {q['position']:.1f} with {_n(q['impressions'])} impressions and "
                   f"{q['clicks']} click{'s' if q['clicks'] != 1 else ''}. Make the page title and description match that search.")
    sg = ctx.get("spelling")
    if sg:
        out.append(f"Add the “{sg['query']}” spelling to the homepage title or H1. It converts at {_pct(sg['ctr'])} versus "
                   f"{_pct(sg['mainCtr'])} for “{sg['mainQuery']}” — that audience isn't seeing itself in the result.")
    for line in ctx.get("findingSteps") or []:
        if len(out) >= 7:
            break
        if line not in out:
            out.append(line)
    if ctx.get("noBacklinks"):
        out.append("Connect a link-data source (Moz, Majestic or Ahrefs in Screaming Frog) — backlinks are still not measured for this account.")
    return out[:7] or ["Keep the current plan — nothing in this month's data needs action."]


def data_notes(ctx: dict) -> list[str]:
    out = []
    b = ctx.get("brand")
    if b and ctx.get("cur") and b["trackedClicks"] < ctx["cur"]["clicks"]:
        out.append(f"Google anonymises very-low-volume searches, so search-level clicks ({_n(b['trackedClicks'])}) sum below the site total "
                   f"({_n(ctx['cur']['clicks'])}).")
    if b and b.get("tokens"):
        out.append(f"Branded = searches containing the restaurant's name ({', '.join(b['tokens'])}, including one-letter spelling variants).")
    return out + list(ctx.get("notes") or [])


# ------------------------------------------------- paragraph under each table ----
# One short paragraph per section, written from rules like the executive summary (no AI). The analyst can
# rewrite any of them before sign-off (PATCH /seo/reports/{id}/summary with "section").

NOTE_SECTIONS = ("metrics", "brand", "highlight", "progress", "queries", "pages", "devices", "geo", "crawl")


def _abbr(label: str) -> str:
    return label.split(" ")[0][:3]


def generic_queries(queries: list[dict], tokens: list[str], name: str, domain: str = "", n: int = 8) -> list[dict]:
    """The largest non-branded searches by impressions (the chart "Largest non-branded queries")."""
    gen = [q for q in queries if not is_branded(q["query"], tokens, name, domain) and not _SPAM_RE.search(q["query"])]
    return [{"query": q["query"], "impressions": q["impressions"], "clicks": q["clicks"],
             "position": round(q["position"], 2) if q.get("position") else None}
            for q in sorted(gen, key=lambda q: -q["impressions"])[:n]]


def note_metrics(ctx: dict) -> list[str]:
    ms = [m for m in ctx.get("months") or [] if m.get("clicks") is not None]
    if len(ms) < 2:
        return []
    s: list[str] = []
    ups = 0
    for m in reversed(ms[1:]):
        if (m.get("clicksChange") or 0) > 0:
            ups += 1
        else:
            break
    seed = ctx["month"].month
    if ups >= 2:
        steps = ", ".join(f"{m['clicksChange'] * 100:+.1f}% in {_abbr(m['label'])}" for m in ms[-ups:])
        s.append(_pick([f"Clicks have now grown {ups} months in a row ({steps}).",
                        f"This is the {ups}{'nd' if ups == 2 else 'rd' if ups == 3 else 'th'} month of click growth in a row ({steps})."], seed))
    elif ms[-1].get("clicksChange") is not None and ms[-1]["clicksChange"] < 0 and len(ms) >= 3 and (ms[-2].get("clicksChange") or 0) > 0:
        s.append(f"Clicks dipped {abs(ms[-1]['clicksChange']) * 100:.1f}% after growing in {_abbr(ms[-2]['label'])}; one month is not yet a trend.")
    best = max(ms, key=lambda m: m["clicks"])
    if best is ms[-1] and len(ms) >= 3:
        s.append(f"{ms[-1]['label']} is the strongest month in the table.")
    elif best is not ms[-1]:
        s.append(f"The strongest month in the table is still {best['label']} ({_n(best['clicks'])} clicks).")
    ctrs = [m["ctr"] for m in ms if m.get("ctr") is not None]
    if len(ctrs) >= 3:
        if all(b > a for a, b in zip(ctrs, ctrs[1:])):
            s.append(f"CTR has risen every month ({_pct(ctrs[0], 2)} → {_pct(ctrs[-1], 2)}), so more of the people who see the site are choosing it.")
        elif all(b < a for a, b in zip(ctrs, ctrs[1:])):
            s.append(f"CTR has fallen every month ({_pct(ctrs[0], 2)} → {_pct(ctrs[-1], 2)}) — the search result is becoming less convincing.")
    pos = [m["position"] for m in ms if m.get("position")]
    if len(pos) >= 3 and abs(pos[-1] - pos[0]) >= 1:
        s.append(f"Average position moved from {pos[0]:.2f} to {pos[-1]:.2f} over the period"
                 + (" — the site is being shown higher." if pos[-1] < pos[0] else " — the site is being shown for more, looser searches."))
    return [" ".join(s)] if s else []


def note_brand(ctx: dict) -> list[str]:
    b, bp = ctx.get("brand"), ctx.get("brandPrev")
    if not b or not b.get("trackedClicks"):
        return []
    s: list[str] = []
    share = b["brandedShare"] or 0
    pm = MONTHS[ctx["prevMonth"].month - 1]
    if bp and bp.get("brandedShare") is not None:
        d = share - bp["brandedShare"]
        if abs(d) >= 0.03:
            s.append(f"Branded search made up {share * 100:.0f}% of tracked clicks, {'up' if d > 0 else 'down'} from {bp['brandedShare'] * 100:.0f}% in {pm}.")
        else:
            s.append(f"Branded search made up {share * 100:.0f}% of tracked clicks, in line with {pm} ({bp['brandedShare'] * 100:.0f}%).")
        bc, pc = b["branded"]["ctr"], bp["branded"]["ctr"]
        if bc is not None and pc is not None and abs(bc - pc) >= 0.01:
            s.append(f"Branded CTR {'rose' if bc > pc else 'fell'} from {_pct(pc)} to {_pct(bc)}.")
    else:
        s.append(f"Branded search made up {share * 100:.0f}% of tracked clicks.")
    g = b["generic"]
    if share >= 0.6:
        s.append(f"Non-branded searches brought {_n(g['clicks'])} clicks from {_n(g['impressions'])} impressions ({_pct(g['ctr'], 2)} CTR): "
                 "the site is reaching people who already know the restaurant, much less those who don't yet.")
    elif share <= 0.45:
        s.append("Most clicks are coming from people who did not search for the restaurant by name — a sign of healthy discovery.")
    if b["trackedClicks"] < (ctx.get("cur") or {}).get("clicks", 0):
        s.append(f"Google hides very-low-volume searches, so these figures cover {_n(b['trackedClicks'])} of {_n(ctx['cur']['clicks'])} clicks.")
    return [" ".join(s)]


def note_queries(ctx: dict, queries: list[dict]) -> list[str]:
    s: list[str] = []
    moved = [q for q in queries if q.get("position") and q.get("prevPosition")]
    gain = max(moved, key=lambda q: q["prevPosition"] - q["position"], default=None)
    loss = max(moved, key=lambda q: q["position"] - q["prevPosition"], default=None)
    if loss and loss["position"] - loss["prevPosition"] >= 0.3:
        s.append(f"“{loss['query']}” slipped from position {loss['prevPosition']:.2f} to {loss['position']:.2f}"
                 + (f" ({loss['prevClicks']} → {loss['clicks']} clicks)." if loss.get("prevClicks") is not None else "."))
    if gain and gain["prevPosition"] - gain["position"] >= 0.3:
        joiner = " while " if s else ""
        txt = (f"“{gain['query']}” improved from {gain['prevPosition']:.2f} to {gain['position']:.2f}"
               + (" — onto page one" if gain["prevPosition"] > 10 >= gain["position"] else "")
               + (f" ({gain['prevClicks']} → {gain['clicks']} clicks)." if gain.get("prevClicks") is not None else "."))
        s = [s[0].rstrip(".") + "," + joiner + txt] if s else [txt]
    up = [q for q in queries if q.get("prevPosition") and q["prevPosition"] > 10 and q.get("position") and q["position"] <= 10
          and not (q is gain and gain["prevPosition"] - gain["position"] >= 0.3)]
    if up:
        q = up[0]
        s.append(f"“{q['query']}” moved onto page one ({q['prevPosition']:.1f} → {q['position']:.1f}).")
    new = [q for q in queries if q.get("prevClicks") is None and q["clicks"] >= 3]
    if new:
        s.append(f"New in the top searches this month: {', '.join('“' + q['query'] + '”' for q in new[:3])}.")
    sg = ctx.get("spelling")
    if sg:
        s.append(f"“{sg['query']}” converts at {_pct(sg['ctr'])} against {_pct(sg['mainCtr'])} for “{sg['mainQuery']}” — "
                 "people using that spelling see the result but aren't sure it is the right restaurant.")
    if not s and queries:
        top = queries[0]
        s.append(f"“{top['query']}” remains the main search, with {_n(top['clicks'])} clicks at position {top['position'] or 0:.2f}.")
    return [" ".join(s)] if s else []


def note_pages(ctx: dict, pages: list[dict], total_page_clicks: int) -> list[str]:
    if not pages:
        return []
    s: list[str] = []
    home = next((p for p in pages if p["path"] in ("/", "")), None)
    if home and total_page_clicks:
        share = home["clicks"] / total_page_clicks
        s.append(f"The homepage took {_n(home['clicks'])} of {_n(total_page_clicks)} clicks ({share * 100:.1f}%)"
                 + (" — effectively a one-page site in Google's eyes." if share >= 0.9 else "."))
        if share >= 0.9:
            s.append("Menu, location and catering pages barely appear in search, so every generic search has to be won by the homepage.")
    others = [p for p in pages if p["path"] not in ("/", "") and not p.get("spam") and p["clicks"] > 0]
    if others and (not home or not total_page_clicks or home["clicks"] / total_page_clicks < 0.9):
        p = others[0]
        s.append(f"{p['path']} is the strongest inner page ({_n(p['clicks'])} clicks).")
    new = [p for p in pages if p.get("prevImpressions") is None and not p.get("spam") and p["impressions"] >= 20 and p["path"] not in ("/", "")]
    if new:
        s.append(f"{new[0]['path']} is new in search this month ({_n(new[0]['impressions'])} impressions).")
    spam = [p for p in pages if p.get("spam")]
    if spam:
        s.append(f"{len(spam)} of the pages listed {'are' if len(spam) != 1 else 'is'} injected spam (marked) and must be removed.")
    return [" ".join(s)] if s else []


def note_devices(ctx: dict) -> list[str]:
    dev = {d["device"]: d for d in ctx.get("devices") or []}
    mob, desk = dev.get("Mobile"), dev.get("Desktop")
    if not mob:
        return []
    tot_c = sum(d["clicks"] for d in dev.values()) or 0
    tot_i = sum(d["impressions"] for d in dev.values()) or 0
    s = [f"Mobile delivered {mob['clicks'] / tot_c * 100:.0f}% of clicks and {mob['impressions'] / tot_i * 100:.0f}% of impressions."] if tot_c and tot_i else []
    if desk and mob.get("ctr") is not None and desk.get("ctr"):
        r = desk["ctr"] / mob["ctr"] if mob["ctr"] else None
        if r and r >= 1.5:
            s.append(f"Desktop converts at {_pct(desk['ctr'], 2)} against {_pct(mob['ctr'], 2)} on mobile ({r:.1f}×): the result phone searchers see "
                     "(title, description, star rating, ordering link) is where clicks are being lost.")
        elif r and r <= 0.67:
            s.append(f"Mobile converts better than desktop ({_pct(mob['ctr'], 2)} vs {_pct(desk['ctr'], 2)}), as expected for a restaurant.")
    for d in (mob, desk):
        if d and d.get("position") and d.get("prevPosition") and abs(d["position"] - d["prevPosition"]) >= 0.5:
            s.append(f"{d['device']} position {'improved' if d['position'] < d['prevPosition'] else 'slipped'} from {d['prevPosition']:.2f} to {d['position']:.2f}.")
    return [" ".join(s)] if s else []


def note_geo(ctx: dict) -> list[str]:
    co, cp = ctx.get("countries"), ctx.get("countriesPrev")
    if not co or not co.get("totalClicks"):
        return []
    s = [f"{co['home']} accounts for {co['homeShare'] * 100:.1f}% of clicks"
         + (f" ({cp['homeShare'] * 100:.1f}% in {MONTHS[ctx['prevMonth'].month - 1]})." if cp and cp.get("homeShare") is not None else ".")]
    if co["otherImpressions"] >= 50:
        s.append(f"Searches from other countries added {_n(co['otherImpressions'])} impressions but only {_n(co['otherClicks'])} click"
                 f"{'s' if co['otherClicks'] != 1 else ''}; they inflate impressions and lower the average CTR without bringing customers.")
    else:
        s.append("Visibility is almost entirely local, as it should be for a restaurant.")
    return [" ".join(s)]


def note_crawl(crawl: Optional[dict]) -> list[str]:
    if not crawl or not crawl.get("pages"):
        return []
    s: list[str] = []
    pages, idx = crawl["pages"], crawl.get("indexable") or 0
    s.append(f"{idx:,} of {pages:,} pages ({idx / pages * 100:.0f}%) can be shown by Google.")
    if crawl.get("broken"):
        s.append(f"{crawl['broken']} broken link{'s' if crawl['broken'] != 1 else ''} should be fixed or redirected.")
    top = [i for i in crawl.get("top") or [] if i.get("priority") in ("High", "Medium")]
    if top:
        i = top[0]
        s.append(f"The most important item is “{i['name']}” on {i['urls']:,} page{'s' if i['urls'] != 1 else ''}"
                 + (f" ({i['prevUrls']:,} at the previous crawl)." if i.get("prevUrls") is not None and i["prevUrls"] != i["urls"] else "."))
        better = [i for i in crawl.get("top") or [] if i.get("prevUrls") is not None and i["urls"] < i["prevUrls"]]
        if better:
            s.append(f"{len(better)} issue{'s have' if len(better) != 1 else ' has'} improved since the previous crawl.")
    else:
        s.append("No High or Medium priority problems were found.")
    return [" ".join(s)]


_QUOTED = re.compile(r"“([^”]{2,80})”")


def progress(prev_recs: list[str], prev_label: str, qc: list[dict], qp: list[dict]) -> Optional[dict]:
    """Last report's recommendations, each with the evidence the data can give (a quoted search's position then vs now)."""
    if not prev_recs:
        return None
    cur = {r["query"]: r for r in qc}
    old = {r["query"]: r for r in qp}
    items = []
    for rec in prev_recs[:7]:
        ev = None
        for q in _QUOTED.findall(rec):
            a, b = old.get(q), cur.get(q)
            if a and b and a.get("position") and b.get("position"):
                ev = (f"“{q}”: position {a['position']:.1f} → {b['position']:.1f}, clicks {a['clicks']} → {b['clicks']}, "
                      f"impressions {_n(a['impressions'])} → {_n(b['impressions'])}.")
                break
        items.append({"text": rec, "evidence": ev})
    shown = sum(1 for i in items if i["evidence"])
    note = (f"{prev_label}'s report set {len(items)} priorities. "
            + (f"For {shown} of them the search data shows the result so far (below); the others need the team's update on what was done."
               if shown else "The search data can't measure these directly, so the team's update on what was done goes here."))
    return {"title": f"Progress on {prev_label.split(' ')[0]}'s Priorities", "items": items, "note": note}


# ------------------------------------------------------------------ collect ----

async def build(db: AsyncSession, site: SeoSite, end: dt.date, base_notes: list[str], finding_steps: list[str],
                no_backlinks: bool, cuisine: Optional[str] = None, city: Optional[str] = None,
                crawl: Optional[dict] = None, prev_recs: Optional[list[str]] = None) -> dict:
    """The report's new sections for the month `end` falls in, compared with the month before."""
    m = data.month_start(end)
    pm = data.prev_month(m)
    ctx: dict = {"name": site.name, "month": m, "prevMonth": pm, "cuisine": cuisine, "city": city, "notes": base_notes,
                 "findingSteps": finding_steps, "noBacklinks": no_backlinks}

    # Key metrics: this month, last month and a 4-month table (Search Console daily totals).
    months: list[dict] = []
    if site.gsc_property:
        mm = m
        for _ in range(4):
            w = await data.gsc_window(db, site.id, mm, data.month_end(mm))
            if w["impressions"] or w["clicks"]:
                months.append({"month": mm.isoformat(), "label": month_label(mm), "clicks": w["clicks"], "impressions": w["impressions"],
                               "ctr": round(w["clicks"] / w["impressions"], 4) if w["impressions"] else None,
                               "position": round(w["position"], 2) if w["position"] else None})
            mm = data.prev_month(mm)
        months.reverse()
        for i, row in enumerate(months):
            row["clicksChange"] = pct_change(row["clicks"], months[i - 1]["clicks"]) if i else None
    ctx["months"] = months
    by = {r["month"]: r for r in months}
    ctx["cur"], ctx["prev"] = by.get(m.isoformat()), by.get(pm.isoformat())

    async def q_rows(month: dt.date) -> list[dict]:
        rows = (await db.execute(select(SeoGscQuery).where(SeoGscQuery.site_id == site.id, SeoGscQuery.month == month))).scalars().all()
        return [{"query": r.query, "clicks": r.clicks, "impressions": r.impressions, "position": r.position} for r in rows]

    async def p_rows(month: dt.date) -> list[dict]:
        rows = (await db.execute(select(SeoGscPage).where(SeoGscPage.site_id == site.id, SeoGscPage.month == month))).scalars().all()
        return [{"path": (urlparse(r.page).path or "/"), "url": r.page, "clicks": r.clicks, "impressions": r.impressions, "position": r.position} for r in rows]

    async def split(month: dt.date, dim: str) -> list[dict]:
        rows = (await db.execute(select(SeoGscSplit).where(SeoGscSplit.site_id == site.id, SeoGscSplit.month == month, SeoGscSplit.dimension == dim))).scalars().all()
        return [{"key": r.key, "clicks": r.clicks, "impressions": r.impressions, "position": r.position} for r in rows]

    qc, qp = await q_rows(m), await q_rows(pm)
    pgc, pgp = await p_rows(m), await p_rows(pm)
    ctx["brand"] = branded_split(qc, site.name, site.domain) if qc else None
    ctx["brandPrev"] = branded_split(qp, site.name, site.domain) if qp else None
    tokens = brand_tokens(site.name, site.domain)
    ctx["opps"] = opportunities(qc, tokens, site.name, site.domain)
    ctx["spelling"] = spelling_gap(qc, tokens, site.name, site.domain)
    ctx["spam"] = spam_pages(pgc, pgp)
    ctx["spamQueries"] = spam_queries(qc)
    ctx["devices"] = device_rows(await split(m, "device"), await split(pm, "device"))
    ctx["countries"] = country_block(await split(m, "country"))
    ctx["countriesPrev"] = country_block(await split(pm, "country"))

    pq = {r["query"]: r for r in qp}
    queries = [{**r, "ctr": round(r["clicks"] / r["impressions"], 4) if r["impressions"] else None,
                "position": round(r["position"], 2) if r["position"] else None,
                "prevClicks": pq[r["query"]]["clicks"] if r["query"] in pq else None,
                "prevPosition": round(pq[r["query"]]["position"], 2) if r["query"] in pq and pq[r["query"]]["position"] else None}
               for r in sorted(qc, key=lambda r: (-r["clicks"], -r["impressions"]))[:12]]
    pp = {r["path"]: r for r in pgp}
    spam_paths = {s["path"] for s in ctx["spam"]}
    pages = [{"path": r["path"], "clicks": r["clicks"], "impressions": r["impressions"], "position": round(r["position"], 2) if r["position"] else None,
              "prevClicks": pp[r["path"]]["clicks"] if r["path"] in pp else None, "prevImpressions": pp[r["path"]]["impressions"] if r["path"] in pp else None,
              "spam": r["path"] in spam_paths}
             for r in sorted(pgc, key=lambda r: (-r["clicks"], -r["impressions"]))[:10]]

    hl = highlight(ctx)
    prog = progress(prev_recs or [], month_label(pm), qc, qp)
    notes = {"metrics": note_metrics(ctx), "brand": note_brand(ctx), "highlight": [hl["text"]] if hl else [],
             "progress": [prog["note"]] if prog else [], "queries": note_queries(ctx, queries),
             "pages": note_pages(ctx, pages, sum(r["clicks"] for r in pgc)), "devices": note_devices(ctx),
             "geo": note_geo(ctx), "crawl": note_crawl(crawl)}

    alert = None
    live = [p for p in ctx["spam"] if p["status"] != "faded"]
    if live:
        alert = {"title": f"Security: {len(live)} spam page{'s' if len(live) != 1 else ''} indexed on this domain",
                 "text": f"{live[0]['path']} recorded {_n(live[0]['impressions'])} impressions this month"
                         + (f" at position {live[0]['position']:.1f}" if live[0]["position"] else "")
                         + ". Removal, a malware scan and a password rotation are the first priority; the longer injected pages stay indexed, "
                           "the greater the risk of a manual action against the whole site."}

    return {
        "version": 2, "month": m.isoformat(), "monthLabel": month_label(m), "prevMonth": pm.isoformat(), "prevMonthLabel": month_label(pm),
        "alert": alert, "summary": summary(ctx), "summaryEdited": False,
        "keyMetrics": {"cur": ctx["cur"], "prev": ctx["prev"]}, "months": months,
        "brand": ctx["brand"], "brandPrev": ctx["brandPrev"], "highlight": hl, "progress": prog,
        "notes": notes, "notesEdited": [],
        "genericQueries": generic_queries(qc, tokens, site.name, site.domain),
        "queries": queries, "pages": pages, "devices": ctx["devices"], "countries": ctx["countries"],
        "spam": ctx["spam"], "spamQueries": ctx["spamQueries"],
        "recommendations": recommendations(ctx), "dataNotes": data_notes(ctx),
        "sources": "Google Search Console (Web search), " + month_label(pm) + " vs " + month_label(m)
                   + (" · Google Analytics 4" if site.ga4_property else "") + (" · Google Business Profile" if site.gbp_location_id else ""),
    }
