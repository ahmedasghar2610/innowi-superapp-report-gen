"""Where a merchant or an organization record came from.

Every merchant and organization keeps a ``source`` (one of the keys below) and an
optional ``source_detail`` (the file name, website slug or deal number), so the
team can tell a restaurant someone typed in from one a workbook created, and the
Super App's own records from the read-only Salesforce copy.

The key is set by the code path that creates the record; nobody edits it. Records
that existed before 2026-10-27 were backfilled by migration 52db630116b8 from
what they carried (notes written by the connector, the churn record, the
workbook Merchant ID). What it could not tell is left empty ("Not recorded").
"""
from __future__ import annotations

# key -> label shown in the app (web: features/sources/labels.ts mirrors this).
MERCHANT_SOURCES: dict[str, str] = {
    "MANUAL": "Added by hand",
    "NEW_DEAL": "New deal",
    "MERCHANT_IMPORT": "Marketing import",
    "CHURN_IMPORT": "Churn workbook",
    "GOOGLE_PROFILE": "Google Business Profile",
    "SEO_ADS": "SEO site / Ads account",
    "WEBSITE": "Website",
    "SALESFORCE": "Salesforce",
    "SAMPLE": "Sample data",
}

ORGANIZATION_SOURCES: dict[str, str] = {
    "MANUAL": "Added by hand",
    "SPREADSHEET": "Spreadsheet import",
    "PARTNER_LEAD": "Partner application",
    "BUSINESS_CARD": "Business card",
    "AGENT_LIST": "Agent list",
    "SALESFORCE": "Salesforce",
}

# Query value for "records whose source was never recorded".
NOT_RECORDED = "NONE"

SOURCE_LEN = 30
DETAIL_LEN = 300


def detail(value: object) -> str | None:
    """A source detail trimmed to fit the column (None when empty)."""
    text = str(value or "").strip()
    return text[:DETAIL_LEN] or None
