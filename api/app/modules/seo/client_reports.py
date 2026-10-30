"""Client SEO reports: assemble → sign off → send.

A report is a frozen `snapshot` of the site's numbers for one period, built
from our tables when it is generated, so what was signed is exactly what is
sent. Unsigned reports never send. The daily sync assembles each active site's
due report by itself (generated_by_id = None → "auto"); staff can regenerate
until it is signed.

Sending goes through the Gmail API as the Google account connected for SEO
(Settings → Integrations), so reports come from that mailbox and show in its
Sent folder. It needs the gmail.send permission on that connection; without it
the report can still be signed off and printed to PDF from the preview page.
"""
from __future__ import annotations

import base64
import datetime as dt
import html
import logging
from email.message import EmailMessage
from email.utils import formataddr
from typing import Optional

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.auth import User
from app.models.gbp import GbpDailyMetric
from app.models.seo import SeoFinding, SeoGscDaily, SeoGscPage, SeoGscQuery, SeoKeyword, SeoReport, SeoSite, utcnow
from app.modules.seo import catalog, connection, data, google, report_v2, views

logger = logging.getLogger("SEO.reports")

GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


class ReportError(RuntimeError):
    """`str(exc)` is safe to show."""


def period_label(start: dt.date, end: dt.date, cadence: str) -> str:
    if cadence == "quarterly":
        return f"Q{(start.month - 1) // 3 + 1} {start.year}"
    if start.day == 1 and end == data.month_end(start):
        return f"{MONTHS[start.month - 1]} {start.year}"
    if start.month == end.month:
        return f"{start.day}–{end.day} {MONTHS[end.month - 1][:3]} {end.year}"
    return f"{start.isoformat()} – {end.isoformat()}"


def _metric(cur: float, prev: float, digits: int = 0) -> dict:
    return {"value": round(cur, digits) if digits else round(cur), "prev": round(prev, digits) if digits else round(prev), "change": views.change(cur, prev)}


def _fmt(v: float) -> str:
    return f"{round(v):,}"


def what_changed(fg: dict) -> list[str]:
    out = []
    c, i = fg.get("organicClicks"), fg.get("impressions")
    if c:
        line = f"Organic clicks moved from {_fmt(c['prev'])} to {_fmt(c['value'])}"
        if c["change"] is not None:
            line += f" ({c['change'] * 100:+.0f}%)"
        if i:
            ich = i["change"]
            trend = "held near flat" if ich is None or abs(ich) < 0.05 else ("rose" if ich > 0 else "fell")
            line += f" while impressions {trend} ({_fmt(i['prev'])} → {_fmt(i['value'])})"
        out.append(line + ".")
    ctr = fg.get("ctr")
    if ctr and ctr["value"] is not None and ctr["prev"] is not None:
        out.append(f"Click-through rate {ctr['prev'] * 100:.1f}% → {ctr['value'] * 100:.1f}%.")
    pos = fg.get("position")
    if pos and pos["value"] and pos["prev"]:
        out.append(f"Average Google position {pos['prev']:.1f} → {pos['value']:.1f} ({'better' if pos['value'] < pos['prev'] else 'lower'}).")
    s = fg.get("sessions")
    if s:
        out.append(f"Website visits {_fmt(s['prev'])} → {_fmt(s['value'])}" + (f" ({s['change'] * 100:+.0f}%)." if s["change"] is not None else "."))
    k = fg.get("keyEvents")
    if k and (k["value"] or k["prev"]):
        out.append(f"Key events (orders, calls, sign-ups tracked in GA4) {_fmt(k['prev'])} → {_fmt(k['value'])}.")
    return out


def next_steps(open_findings: list, crawl: Optional[dict] = None) -> list[str]:
    """Up to four plain next steps: the most severe open findings first (first sentence of each fix),
    then the top High/Medium issues from the latest full-site crawl (Screaming Frog import)."""
    out: list[str] = []
    for f in open_findings:
        if f.code == "sf_issue":  # Screaming Frog's help text is generic — name the issue and its size instead
            n = (f.evidence or {}).get("urls")
            line = f"Fix “{f.title.removeprefix('Crawl: ')}”" + (f" on {n:,} URL{'s' if n != 1 else ''}" if n else "") + " (full-site crawl)."
        else:
            line = (f.recommendation or f.title).split(". ")[0].strip().rstrip(".") + "."
        if line not in out:
            out.append(line)
        if len(out) == 3:
            break
    for i in (crawl or {}).get("top", []):
        if len(out) >= 4:
            break
        if i["priority"] in ("High", "Medium") and i["type"] == "Issue":
            out.append(f"Fix “{i['name']}” across {i['urls']:,} page{'s' if i['urls'] != 1 else ''} (full-site crawl).")
    return out or ["Keep the current plan — no open issues need action this period."]


