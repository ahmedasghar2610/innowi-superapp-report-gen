"""Report Generator exports: the PDF and the DOCX of an approved snapshot.

Built from the same frozen fixture the assembly tests use, so no database is
needed. What is asserted here is the last-mile contract of PRD A MFR10: only an
approved (or sent) report becomes a file, both files are well-formed, every
"not supplied" figure carries its reason, every modelled figure carries its
label, the whitelist runs before anything is drawn, and the same snapshot
always renders to the same bytes.
"""
from __future__ import annotations

import datetime as dt
import io
import json
import re
from pathlib import Path

import pypdf
import pytest
from docx import Document

from app.modules.ads import calc
from app.modules.report_gen import exports, periods, service, whitelist
from app.modules.report_gen.assemble import Ctx, SECTION_ORDER, ads, blogs, compose, package_switch, seo, stub
from app.modules.report_gen.exports import docx as docx_renderer
from app.modules.report_gen.exports import shared

FIX = json.loads((Path(__file__).parent / "fixtures" / "report_gen" / "sample_month.json").read_text(encoding="utf-8"))
SEPT = periods.month_period(2026, 9)
GENERATED_AT = dt.datetime(2026, 10, 3, 9, 0, tzinfo=dt.timezone.utc)


def _d(v):
    return dt.date.fromisoformat(v) if v else None


def _payload() -> dict:
    """The September payload for Gaters Restaurant: Search, Blogs and Ads live,
    Sales / Website / Ops "not supplied", GBP / Email / Rewards / Reviews not taken."""
    ctx = Ctx(merchant=FIX["merchant"], period=SEPT, prev=periods.previous_month(SEPT), services=FIX["services"],
              ads_account_ids=["acc1"], seo_site_ids=["s1"], recipients=FIX["recipients"], today=dt.date(2026, 10, 3))
    inc = package_switch(ctx)
    a, b, s = FIX["ads"], FIX["blogs"], FIX["seo"]
    totals = {k: calc.Totals.of(v) for k, v in a["cur"].items()}
    prev_totals = {k: calc.Totals.of(v) for k, v in a["prev"].items()}
    accounts = [{**x, "lastMetricsDate": _d(x["lastMetricsDate"])} for x in a["accounts"]]
    posts = [{**p, "publishedOn": _d(p["publishedOn"])} for p in b["posts"]]
    sites = [{**x, "lastGscDate": _d(x["lastGscDate"])} for x in s["sites"]]
    sections = {
        "sales": stub.build("sales", "sales_feed_not_connected", included=inc["sales"]),
        "search": seo.compute(sites, s["cur"], s["prev"], s["queries"], s["prevQueries"], s["pages"], s["devicesCur"],
                              s["devicesPrev"], s["fixed"], s["fixedPrev"], s["openCount"], city="Concord",
                              merchant_name="Gaters Restaurant"),
        "blogs": blogs.compute(posts, b["monthStats"], b["prevStats"], SEPT.start, SEPT.end, 1200, _d(b["finalThrough"])),
        "website": stub.build("website", "website_analytics_not_connected", included=inc["website"]),
        "gbp": stub.build("gbp", "gbp_pending_google", included=inc["gbp"]),
        "ads": ads.compute(accounts, a["campaigns"], totals, prev_totals, None),
        "email_sms": stub.build("email_sms", "module_not_connected", included=inc["email_sms"]),
        "rewards": stub.build("rewards", "module_not_connected", included=inc["rewards"]),
        "reviews": stub.build("reviews", "reviews_module_not_connected", included=inc["reviews"]),
        "ops": stub.build("ops", "ops_not_assembled", included=inc["ops"]),
    }
    return compose(ctx, sections, generated_at=GENERATED_AT)


@pytest.fixture(scope="module")
def payload() -> dict:
    return _payload()


@pytest.fixture(scope="module")
def pdf_bytes(payload) -> bytes:
    return exports.render_pdf(payload)


@pytest.fixture(scope="module")
def docx_bytes(payload) -> bytes:
    return exports.render_docx(payload)


def _flat(text: str) -> str:
    """One line, single spaces: PDF extraction wraps inside a cell, so a phrase is
    only findable once the layout's line breaks are squashed."""
    return re.sub(r"\s+", " ", text)


def _pdf_text(raw: bytes) -> str:
    reader = pypdf.PdfReader(io.BytesIO(raw))
    return _flat("\n".join(page.extract_text() or "" for page in reader.pages))


def _docx_text(raw: bytes) -> str:
    return _flat(" \n ".join(docx_renderer.text_of(raw)))


# ------------------------------------------------------------------- state ----
def test_export_only_from_an_approved_or_sent_report():
    service.check_export("approved")
    service.check_export("sent")  # the merchant's copy stays downloadable
    for status in ("generating", "draft", "edited", "failed"):
        with pytest.raises(service.ReportError, match="Only an approved report can be exported"):
            service.check_export(status)
    with pytest.raises(service.ReportError, match="deleted"):
        service.check_export("deleted")


