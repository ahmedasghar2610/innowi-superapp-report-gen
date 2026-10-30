"""Exports: an approved snapshot becomes a file the merchant can read (MFR10).

    render_pdf(payload)  -> bytes
    render_docx(payload) -> bytes
    filename(payload, kind) -> "innowi-report-gaters-restaurant-2026-09.pdf"

`payload` is the snapshot an approved report froze — the same dict the preview
endpoint returns. `service.export()` is what loads it and checks the report is
approved or sent first; nothing here looks at the lifecycle.

    shared.py   the document model and every piece of wording, used by both
    pdf.py      ReportLab, in the house style of app/modules/quotes/pdf.py
    docx.py     python-docx

Three guarantees, all tested in tests/test_report_gen_exports.py:

  * the whitelist scan runs before any block is built, so a blocked field can
    never reach a merchant-facing file (MFR07, hard rule 13);
  * section order comes from the payload's own `sectionOrder`; the export layer
    never reorders the PRD shape (MFR02);
  * rendering one approved snapshot twice returns identical bytes, in both
    formats (snapshot immutability).
"""
from __future__ import annotations

from app.modules.report_gen.exports.shared import document, filename, title

KINDS = ("pdf", "docx")
MEDIA_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def render_pdf(payload: dict) -> bytes:
    from app.modules.report_gen.exports import pdf

    return pdf.render(payload)


def render_docx(payload: dict) -> bytes:
    from app.modules.report_gen.exports import docx

    return docx.render(payload)


def render(payload: dict, kind: str) -> bytes:
    if kind not in KINDS:
        raise ValueError(f"unknown export kind {kind!r}; expected one of {', '.join(KINDS)}")
    return render_pdf(payload) if kind == "pdf" else render_docx(payload)


__all__ = ["render_pdf", "render_docx", "render", "document", "filename", "title", "KINDS", "MEDIA_TYPES"]