async def crawl_block(db: AsyncSession, site: SeoSite) -> Optional[dict]:
    """The newest full-site crawl (Screaming Frog import) in report form, or None when none is imported."""
    from app.models.seo import SeoCrawl, SeoCrawlIssue

    c = (await db.execute(select(SeoCrawl).where(SeoCrawl.site_id == site.id)
                          .order_by(SeoCrawl.crawled_at.desc().nullslast(), SeoCrawl.imported_at.desc()).limit(1))).scalar_one_or_none()
    if not c:
        return None
    prev = (await db.execute(select(SeoCrawl.id).where(SeoCrawl.site_id == site.id, SeoCrawl.id != c.id)
                             .order_by(SeoCrawl.crawled_at.desc().nullslast()).limit(1))).scalar_one_or_none()
    prev_counts = dict((await db.execute(select(SeoCrawlIssue.key, SeoCrawlIssue.urls).where(SeoCrawlIssue.crawl_id == prev))).all()) if prev else {}
    issues = (await db.execute(select(SeoCrawlIssue).where(SeoCrawlIssue.crawl_id == c.id, SeoCrawlIssue.urls > 0))).scalars().all()
    rank = {"High": 0, "Medium": 1, "Low": 2}
    kind = {"Issue": 0, "Warning": 1, "Opportunity": 2}
    issues.sort(key=lambda i: (rank.get(i.priority, 3), kind.get(i.issue_type, 3), -i.urls))
    t = c.totals or {}
    return {
        "source": "Screaming Frog", "crawledAt": c.crawled_at.isoformat() if c.crawled_at else None,
        "pages": t.get("html"), "indexable": t.get("indexable"), "nonIndexable": t.get("nonIndexable"),
        "broken": (t.get("errors4xx") or 0) + (t.get("errors5xx") or 0), "redirects": t.get("redirects"),
        "orphans": t.get("orphans"), "avgWords": t.get("avgWords"), "issueTypes": t.get("issueTypes") or {},
        "hasPrevious": prev is not None,
        "top": [{"name": i.name, "type": i.issue_type, "priority": i.priority, "urls": i.urls, "prevUrls": prev_counts.get(i.key)} for i in issues[:8]],
    }


async def update_summary(db: AsyncSession, r: SeoReport, paragraphs: list[str], section: Optional[str] = None) -> SeoReport:
    """The analyst's edit of the executive summary — or, with `section`, of the paragraph under one table
    (report_v2.NOTE_SECTIONS) — on new-format reports, until sign-off. An empty paragraph list hides that note."""
    if r.status != "awaiting_signoff":
        raise ReportError("Only a report awaiting sign-off can be edited.")
    snap = dict(r.snapshot or {})
    if not snap.get("v2"):
        raise ReportError("This report was made in the earlier format; regenerate it to edit the summary.")
    v2 = dict(snap["v2"])
    clean = [p.strip() for p in paragraphs if p.strip()][:6]
    if section:
        if section not in report_v2.NOTE_SECTIONS:
            raise ReportError("Unknown report section.")
        v2["notes"] = {**(v2.get("notes") or {}), section: clean}
        v2["notesEdited"] = sorted(set(v2.get("notesEdited") or []) | {section})
    else:
        v2["summary"] = clean
        v2["summaryEdited"] = True
    snap["v2"] = v2
    r.snapshot = snap
    await db.flush()
    return r


async def update_next_steps(db: AsyncSession, r: SeoReport, steps: list[str]) -> SeoReport:
    if r.status != "awaiting_signoff":
        raise ReportError("Only a report awaiting sign-off can be edited.")
    snap = dict(r.snapshot or {})
    snap["nextSteps"] = [s.strip() for s in steps if s.strip()][:6]
    if snap.get("v2"):  # new-format reports show these as "Recommendations"
        snap["v2"] = {**snap["v2"], "recommendations": snap["nextSteps"]}
    r.snapshot = snap
    await db.flush()
    return r