class _Report:
    """Just enough of a ReportGenReport for the state gate; `db` is never reached."""

    def __init__(self, status: str):
        self.id, self.status, self.current_version = "r1", status, 1


async def test_service_export_refuses_a_draft_and_an_unknown_format():
    with pytest.raises(service.ReportError, match="Only an approved report can be exported"):
        await service.export(None, _Report("draft"), "pdf")
    with pytest.raises(service.ReportError, match="Unknown export format"):
        await service.export(None, _Report("approved"), "xlsx")
    with pytest.raises(ValueError, match="unknown export kind"):
        exports.render({}, "txt")


# --------------------------------------------------------------- well-formed ----
def test_pdf_is_a_well_formed_document(pdf_bytes, payload):
    assert pdf_bytes.startswith(b"%PDF-") and len(pdf_bytes) > 5_000
    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) >= 3
    assert reader.metadata.title == shared.title(payload) == "Gaters Restaurant — marketing report · September 2026"
    assert reader.metadata.author == "Innowi"


def test_docx_is_a_well_formed_document(docx_bytes, payload):
    assert docx_bytes.startswith(b"PK") and len(docx_bytes) > 5_000
    doc = Document(io.BytesIO(docx_bytes))
    assert len(doc.paragraphs) > 20 and len(doc.tables) > 5
    assert doc.core_properties.title == shared.title(payload)
    assert doc.core_properties.author == shared.PREPARED_BY
    # Metadata comes from the snapshot, not the clock (otherwise the bytes move).
    assert doc.core_properties.created == doc.core_properties.modified == GENERATED_AT


def test_filenames_name_the_merchant_and_the_month(payload):
    assert exports.filename(payload, "pdf") == "innowi-report-gaters-restaurant-2026-09.pdf"
    assert exports.filename(payload, "docx") == "innowi-report-gaters-restaurant-2026-09.docx"


# ------------------------------------------------------------------ content ----
def test_section_order_is_the_assemblers_order(payload):
    blocks = exports.document(payload)
    headings = [b["text"] for b in blocks if b["type"] == "heading"]
    titles = [title for key, title in SECTION_ORDER if payload["sections"][key]["included"]]
    # the section headings appear in the payload's order, with nothing moved (MFR02)
    assert [h for h in headings if h in titles] == titles
    assert headings.index("Executive summary") < headings.index(titles[0]) < headings.index("What we recommend")


def test_a_service_not_taken_gets_no_section_at_all(pdf_bytes, docx_bytes, payload):
    # MFR01: Rewards, Email & SMS, Reviews and Business Profile are not in the package
    for key in ("rewards", "email_sms", "reviews", "gbp"):
        assert payload["sections"][key]["included"] is False
    for text in (_pdf_text(pdf_bytes), _docx_text(docx_bytes)):
        for title in ("Rewards", "Email & SMS", "Business Profile"):
            assert title not in text
        assert "Search" in text and "Ads" in text


def test_not_supplied_figures_print_their_reason(pdf_bytes, docx_bytes, payload):
    reasons = {m["text"] for m in payload["missing"]}
    assert reasons  # the fixture has Sales, Website, Ads budget and Ops pending
    for text in (_pdf_text(pdf_bytes), _docx_text(docx_bytes)):
        for reason in reasons:
            assert _flat(reason) in text, reason
        assert shared.NOT_SUPPLIED in text
        # MFR04: never a zero and never a blank in place of a missing figure
        assert "Gross sales 0" not in text and "Gross sales —" not in text


def test_modelled_and_tracked_figures_carry_their_label(pdf_bytes, docx_bytes):
    for text in (_pdf_text(pdf_bytes), _docx_text(docx_bytes)):
        assert "Attributed ad revenue (modelled)" in text
        assert "Return on ad spend (modelled)" in text
        assert "Orders from ads (tracked)" in text
        assert _flat(shared.TAG_NOTE["modelled"]) in text
        assert "Attributed revenue is modelled" in text  # the adapter's own caption


def test_the_document_never_prints_the_recipient_addresses(pdf_bytes, docx_bytes, payload):
    assert payload["recipients"] == ["owner@gaters.example", "marketing@gaters.example"]
    for text in (_pdf_text(pdf_bytes), _docx_text(docx_bytes)):
        for address in payload["recipients"]:
            assert address not in text


def test_figures_recommendations_and_sources_reach_the_page(pdf_bytes, docx_bytes):
    for text in (_pdf_text(pdf_bytes), _docx_text(docx_bytes)):
        assert "1,200" in text and "$800" in text and "2.7×" in text  # organic clicks, ad spend, ROAS
        assert "Close the 4 open site audit issues" in text and "Innowi SEO" in text
        assert "Search Console · gaters.example" in text
        assert "Data through September 28, 2026." in text  # cross-platform date, no %-d


