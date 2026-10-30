"""Fixed reference data for the SEO module: pillars, KPI defaults, packages,
finding workflow states. Pure data — no database, no network."""
from __future__ import annotations

# ------------------------------------------------------------- pillars ----
# Six-pillar scorecard from the SEO Command prototype. Weights add up to 100.
# This is the DRAFT method (v0): every number comes from synced data, nothing
# is invented, and a pillar without its data source is shown as pending
# instead of guessed. Agree the method before targets are set (KPI Studio).
PILLARS: list[dict] = [
    {"key": "cp", "label": "Content", "long": "Content reach", "weight": 15, "source": "Search Console"},
    {"key": "ws", "label": "Website Strategy", "long": "Website strategy & speed", "weight": 25, "source": "PageSpeed + page checks"},
    {"key": "au", "label": "Audits", "long": "Technical SEO audits", "weight": 20, "source": "Screaming Frog crawl (or page checks) + URL Inspection"},
    {"key": "rt", "label": "ROI & Tracking", "long": "ROI & tracking", "weight": 15, "source": "GA4 + Search Console"},
    {"key": "ls", "label": "Local SEO", "long": "Local SEO", "weight": 15, "source": "Google Business Profile"},
    {"key": "pa", "label": "Paid Align", "long": "Paid alignment", "weight": 10, "source": "Google Ads"},
]
PILLAR_KEYS = [p["key"] for p in PILLARS]
METHOD = "draft-v0"
MIN_PILLARS_FOR_HEALTH = 3
# A Screaming Frog crawl older than this no longer scores the Audits pillar or raises findings.
CRAWL_MAX_AGE_DAYS = 90


def grade(score: int | float | None) -> str | None:
    if score is None:
        return None
    return "A" if score >= 85 else "B" if score >= 70 else "C" if score >= 55 else "D"


# ------------------------------------------------------------ packages ----
PACKAGES: dict[str, dict] = {
    "normal": {"label": "Normal", "cadence": "quarterly", "reports": "Quarterly reporting"},
    "199": {"label": "$199", "cadence": "monthly", "reports": "Monthly + Quarterly"},
    "299": {"label": "$299", "cadence": "monthly", "reports": "Bi-weekly · Monthly · Quarterly · ROI"},
    "internal": {"label": "Internal", "cadence": "monthly", "reports": "Monthly"},
}
CADENCES = ("biweekly", "monthly", "quarterly")
SEGMENTS = ("Restaurant", "Cafe", "Bakery", "Food Truck", "Grocery Outlet", "Catering", "Other")
SITE_STATUSES = ("active", "paused")

# --------------------------------------------------------- findings ----
SEVERITIES = ("S1", "S2", "S3")
# Response SLA per severity (KPI K1-SLA), hours.
SLA_HOURS = {"S1": 24, "S2": 48, "S3": 24 * 7}
SLA_LABEL = {"S1": "respond same business day", "S2": "respond within 48h", "S3": "respond within a week"}

STATES = ("detected", "recommended", "task_created", "in_progress", "awaiting_verification", "closed")
OPEN_STATES = STATES[:-1]
STATE_GROUPS = {
    "needs_decision": ("detected", "recommended"),
    "in_flight": ("task_created", "in_progress"),
    "awaiting_verification": ("awaiting_verification",),
    "closed": ("closed",),
}
TEAMS = ("SEO", "Web Development", "Analytics")