async def build_snapshot(db: AsyncSession, site: SeoSite, start: dt.date, end: dt.date, cadence: str) -> dict:
    days = (end - start).days + 1
    pstart, pend = start - dt.timedelta(days=days), start - dt.timedelta(days=1)
    fg: dict = {}
    notes: list[str] = []
    if site.gsc_property:
        cur = await data.gsc_window(db, site.id, start, end)
        prev = await data.gsc_window(db, site.id, pstart, pend)
        fg["organicClicks"] = _metric(cur["clicks"], prev["clicks"])
        fg["impressions"] = _metric(cur["impressions"], prev["impressions"])
        fg["ctr"] = {"value": round(cur["clicks"] / cur["impressions"], 4) if cur["impressions"] else None,
                     "prev": round(prev["clicks"] / prev["impressions"], 4) if prev["impressions"] else None}
        fg["position"] = {"value": round(cur["position"], 2) if cur["position"] else None, "prev": round(prev["position"], 2) if prev["position"] else None}
        if site.last_gsc_date and site.last_gsc_date < end:
            notes.append(f"Search Console data runs through {site.last_gsc_date.isoformat()} (Google publishes it 2–3 days late).")
    else:
        notes.append("Search Console isn't linked for this site yet.")
    if site.ga4_property:
        cur = await data.ga4_window(db, site.id, start, end)
        prev = await data.ga4_window(db, site.id, pstart, pend)
        fg["users"] = _metric(cur["users"], prev["users"])
        fg["sessions"] = _metric(cur["sessions"], prev["sessions"])
        fg["organicSessions"] = _metric(cur["organicSessions"], prev["organicSessions"])
        fg["keyEvents"] = _metric(cur["keyEvents"], prev["keyEvents"])
    else:
        notes.append("GA4 isn't linked for this site yet, so visits and key events are not included.")

    daily = (await db.execute(select(SeoGscDaily.date, SeoGscDaily.clicks).where(SeoGscDaily.site_id == site.id, SeoGscDaily.date.between(start, end)).order_by(SeoGscDaily.date))).all()
    prev_daily = (await db.execute(select(SeoGscDaily.date, SeoGscDaily.clicks).where(SeoGscDaily.site_id == site.id, SeoGscDaily.date.between(pstart, pend)).order_by(SeoGscDaily.date))).all()

    # Search terms & pages: the month the period ends in (stored monthly).
    m = data.month_start(end)
    pm = data.prev_month(m)
    qs = (await db.execute(select(SeoGscQuery).where(SeoGscQuery.site_id == site.id, SeoGscQuery.month == m).order_by(SeoGscQuery.clicks.desc(), SeoGscQuery.impressions.desc()).limit(10))).scalars().all()
    pq = {q.query: q for q in (await db.execute(select(SeoGscQuery).where(SeoGscQuery.site_id == site.id, SeoGscQuery.month == pm, SeoGscQuery.query.in_([q.query for q in qs])))).scalars()} if qs else {}
    pages = (await db.execute(select(SeoGscPage).where(SeoGscPage.site_id == site.id, SeoGscPage.month == m).order_by(SeoGscPage.clicks.desc()).limit(8))).scalars().all()

    # Tracked keywords: Search Console average position, the period's month vs the month before.
    kws = []
    tracked = (await db.execute(select(SeoKeyword.keyword).where(SeoKeyword.site_id == site.id, SeoKeyword.active.is_(True)).order_by(SeoKeyword.created_at))).scalars().all()
    if tracked:
        pos = await data.keyword_positions(db, site.id, tracked, m, pm)
        for k in tracked:
            r = pos[k.lower()]
            if r["position"] is not None or r["previous"] is not None:
                kws.append({"keyword": k, "position": r["position"], "previous": r["previous"], "hasPrevious": r["hasPrevious"],
                            "clicks": r["clicks"], "impressions": r["impressions"]})

    local = None
    if site.gbp_location_id:
        g = GbpDailyMetric
        views = g.impressions_desktop_maps + g.impressions_desktop_search + g.impressions_mobile_maps + g.impressions_mobile_search

        def tot(a, b):
            return select(func.coalesce(func.sum(g.call_clicks), 0), func.coalesce(func.sum(g.direction_requests), 0),
                          func.coalesce(func.sum(g.website_clicks), 0), func.coalesce(func.sum(views), 0)).where(g.location_id == site.gbp_location_id, g.date.between(a, b))
        c = (await db.execute(tot(start, end))).one()
        p = (await db.execute(tot(pstart, pend))).one()
        local = {"calls": _metric(c[0], p[0]), "directions": _metric(c[1], p[1]), "website": _metric(c[2], p[2]), "views": _metric(c[3], p[3])}

    t0 = dt.datetime.combine(start, dt.time.min, tzinfo=dt.timezone.utc)
    t1 = dt.datetime.combine(end, dt.time.max, tzinfo=dt.timezone.utc)
    fixed = (await db.execute(select(SeoFinding).where(SeoFinding.site_id == site.id, SeoFinding.state == "closed", SeoFinding.outcome.in_(("fixed", "resolved")), SeoFinding.closed_at.between(t0, t1)))).scalars().all()
    open_ = (await db.execute(select(SeoFinding).where(SeoFinding.site_id == site.id, SeoFinding.state != "closed").order_by(SeoFinding.severity))).scalars().all()

    score = site.pillars or {}
    crawl = await crawl_block(db, site)
    steps = next_steps(open_, crawl)
    from app.models.gbp import GbpLocation
    from app.models.seo import SeoCrawl

    loc = await db.get(GbpLocation, site.gbp_location_id) if site.gbp_location_id else None
    last = (await db.execute(select(SeoCrawl.totals).where(SeoCrawl.site_id == site.id).order_by(SeoCrawl.imported_at.desc()).limit(1))).scalar_one_or_none()
    prev_snap = (await db.execute(select(SeoReport.snapshot).where(SeoReport.site_id == site.id, SeoReport.period_end < start)
                                  .order_by(SeoReport.period_end.desc()).limit(1))).scalar_one_or_none() or {}
    prev_recs = ((prev_snap.get("v2") or {}).get("recommendations") or prev_snap.get("nextSteps") or [])
    v2 = await report_v2.build(
        db, site, end, notes, [s for s in steps if not s.startswith("Keep the current plan")],
        no_backlinks=not (last or {}).get("linkMetrics"),
        cuisine=(loc.primary_category if loc else None), city=(loc.city if loc else None),
        crawl=crawl, prev_recs=[r for r in prev_recs if not r.startswith("Keep the current plan")],
    )
    return {
        "site": {"name": site.name, "domain": site.domain, "package": site.package,
                 "packageLabel": catalog.PACKAGES.get(site.package, {}).get("label", site.package), "segment": site.segment},
        "period": {"start": start.isoformat(), "end": end.isoformat(), "label": period_label(start, end, cadence), "cadence": cadence},
        "previous": {"start": pstart.isoformat(), "end": pend.isoformat()},
        "health": site.health, "grade": catalog.grade(site.health), "method": score.get("method", catalog.METHOD),
        "pillars": {k: {"label": v.get("label"), "score": v.get("score"), "grade": v.get("grade")} for k, v in (score.get("pillars") or {}).items()},
        "firstGlance": fg,
        "whatChanged": what_changed(fg),
        "dailyClicks": [{"date": d.isoformat(), "clicks": int(c)} for d, c in daily],
        "prevDailyClicks": [{"date": d.isoformat(), "clicks": int(c)} for d, c in prev_daily],
        "queriesMonth": m.isoformat(),
        "prevQueriesMonth": pm.isoformat(),
        "queries": [{"query": q.query, "clicks": q.clicks, "position": round(q.position, 2) if q.position else None,
                     "prevClicks": pq[q.query].clicks if q.query in pq else None,
                     "prevPosition": round(pq[q.query].position, 2) if q.query in pq and pq[q.query].position else None} for q in qs],
        "pages": [{"path": p.page.split(site.domain, 1)[-1] or "/", "clicks": p.clicks, "impressions": p.impressions} for p in pages],
        "keywords": kws,
        "local": local,
        "findings": {"fixed": [{"severity": f.severity, "title": f.title} for f in fixed],
                     "open": [{"severity": f.severity, "title": f.title} for f in open_[:10]], "openCount": len(open_)},
        "pending": [p["label"] for p in catalog.PLACEHOLDERS],
        # "What happens next": suggested from the top open findings; editable before sign-off.
        "nextSteps": steps,
        "crawl": crawl,
        "notes": notes,
        # Monthly report in the SEO team's format (report_v2.py); older reports don't have it.
        "v2": v2,
        "isDemo": site.source == "DEMO",
    }