# ---------------------------------------------------------------- whitelist ----
def test_the_whitelist_blocks_a_poisoned_payload_before_anything_renders(payload):
    """A bug in the export layer must not be able to leak a blocked field: the same
    scan the assembler and the service run happens before the first block is built."""
    poisoned = json.loads(json.dumps(payload))
    poisoned["sections"]["ads"]["internalNote"] = "merchant is behind on billing"
    poisoned["sections"]["search"]["metrics"][0]["accountHealth"] = "RED"
    assert whitelist.scan(poisoned)  # the assembler would have refused this too
    for render in (exports.render_pdf, exports.render_docx, exports.document):
        with pytest.raises(whitelist.WhitelistError, match="Blocked field"):
            render(poisoned)
    # and the clean payload still renders
    assert exports.document(payload)


def test_a_blocked_field_is_caught_whatever_it_is_called(payload):
    for key, value in (("notes", "internal"), ("partnerPayout", 50), ("mrr", 199), ("ticketComments", ["x"])):
        poisoned = json.loads(json.dumps(payload))
        poisoned["sections"]["blogs"][key] = value
        with pytest.raises(whitelist.WhitelistError):
            exports.render_pdf(poisoned)


# -------------------------------------------------------------- determinism ----
def test_rendering_the_same_snapshot_twice_gives_the_same_bytes(payload):
    """Snapshot immutability (MFR10): an approved report's file never changes, so
    neither renderer may bake the clock into its output."""
    assert exports.render_pdf(payload) == exports.render_pdf(payload)
    assert exports.render_docx(payload) == exports.render_docx(payload)
    # a second, independently assembled copy of the same month renders identically
    again = _payload()
    assert again == payload
    assert exports.render_pdf(again) == exports.render_pdf(payload)
    assert exports.render_docx(again) == exports.render_docx(payload)


def test_a_changed_snapshot_renders_differently(payload):
    """The flip side: determinism must not mean the renderer ignores the payload."""
    edited = json.loads(json.dumps(payload))
    edited["bottomLine"] = "A reviewer rewrote the bottom line before approval."
    assert exports.render_pdf(edited) != exports.render_pdf(payload)
    assert exports.render_docx(edited) != exports.render_docx(payload)
    assert "A reviewer rewrote the bottom line before approval." in _pdf_text(exports.render_pdf(edited))


# ------------------------------------------------------------- shared wording ----
def test_both_formats_say_the_same_thing(pdf_bytes, docx_bytes):
    """The document model is the single source of wording, so the two files agree.
    Compared without case: a table heading is drawn in caps by both renderers, the
    PDF by upper-casing the string and the DOCX through its runs' `all_caps`."""
    pdf_text, docx_text = _pdf_text(pdf_bytes).lower(), _docx_text(docx_bytes).lower()
    for block in exports.document(_payload()):
        for text in (block.get("text"), block.get("title")):
            if text and len(str(text)) > 12:
                assert _flat(str(text)).lower() in pdf_text, text
                assert _flat(str(text)).lower() in docx_text, text


def test_formatting_helpers_are_cross_platform_and_unit_aware():
    # the %-d / %#d strftime trap: built from the parts instead (crashes on Windows)
    assert shared.long_date("2026-09-05") == "September 5, 2026"
    assert shared.long_date(dt.date(2026, 12, 31)) == "December 31, 2026"
    assert shared.long_date(None) == shared.EMPTY and shared.long_date("not a date") == shared.EMPTY
    assert shared.money(800) == "$800" and shared.money(13.333) == "$13.33" and shared.money(None) == shared.EMPTY
    assert shared.percent(0.048) == "4.8%" and shared.multiple(2.68) == "2.7×" and shared.number(1200) == "1,200"
    assert shared.change_text(0.2) == "+20%" and shared.change_text(-0.08) == "-8%" and shared.change_text(None) == shared.EMPTY
    assert "-" in shared.change_text(-0.08) and "−" not in shared.change_text(-0.08)  # PDF base fonts cannot encode U+2212
    assert shared.not_supplied_text("No budget on file.") == "Not supplied — No budget on file."
    assert shared.metric_label({"label": "Attributed ad revenue", "tag": "modelled"}) == "Attributed ad revenue (modelled)"
    assert shared.metric_label({"label": "Clicks", "tag": None}) == "Clicks"
    assert shared.cell_text("position", 10) == "10.0" and shared.cell_text("prevPosition", 8) == "8.0"
    assert shared.cell_text("roas", 2.44) == "2.4×" and shared.cell_text("spend", 600) == "$600"
    assert shared.cell_text("brandedShare", 0.885) == "88.5%" and shared.cell_text("asOf", "2026-09-30") == "September 30, 2026"
    assert shared.column_label("prevClicks") == "Clicks last month" and shared.flat_label("branded ctr") == "Branded click-through rate"


def test_an_empty_table_is_left_out_and_a_nested_one_is_flattened():
    assert shared.table_block("topQueries", []) is None
    assert shared.table_block("branded", None) is None
    block = shared.table_block("branded", {"branded": {"clicks": 850}, "brandedShare": 0.885})
    assert block["head"] == ["Figure", "Value"]
    assert block["rows"] == [["Branded clicks", "850"], ["Branded share of clicks", "88.5%"]]