# ------------------------------------------------------------- KPIs ----
# KPI Studio defaults, verbatim from the prototype's registry. Targets marked
# TBD/proposed stay that way until agreed (DR-KPI-01).
KPI_SETS = {
    1: "Set-1 · Top-tier KPIs — must do",
    2: "Set-2 · Quality & UX/UI KPIs",
    3: "Set-3 · $199 marketing clients",
    4: "Set-4 · $299 super accounts",
}
KPI_SET_NOTES = {
    1: "internal ops · the six pillars + severity SLAs",
    2: "build quality gates + product experience budgets",
    3: "client scorecard for the $199 package",
    4: "super-account scorecard for the $299 package (ROI)",
}
DEFAULT_KPIS: list[dict] = [
    {"key": "K1-CP", "set": 1, "name": "Content Production pillar", "grader": "score", "target": "TBD (DR-KPI-01)", "source": "Search Console"},
    {"key": "K1-WS", "set": 1, "name": "Website Strategy pillar", "grader": "score", "target": "TBD (DR-KPI-01)", "source": "PageSpeed + page checks"},
    {"key": "K1-AU", "set": 1, "name": "SEO Audits pillar", "grader": "score", "target": "TBD (DR-KPI-01)", "source": "Search Console"},
    {"key": "K1-RT", "set": 1, "name": "ROI & Tracking pillar", "grader": "score", "target": "TBD (DR-KPI-01)", "source": "GA4"},
    {"key": "K1-LS", "set": 1, "name": "Local SEO pillar", "grader": "band", "target": "B or better", "source": "Google Business Profile"},
    {"key": "K1-PA", "set": 1, "name": "Paid alignment pillar", "grader": "score", "target": "TBD (DR-KPI-01)", "source": "Google Ads"},
    {"key": "K1-SLA", "set": 1, "name": "Alert response (S1/S2/S3)", "grader": "sla", "target": "same-day / 48h / weekly", "source": "Findings workflow"},
    {"key": "K2-GATE", "set": 2, "name": "Quality-gate first-pass rate", "grader": "gate", "target": "≥ 85% (proposed)", "source": "Content tree (on hold)"},
    {"key": "K2-CWV", "set": 2, "name": "Core Web Vitals pass rate", "grader": "gate", "target": "≥ 75% URLs (proposed)", "source": "PageSpeed Insights"},
    {"key": "K2-P95", "set": 2, "name": "Dashboard p95 load", "grader": "gate", "target": "< 3s (proposed)", "source": "internal"},
    {"key": "K2-ADOPT", "set": 2, "name": "In-platform execution share", "grader": "score", "target": "≥ 80% (proposed)", "source": "internal"},
    {"key": "K2-AUTOREP", "set": 2, "name": "Report automation rate", "grader": "score", "target": "100%", "source": "Reports"},
    {"key": "K2-A11Y", "set": 2, "name": "WCAG-AA on client sites", "grader": "gate", "target": "pass (proposed)", "source": "Site crawler (on hold)"},
    {"key": "K3-VIS", "set": 3, "name": "Keyword visibility movement", "grader": "trend", "target": "positive 3-mo trend", "source": "Search Console"},
    {"key": "K3-GBP", "set": 3, "name": "GBP actions (calls · directions · clicks)", "grader": "trend", "target": "positive MoM", "source": "Google Business Profile"},
    {"key": "K3-LOC", "set": 3, "name": "Local health grade", "grader": "band", "target": "B or better", "source": "Google Business Profile"},
    {"key": "K3-CAD", "set": 3, "name": "Publish cadence kept", "grader": "gate", "target": "100% of plan", "source": "Publishing queue (on hold)"},
    {"key": "K3-REP", "set": 3, "name": "Monthly report on time", "grader": "sla", "target": "by the 3rd", "source": "Reports"},
    {"key": "K4-ROI", "set": 4, "name": "Orders attributed to organic + local", "grader": "trend", "target": "TBD (DR-KPI-03)", "source": "Ordering feed (on hold)"},
    {"key": "K4-CPL", "set": 4, "name": "Blended organic+paid CPL", "grader": "trend", "target": "declining", "source": "Google Ads + GA4"},
    {"key": "K4-FULL", "set": 4, "name": "Full six-pillar client scorecard", "grader": "band", "target": "B or better", "source": "Scorecard"},
    {"key": "K4-QBR", "set": 4, "name": "Quarterly strategy review held", "grader": "gate", "target": "1 / quarter", "source": "internal"},
    {"key": "K4-SLA", "set": 4, "name": "Priority response SLA", "grader": "sla", "target": "24h (proposed)", "source": "Findings workflow"},
]
GRADERS = ("score", "band", "sla", "gate", "trend")
KPI_STATUSES = ("proposed", "active", "retired")

# -------------------------------------------------------- placeholders ----
# Data still to come. Backlinks come from Screaming Frog once a link-data API
# (Ahrefs / Majestic / Moz) is connected inside it; competitors and citations
# are not something Screaming Frog measures. Shown as "Pending" — never estimated.
PLACEHOLDERS: list[dict] = [
    {"key": "backlinks", "label": "Backlinks & authority", "source": "Screaming Frog link metrics (placeholder)"},
    {"key": "competitors", "label": "Competitor visibility", "source": "Not in Screaming Frog — source not chosen"},
    {"key": "citations", "label": "Directory citations", "source": "Not in Screaming Frog — source not chosen"},
]