async def generate(db: AsyncSession, site: SeoSite, start: dt.date, end: dt.date, user_id: Optional[str], cadence: Optional[str] = None) -> SeoReport:
    if end < start:
        raise ReportError("The period ends before it starts.")
    if end >= dt.date.today():
        raise ReportError("Pick a period that has already ended.")
    cadence = cadence or site.report_cadence
    r = (await db.execute(select(SeoReport).where(SeoReport.site_id == site.id, SeoReport.period_start == start, SeoReport.period_end == end))).scalar_one_or_none()
    if r and r.status in ("signed", "sent"):
        raise ReportError("This report is already signed off. It can't be regenerated.")
    snap = await build_snapshot(db, site, start, end, cadence)
    new = r is None
    if new:
        r = SeoReport(site_id=site.id, period_start=start, period_end=end, cadence=cadence)
        db.add(r)
    r.snapshot, r.status, r.error = snap, "awaiting_signoff", None
    r.generated_by_id, r.generated_at = user_id, utcnow()
    r.signed_by_id = r.signed_at = None
    await db.flush()
    return r


async def sign_off(db: AsyncSession, r: SeoReport, user_id: str) -> SeoReport:
    if r.status != "awaiting_signoff":
        raise ReportError("Only a report awaiting sign-off can be signed off.")
    r.status, r.signed_by_id, r.signed_at = "signed", user_id, utcnow()
    await db.flush()
    return r


async def email_status(db: AsyncSession) -> dict:
    """For Settings → Integrations. `state`: ready · not_connected · no_permission · error."""
    conn = await connection.current(db)
    if not conn:
        state = "not_connected"
    elif conn.status == "error":
        state = "error"
    elif not connection.granted(conn)["gmail"]:
        state = "no_permission"
    else:
        state = "ready"
    return {"configured": state == "ready", "state": state, "provider": "Gmail",
            "from": conn.google_email if conn else None, "fromName": get_settings().SEO_REPORT_FROM_NAME}


async def email_configured(db: AsyncSession) -> bool:
    return (await email_status(db))["configured"]


NOT_READY = {
    "not_connected": "E-mail isn't set up: connect Search Console & GA4 in Settings → Integrations (the same Google account sends the reports).",
    "no_permission": "E-mail isn't set up: reconnect Search Console & GA4 in Settings → Integrations and allow \"Send email on your behalf\".",
    "error": "The Google connection needs attention: reconnect it in Settings → Integrations.",
}


