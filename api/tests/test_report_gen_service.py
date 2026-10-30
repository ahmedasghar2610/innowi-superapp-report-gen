"""Report Generator lifecycle rules (pure checks; no database)."""
from __future__ import annotations

import datetime as dt

import pytest

from app.modules.report_gen import service as s

NOW = dt.datetime(2026, 10, 3, 9, 0, tzinfo=dt.timezone.utc)


def test_generate_allowed_for_new_draft_failed_and_deleted_only():
    for status in (None, "draft", "edited", "failed", "deleted"):
        s.check_generate(status)
    for status in ("approved", "sent", "generating"):
        with pytest.raises(s.ReportError):
            s.check_generate(status)


def test_edit_only_while_draft_or_edited():
    s.check_edit("draft")
    s.check_edit("edited")
    for status in ("approved", "sent", "failed", "deleted", "generating"):
        with pytest.raises(s.ReportError):
            s.check_edit(status)


def test_four_eyes_rule_on_approval():
    # another manager may approve
    s.check_approve("draft", generated_by_id="u_gen", user_id="u_mgr", user_role="MARKETING_MANAGER")
    s.check_approve("edited", generated_by_id="u_gen", user_id="u_mgr", user_role="MARKETING_MANAGER")
    # the generator of this version may not — unless Admin / Super Admin (pilot exemption)
    with pytest.raises(s.ReportError, match="cannot approve"):
        s.check_approve("draft", generated_by_id="u_gen", user_id="u_gen", user_role="MARKETING_MANAGER")
    s.check_approve("draft", generated_by_id="u_gen", user_id="u_gen", user_role="ADMIN")
    s.check_approve("draft", generated_by_id="u_gen", user_id="u_gen", user_role="SUPER_ADMIN")
    # only drafts can be approved
    for status in ("approved", "sent", "failed", "deleted", "generating"):
        with pytest.raises(s.ReportError):
            s.check_approve(status, "u_gen", "u_mgr", "ADMIN")


def test_delete_is_soft_and_never_for_sent_reports():
    for status in ("draft", "edited", "approved", "failed"):
        s.check_delete(status)
    with pytest.raises(s.ReportError, match="sent"):
        s.check_delete("sent")
    with pytest.raises(s.ReportError, match="already deleted"):
        s.check_delete("deleted")
    with pytest.raises(s.ReportError):
        s.check_delete("generating")


def test_send_needs_approval_and_happens_once():
    s.check_send("approved", approved_at=NOW, sent_at=None, already_sent_version=False)
    # a failed send after approval may be retried
    s.check_send("failed", approved_at=NOW, sent_at=None, already_sent_version=False)
    for status in ("draft", "edited", "deleted", "generating"):
        with pytest.raises(s.ReportError, match="approved"):
            s.check_send(status, approved_at=None, sent_at=None, already_sent_version=False)
    with pytest.raises(s.ReportError, match="already been sent"):
        s.check_send("approved", approved_at=NOW, sent_at=NOW, already_sent_version=False)
    with pytest.raises(s.ReportError, match="already been sent"):
        s.check_send("approved", approved_at=NOW, sent_at=None, already_sent_version=True)
    # a generation failure (never approved) cannot be sent
    with pytest.raises(s.ReportError):
        s.check_send("failed", approved_at=None, sent_at=None, already_sent_version=False)


def test_recipients_are_the_merchants_own_contacts_only():
    allowed = ["Owner@Gaters.example", "marketing@gaters.example"]
    assert s.check_recipients([], allowed) == ["owner@gaters.example", "marketing@gaters.example"]
    assert s.check_recipients(["MARKETING@gaters.example", "marketing@gaters.example"], allowed) == ["marketing@gaters.example"]
    with pytest.raises(s.ReportError, match="Not a recipient of this merchant: other@merchant.example"):
        s.check_recipients(["other@merchant.example"], allowed)
    with pytest.raises(s.ReportError, match="no report recipient"):
        s.check_recipients([], [])


def test_apply_edit_changes_text_only_and_records_what_changed():
    payload = {"summary": ["old"], "bottomLine": "old", "recommendations": [], "sectionNotes": {}, "sections": {"ads": {"metrics": [{"id": "ADS01", "value": 1}]}}}
    out, changed = s.apply_edit(payload, {"summary": ["  new ", ""], "bottomLine": " done ", "recommendations": [
        {"action": "Do X", "why": "because", "owner": "Innowi", "target": "+10%"}, {"action": "   "}], "sections": {"ads": {"metrics": []}}})
    assert sorted(changed) == ["bottomLine", "recommendations", "summary"]
    assert out["summary"] == ["new"] and out["bottomLine"] == "done"
    assert out["recommendations"] == [{"action": "Do X", "why": "because", "owner": "Innowi", "target": "+10%"}]
    assert out["sections"] == payload["sections"]  # figures never change through an edit
    assert out["edited"] == {"keys": ["bottomLine", "recommendations", "summary"]}
    assert payload["summary"] == ["old"]  # the input is not mutated
    same, none = s.apply_edit(payload, {"nothing": 1})
    assert none == [] and "edited" not in same
