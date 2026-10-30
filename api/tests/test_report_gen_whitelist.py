"""Report Generator: the read whitelist and the payload scan (no database)."""
from __future__ import annotations

import pytest

from app.modules.report_gen import whitelist
from app.modules.report_gen.assemble import REASONS, ads, blogs, seo, stub


def test_every_assembler_reads_only_whitelisted_columns():
    for mod in (ads, seo, blogs):
        assert whitelist.check_reads(mod.READS) == [], mod.__name__


def test_whitelist_never_allows_blocked_tables_or_columns():
    for table in ("payments.merchant_payment", "payments.opportunity", "ops.ticket_comment", "ops.credential", "audit.audit_log",
                  "marketing.ads_comment", "marketing.gbp_note", "profiling.merchant_churn", "quotes.quote_request", "salesforce.account"):
        assert table not in whitelist.ALLOWED
    assert not {"account_health", "next_action", "open_blockers", "notes", "source", "source_detail", "report_recipients"} & whitelist.ALLOWED["profiling.merchant"]
    assert "mrr" not in whitelist.ALLOWED["profiling.subscription"]
    assert not {"name", "phone"} & whitelist.ALLOWED["profiling.contact"]
    assert not {"reviewer_name", "comment"} & whitelist.ALLOWED["marketing.gbp_review"]
    # Ops read is title, type, status and dates only (Ahmed, 2026-10-30).
    assert not {"description", "notes", "comments"} & whitelist.ALLOWED["ops.ticket"]
    assert whitelist.check_reads({"ops.ticket": ("title", "type", "status", "due_date")}) == []
    assert whitelist.check_reads({"ops.ticket": ("description",)}) == ["ops.ticket.description"]
    assert whitelist.check_reads({"payments.merchant_payment": ("orders_revenue",)}) == ["payments.merchant_payment.*"]


def test_scan_passes_a_clean_payload_and_catches_blocked_keys():
    clean = {"merchant": {"id": "m1", "name": "Gaters"}, "sections": {"ads": {"metrics": [{"id": "ADS01", "value": 1}]}},
             "recipients": ["owner@gaters.example"], "summary": ["x"]}
    assert whitelist.scan(clean) == []
    poisoned = {"merchant": {"id": "m1", "accountHealth": "RED", "notes": "do not share", "contract_amount": 199},
                "sections": {"ops": {"tickets": [{"title": "ok", "comments": ["internal"]}]}}, "partnerPayout": 5,
                "contact": {"email": "x@y.z", "phone": "555"}}
    hits = whitelist.scan(poisoned)
    assert "merchant.accountHealth" in hits and "merchant.notes" in hits and "merchant.contract_amount" in hits
    assert "sections.ops.tickets[0].comments" in hits and "partnerPayout" in hits
    assert "contact.phone" in hits and "contact.email" in hits
    with pytest.raises(whitelist.WhitelistError):
        whitelist.assert_clean(poisoned)


def test_email_is_allowed_only_in_the_recipients_block():
    assert whitelist.scan({"recipients": [{"email": "a@b.c"}]}) == []
    assert whitelist.scan({"sections": {"ops": {"email": "a@b.c"}}}) == ["sections.ops.email"]


def test_stubs_cover_every_segment_with_a_known_reason():
    for key in ("sales", "website", "gbp", "email_sms", "rewards", "reviews", "ops"):
        s = stub.build(key, "module_not_connected")
        assert s["included"] and s["metrics"] and all(m["value"] is None for m in s["metrics"])
        assert all(m["reasonText"] == REASONS["module_not_connected"] for m in s["metrics"])
        assert len(s["missing"]) == len(s["metrics"])
        assert whitelist.scan(s) == []
    with pytest.raises(ValueError):
        stub.build("sales", "no_such_reason")
    hidden = stub.build("rewards", "module_not_connected", included=False)
    assert hidden["included"] is False and hidden["metrics"] == [] and hidden["missing"] == []