async def _gmail_send(db: AsyncSession, to: list[str], subject: str, html_body: str, text_body: str, http: Optional[httpx.AsyncClient] = None) -> None:
    """Send one message through the Gmail API as the connected account. Raises ReportError (safe to show)."""
    st = await email_status(db)
    if not st["configured"]:
        raise ReportError(NOT_READY[st["state"]])
    conn = await connection.current(db)
    msg = EmailMessage()
    msg["From"] = formataddr((st["fromName"], conn.google_email)) if st["fromName"] else conn.google_email
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg.set_content(text_body)
    msg.add_alternative(html_body, subtype="html")
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    own = http is None
    http = http or httpx.AsyncClient(timeout=30.0)
    try:
        try:
            token = await connection.access_token(db, http, conn)
        except (connection.NotConfigured, google.GoogleError) as exc:
            raise ReportError(getattr(exc, "friendly", None) or str(exc))
        resp = await http.post(GMAIL_SEND_URL, json={"raw": raw}, headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError as exc:
        raise ReportError(f"Couldn't reach Gmail ({exc.__class__.__name__}).")
    finally:
        if own:
            await http.aclose()
    if resp.status_code == 403 and "scope" in resp.text.lower():
        raise ReportError(NOT_READY["no_permission"])
    if resp.status_code == 403 and ("has not been used" in resp.text.lower() or "is disabled" in resp.text.lower()):
        raise ReportError("Gmail API is off in the Google Cloud project: APIs & Services → Library → Gmail API → Enable.")
    if resp.status_code >= 300:
        raise ReportError(f"Gmail refused it ({resp.status_code}): {resp.text[:200]}")


async def send_test(db: AsyncSession, to: str, http: Optional[httpx.AsyncClient] = None) -> str:
    """One short e-mail so a manager can check the setup before a client report goes out. Returns the sender."""
    await _gmail_send(
        db, [to], "Innowi Super App — test of SEO report e-mail",
        "<div style='font-family:Arial,sans-serif'><p>This is a test from Innowi Super App → Settings → Integrations.</p>"
        "<p>If you can read it, signed-off SEO reports will be delivered from this mailbox.</p></div>",
        "This is a test from Innowi Super App. If you can read it, signed-off SEO reports will be delivered from this mailbox.",
        http,
    )
    return (await connection.current(db)).google_email


def email_html(snap: dict, signed_by: Optional[str] = None, signed_at: Optional[str] = None) -> str:
    """The client e-mail: same sections, order and wording as the report preview (Module 9-R layout).
    Sections with no data source yet (backlinks, map pack, AI visibility, dropped sessions, orders) are left out.
    New-format reports (snapshot["v2"]) use the SEO team's monthly layout instead (email_html_v2)."""
    if snap.get("v2"):
        return email_html_v2(snap, signed_by, signed_at)
    e = html.escape
    fg = snap.get("firstGlance") or {}
    ink, line, faint, orange = "#111827", "#e5e7eb", "#6b7280", "#ea580c"

    def chg(m):
        if not m or m.get("change") is None:
            return ""
        c = m["change"] * 100
        return f"<div style='font-size:12px;font-weight:600;color:{'#15803d' if c >= 0 else '#b91c1c'}'>{c:+.0f}% vs prev</div>"

    def tile(label, value, sub=""):
        return (f"<td style='width:33%;padding:6px'><div style='border:1px solid {line};border-radius:10px;padding:10px 12px'>"
                f"<div style='font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:{faint};font-weight:700'>{label}</div>"
                f"<div style='font-size:22px;font-weight:700;color:{ink}'>{value}</div>{sub}</div></td>")

    def num(m):
        return f"{m['value']:,}" if m else "—"

    def sec(title):
        return f"<div style='margin:22px 0 8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:800;color:{orange}'>{e(title)}</div>"

    health = f"{snap['health']} <span style='font-size:13px;color:{faint}'>{snap.get('grade') or ''}</span>" if snap.get("health") is not None else "—"
    glance = ("<table style='width:100%;border-collapse:collapse'><tr>"
              + tile("Unique visitors", num(fg.get("users")), chg(fg.get("users")))
              + tile("Total visits", num(fg.get("sessions")), chg(fg.get("sessions")))
              + tile("Organic clicks", num(fg.get("organicClicks")), chg(fg.get("organicClicks")))
              + "</tr><tr>"
              + tile("Google impressions", num(fg.get("impressions")), chg(fg.get("impressions")))
              + tile("Key events", num(fg.get("keyEvents")), chg(fg.get("keyEvents")))
              + tile("SEO health", health, f"<div style='font-size:11px;color:{faint}'>six-pillar weighted</div>")
              + "</tr></table>")
    changed = "".join(f"<li style='margin:2px 0'>{e(x)}</li>" for x in snap.get("whatChanged", [])) or "<li>Not enough data for this period yet.</li>"
    th = f"style='text-align:left;padding:6px 8px;border-bottom:1px solid {line};font-size:11px;color:{faint};text-transform:uppercase'"
    td = f"style='padding:6px 8px;border-bottom:1px solid {line};font-size:13px'"
    pm, cm = _month_name(snap.get("prevQueriesMonth")), _month_name(snap.get("queriesMonth"))
    q = "".join(f"<tr><td {td}>{e(x['query'])}</td><td {td}>{x.get('prevClicks') if x.get('prevClicks') is not None else '—'}</td><td {td}><b>{x['clicks']:,}</b></td>"
                f"<td {td}>{x.get('prevPosition') or '—'}</td><td {td}>{x.get('position') or '—'}</td></tr>" for x in snap.get("queries", [])[:8])
    pills = "".join(
        f"<tr><td style='padding:3px 8px 3px 0;font-size:13px;width:160px'>{e(v.get('label') or k)}</td><td style='padding:3px 0'>"
        f"<div style='background:#f3f4f6;border-radius:4px;height:8px;width:100%'><div style='height:8px;border-radius:4px;width:{v.get('score') or 0}%;"
        f"background:{'#16a34a' if (v.get('score') or 0) >= 70 else '#d97706' if (v.get('score') or 0) >= 55 else '#dc2626'}'></div></div></td>"
        f"<td style='padding:3px 0 3px 8px;font-size:13px;font-weight:700;width:36px;text-align:right'>{v.get('score') if v.get('score') is not None else '—'}</td></tr>"
        for k, v in (snap.get("pillars") or {}).items())
    local = snap.get("local")
    loc = (f"<p style='font-size:14px;line-height:1.7;margin:0'>Google Business Profile: <b>{num(local.get('views'))}</b> profile views · <b>{num(local.get('calls'))}</b> calls · "
           f"<b>{num(local.get('directions'))}</b> direction requests · <b>{num(local.get('website'))}</b> website clicks.</p>") if local else ""
    kw = "".join(
        f"<tr><td {td}>{e(k['keyword'])}</td><td {td}>{k.get('previous') or '—'}</td><td {td}><b>{k.get('position') or '—'}</b></td><td {td}>"
        + (f"<span style='color:#15803d'>▲ {round(k['previous'] - k['position'], 1):g}</span>" if k.get("position") and k.get("previous") and k["position"] < k["previous"]
           else f"<span style='color:#b91c1c'>▼ {round(k['position'] - k['previous'], 1):g}</span>" if k.get("position") and k.get("previous") and k["position"] > k["previous"] else "—")
        + "</td></tr>" for k in snap.get("keywords", [])[:10])
    steps = "".join(f"<li style='margin:3px 0'>{e(x)}</li>" for x in snap.get("nextSteps") or [])
    cr = snap.get("crawl")
    crawl_html = ""
    if cr:
        pc = {"High": "#b91c1c", "Medium": "#b45309", "Low": faint}
        rows = "".join(
            f"<tr><td {td}><span style='font-size:11px;font-weight:700;color:{pc.get(i['priority'], faint)}'>{e(i['priority'])}</span></td>"
            f"<td {td}>{e(i['name'])}</td><td {td} align='right'>{i['urls']:,}</td></tr>" for i in cr.get("top", [])[:6])
        crawl_html = (f"<p style='font-size:14px;line-height:1.6;margin:0 0 6px'>We checked every page of the website: <b>{(cr.get('pages') or 0):,}</b> pages, "
                      f"<b>{(cr.get('indexable') or 0):,}</b> indexable, <b>{cr.get('broken') or 0}</b> broken, <b>{cr.get('redirects') or 0}</b> redirects"
                      + (f", average <b>{cr['avgWords']}</b> words per page" if cr.get("avgWords") is not None else "") + ".</p>"
                      + (f"<table style='width:100%;border-collapse:collapse'><tr><th {th}>Priority</th><th {th}>Issue</th><th {th}>Pages</th></tr>{rows}</table>" if rows else ""))
    sign = (f"<b>{e(signed_by)}</b> — digitally signed {e(signed_at or '')}" if signed_by else "Prepared by Innowi")
    return (
        f"<div style='font-family:Arial,Helvetica,sans-serif;color:{ink};max-width:680px;margin:0 auto;border:1px solid {line};border-radius:12px;overflow:hidden'>"
        f"<div style='background:#0f172a;color:#fff;padding:18px 24px'><table style='width:100%'><tr>"
        f"<td style='font-size:18px;font-weight:700'><span style='color:{orange}'>●</span> innowi <span style='font-size:12px;font-weight:400;color:#94a3b8'>SEO Performance Report</span></td>"
        f"<td style='text-align:right;font-size:11px;color:#94a3b8'>{e((snap.get('period') or {}).get('cadence', '').title())} report<br><b style='color:#fff;font-size:13px'>{e((snap.get('period') or {}).get('label', ''))}</b></td></tr></table></div>"
        f"<div style='padding:12px 24px;border-bottom:1px solid {line}'><span style='font-size:18px;font-weight:700'>{e(snap['site']['name'])}</span> "
        f"<span style='font-size:12px;color:{faint}'>· {e(snap['site']['domain'])} · {e(snap['site'].get('packageLabel') or '')}</span></div>"
        f"<div style='padding:4px 24px 20px'>"
        + sec("First glance") + glance
        + sec("What changed") + f"<ul style='padding-left:18px;margin:0;font-size:14px;line-height:1.6'>{changed}</ul>"
        + (sec("Top search queries — actual terms") + f"<table style='width:100%;border-collapse:collapse'><tr><th {th}>Query</th><th {th}>{pm} clicks</th><th {th}>{cm} clicks</th><th {th}>{pm} pos.</th><th {th}>{cm} pos.</th></tr>{q}</table>"
           f"<div style='font-size:11px;color:{faint};margin-top:4px'>Google hides very low-volume searches, so these rows add up to less than the site total.</div>" if q else "")
        + (sec("Site health — on-page SEO") + f"<table style='width:100%;border-collapse:collapse'>{pills}</table>" if pills else "")
        + (sec("Full-site technical check") + crawl_html if crawl_html else "")
        + (sec("Local SEO — Google Business Profile") + loc if loc else "")
        + (sec("Keyword positions — Google average (Search Console)") + f"<table style='width:100%;border-collapse:collapse'><tr><th {th}>Keyword</th><th {th}>Prev. month</th><th {th}>This month</th><th {th}>Change</th></tr>{kw}</table>" if kw else "")
        + (sec("What happens next") + f"<ol style='padding-left:18px;margin:0;font-size:14px;line-height:1.6'>{steps}</ol>" if steps else "")
        + f"</div><div style='padding:12px 24px;border-top:1px solid {line};background:#f9fafb;font-size:12px;color:{faint}'>{sign} · © Innowi Inc. "
          f"Figures from Google Search Console, Google Analytics and Google Business Profile{' plus a full-site crawl (Screaming Frog)' if cr else ''}.</div></div>"
    )


def email_html_v2(snap: dict, signed_by: Optional[str] = None, signed_at: Optional[str] = None) -> str:
    """Monthly report e-mail in the SEO team's layout (see report_v2.py); same order as the report preview."""
    e = html.escape
    v = snap["v2"]
    ink, line, faint, orange, red = "#111827", "#e5e7eb", "#6b7280", "#ea580c", "#b91c1c"
    th = f"style='text-align:left;padding:6px 8px;border-bottom:1px solid {line};font-size:11px;color:{faint};text-transform:uppercase'"
    td = f"style='padding:6px 8px;border-bottom:1px solid {line};font-size:13px'"
    cm, pmn = v["monthLabel"].split(" ")[0][:3], v["prevMonthLabel"].split(" ")[0][:3]

    def sec(title):
        return f"<div style='margin:24px 0 8px;font-size:15px;font-weight:800;color:{ink}'>{e(title)}</div>"

    def fmt(x, kind="n"):
        if x is None:
            return "—"
        return f"{x * 100:.2f}%" if kind == "pct" else (f"{x:.2f}" if kind == "pos" else f"{x:,}")

    nt = v.get("notes") or {}

    def note(key):
        return "".join(f"<p style='font-size:13px;line-height:1.65;margin:8px 0 0;color:#374151'>{e(p)}</p>" for p in nt.get(key) or [])

    def table(head, rows):
        if not rows:
            return ""
        return (f"<table style='width:100%;border-collapse:collapse'><tr>{''.join(f'<th {th}>{e(h)}</th>' for h in head)}</tr>"
                + "".join("<tr>" + "".join(f"<td {td}>{c}</td>" for c in r) + "</tr>" for r in rows) + "</table>")

    km = v.get("keyMetrics") or {}
    cur, prev = km.get("cur") or {}, km.get("prev") or {}

    def tile(label, val, sub):
        return (f"<td style='width:25%;padding:5px'><div style='border:1px solid {line};border-radius:10px;padding:10px'>"
                f"<div style='font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:{faint};font-weight:700'>{label}</div>"
                f"<div style='font-size:22px;font-weight:700'>{val}</div><div style='font-size:11px;color:{faint}'>{sub}</div></div></td>")

    def ch(a, b):
        return f"{(a - b) / b * 100:+.1f}% vs {pmn} ({b:,})" if a is not None and b else ""

    tiles = ""
    if cur:
        tiles = ("<table style='width:100%;border-collapse:collapse'><tr>"
                 + tile(f"{cm} clicks", fmt(cur.get("clicks")), ch(cur.get("clicks"), prev.get("clicks")))
                 + tile(f"{cm} impressions", fmt(cur.get("impressions")), ch(cur.get("impressions"), prev.get("impressions")))
                 + tile("Avg. CTR", fmt(cur.get("ctr"), "pct"), f"vs {fmt(prev.get('ctr'), 'pct')} in {pmn}" if prev else "")
                 + tile("Avg. position", fmt(cur.get("position"), "pos"), f"vs {fmt(prev.get('position'), 'pos')} in {pmn}" if prev else "")
                 + "</tr></table>")
    months = table(["Month", "Clicks", "Impressions", "Avg. CTR", "Avg. position", "MoM clicks"],
                   [[e(m["label"]), fmt(m["clicks"]), fmt(m["impressions"]), fmt(m["ctr"], "pct"), fmt(m["position"], "pos"),
                     "—" if m.get("clicksChange") is None else f"{m['clicksChange'] * 100:+.1f}%"] for m in v.get("months") or []])
    b = v.get("brand")
    brand = ""
    if b and b.get("trackedClicks"):
        brand = table(["", "Clicks", "Impressions", "CTR", "Share of clicks"],
                      [["Branded", fmt(b["branded"]["clicks"]), fmt(b["branded"]["impressions"]), fmt(b["branded"]["ctr"], "pct"), fmt(b["brandedShare"], "pct")],
                       ["Non-branded", fmt(b["generic"]["clicks"]), fmt(b["generic"]["impressions"]), fmt(b["generic"]["ctr"], "pct"),
                        fmt(1 - b["brandedShare"], "pct") if b["brandedShare"] is not None else "—"]])
    hl = v.get("highlight")
    hl_html = ""
    if hl:
        rows = ""
        if hl.get("rows"):
            rows = table(["Page", f"{pmn} impr.", f"{cm} impr.", "Position", "Status"],
                         [[e(r["path"]), fmt(r["prevImpressions"]), fmt(r["impressions"]), fmt(r["position"], "pos"), e(r["status"])] for r in hl["rows"]])
        elif hl.get("queries"):
            rows = table(["Search", "Impressions", "Clicks", "Position"], [[e(q["query"]), fmt(q["impressions"]), fmt(q["clicks"]), fmt(q["position"], "pos")] for q in hl["queries"]])
        hl_text = nt.get("highlight") if "highlight" in nt else [hl["text"]]
        hl_html = sec(hl["title"]) + "".join(f"<p style='font-size:14px;line-height:1.6;margin:0 0 8px'>{e(p)}</p>" for p in hl_text or []) + rows
    pg = v.get("progress")
    prog_html = ""
    if pg:
        prog_html = (sec(pg["title"]) + "".join(f"<p style='font-size:14px;line-height:1.6;margin:0 0 8px'>{e(p)}</p>" for p in nt.get("progress") or [])
                     + "<ol style='padding-left:18px;margin:0;font-size:13px;line-height:1.6'>"
                     + "".join(f"<li style='margin:4px 0'>{e(i['text'])}" + (f"<div style='color:{faint}'>{e(i['evidence'])}</div>" if i.get("evidence") else "") + "</li>"
                               for i in pg["items"]) + "</ol>")
    queries = table(["Search", f"{pmn} clicks", f"{cm} clicks", f"{cm} impr.", "CTR", f"{cm} position"],
                    [[e(q["query"]), fmt(q.get("prevClicks")), f"<b>{fmt(q['clicks'])}</b>", fmt(q["impressions"]), fmt(q.get("ctr"), "pct"), fmt(q.get("position"), "pos")]
                     for q in v.get("queries") or []])
    pages = table(["Page", f"{pmn} clicks", f"{cm} clicks", f"{pmn} impr.", f"{cm} impr.", "Position"],
                  [[e(p["path"]) + (" <b style='color:#b91c1c'>(SPAM)</b>" if p.get("spam") else ""), fmt(p.get("prevClicks")), f"<b>{fmt(p['clicks'])}</b>",
                    fmt(p.get("prevImpressions")), fmt(p["impressions"]), fmt(p.get("position"), "pos")] for p in v.get("pages") or []])
    devices = table(["Device", f"{pmn} clicks", f"{cm} clicks", f"{cm} impr.", "CTR", f"{pmn} pos.", f"{cm} pos."],
                    [[e(d["device"]), fmt(d.get("prevClicks")), f"<b>{fmt(d['clicks'])}</b>", fmt(d["impressions"]), fmt(d.get("ctr"), "pct"),
                      fmt(d.get("prevPosition"), "pos"), fmt(d.get("position"), "pos")] for d in v.get("devices") or []])
    co = v.get("countries")
    geo = table(["Country", "Clicks", "Impressions"], [[e(c["country"]), fmt(c["clicks"]), fmt(c["impressions"])] for c in co.get("top") or []]) if co else ""
    cr = snap.get("crawl")
    crawl_html = ""
    if cr:
        crawl_html = (f"<p style='font-size:14px;line-height:1.6;margin:0 0 6px'>We checked every page of the website (Screaming Frog): <b>{(cr.get('pages') or 0):,}</b> pages, "
                      f"<b>{(cr.get('indexable') or 0):,}</b> indexable, <b>{cr.get('broken') or 0}</b> broken, <b>{cr.get('redirects') or 0}</b> redirects.</p>"
                      + table(["Priority", "Issue", "Pages"], [[e(i["priority"]), e(i["name"]), fmt(i["urls"])] for i in (cr.get("top") or [])[:6]]))
    alert = v.get("alert")
    alert_html = (f"<div style='border:2px solid {red};background:#fef2f2;border-radius:10px;padding:12px 14px;margin:14px 0'>"
                  f"<div style='font-weight:800;color:{red};font-size:14px'>{e(alert['title'])}</div><div style='font-size:13px;line-height:1.6;margin-top:4px'>{e(alert['text'])}</div></div>") if alert else ""
    summary = "".join(f"<p style='font-size:14px;line-height:1.7;margin:0 0 10px'>{e(p)}</p>" for p in v.get("summary") or [])
    recs = "".join(f"<li style='margin:4px 0'>{e(r)}</li>" for r in v.get("recommendations") or [])
    notes = " ".join(e(n) for n in v.get("dataNotes") or [])
    sign = f"<b>{e(signed_by)}</b> — digitally signed {e(signed_at or '')}" if signed_by else "Prepared by Innowi SEO Department"
    return (
        f"<div style='font-family:Arial,Helvetica,sans-serif;color:{ink};max-width:720px;margin:0 auto;border:1px solid {line};border-radius:12px;overflow:hidden'>"
        f"<div style='background:#0f172a;color:#fff;padding:18px 24px'><div style='font-size:12px;letter-spacing:.12em;color:#94a3b8;font-weight:700'>SEO PERFORMANCE REPORT</div>"
        f"<div style='font-size:20px;font-weight:700;margin-top:4px'>{e(snap['site']['name'])} — {e(snap['site']['domain'])}</div>"
        f"<div style='font-size:12px;color:#cbd5e1;margin-top:4px'>Reporting month: {e(v['monthLabel'])} (compared with {e(v['prevMonthLabel'])})</div></div>"
        f"<div style='padding:4px 24px 20px'>{alert_html}"
        + sec("Executive Summary") + summary
        + (sec(f"Key Metrics — {v['monthLabel']}") + tiles + months + note("metrics") if tiles else "")
        + (sec("Branded vs. Non-Branded Search") + brand + note("brand") if brand else "")
        + hl_html + prog_html
        + (sec(f"Top Performing Queries — {v['monthLabel']}") + queries + note("queries") if queries else "")
        + (sec("Page-Level Performance") + pages + note("pages") if pages else "")
        + (sec("Device Breakdown") + devices + note("devices") if devices else "")
        + (sec("Geographic Distribution") + geo + note("geo") if geo else "")
        + (sec("Full-site technical check") + crawl_html + note("crawl") if crawl_html else "")
        + (sec("Recommendations") + f"<ul style='padding-left:18px;margin:0;font-size:14px;line-height:1.6'>{recs}</ul>" if recs else "")
        + f"<div style='margin-top:18px;font-size:11px;line-height:1.6;color:{faint}'><b>Sources:</b> {e(v.get('sources') or '')}. {notes}</div>"
        + f"</div><div style='padding:12px 24px;border-top:1px solid {line};background:#f9fafb;font-size:12px;color:{faint}'>{sign} · © Innowi Inc.</div></div>"
    )


def _month_name(iso: Optional[str]) -> str:
    if not iso:
        return ""
    return MONTHS[int(iso[5:7]) - 1][:3]


async def send(db: AsyncSession, r: SeoReport, recipients: list[str], http: Optional[httpx.AsyncClient] = None) -> SeoReport:
    if r.status not in ("signed", "failed"):
        raise ReportError("Sign the report off first — unsigned reports never send.")
    if not recipients:
        raise ReportError("Add at least one recipient e-mail.")
    st = await email_status(db)
    if not st["configured"]:
        raise ReportError(NOT_READY[st["state"]])
    snap = r.snapshot or {}
    site, period = snap.get("site", {}), snap.get("period", {})
    subject = f"{site.get('name', 'Your')} — SEO report, {period.get('label', '')}"
    text = f"{site.get('name', '')} — SEO report, {period.get('label', '')}. Open this e-mail in an HTML-capable mail app to see the figures."
    r.recipients = recipients
    try:
        signer = await db.get(User, r.signed_by_id) if r.signed_by_id else None
        signed_by = (f"{signer.first_name or ''} {signer.last_name or ''}".strip() or signer.email) if signer else None
        signed_at = r.signed_at.strftime("%b %d, %Y") if r.signed_at else None
        await _gmail_send(db, recipients, subject, email_html(snap, signed_by, signed_at), text, http)
        r.status, r.sent_at, r.error = "sent", utcnow(), None
    except ReportError as exc:
        r.status, r.error = "failed", str(exc)
    await db.flush()
    return r


async def auto_assemble(db: AsyncSession, today: Optional[dt.date] = None) -> int:
    """Assemble each active site's due report once its data has arrived
    (Search Console lags 2–3 days). Never touches signed or sent reports."""
    today = today or dt.date.today()
    made = 0
    for site in (await db.execute(select(SeoSite).where(SeoSite.status == "active"))).scalars().all():
        start, end, _due = views.next_period(site.report_cadence, today)
        if site.gsc_property and (not site.last_gsc_date or site.last_gsc_date < end) and today < end + dt.timedelta(days=5):
            continue
        if (await db.execute(select(SeoReport.id).where(SeoReport.site_id == site.id, SeoReport.period_start == start, SeoReport.period_end == end))).scalar_one_or_none():
            continue
        try:
            await generate(db, site, start, end, None)
            made += 1
        except ReportError:
            continue
    await db.commit()
    return made
