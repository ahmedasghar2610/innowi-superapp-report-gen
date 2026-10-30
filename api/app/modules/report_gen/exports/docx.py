"""The merchant report as a Word document (python-docx).

Renders the same blocks as `pdf.py`, so the two files carry identical wording,
identical figures and the same "not supplied" reasons and "modelled" labels —
only the typesetting differs.

Deterministic by construction (MFR10): the document's own properties are taken
from the frozen snapshot, and the saved package is re-zipped with a fixed entry
timestamp, because a zip otherwise stamps every member with the time it was
written. Rendering the same approved snapshot twice gives the same bytes.
"""
from __future__ import annotations

import datetime as dt
import io
import zipfile
from typing import Any

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor

from app.modules.report_gen.exports import shared

INK = RGBColor(0x0A, 0x0A, 0x0A)
MUTED = RGBColor(0x6B, 0x72, 0x80)
BLUE = RGBColor(0x2F, 0x6B, 0xFF)

BODY_FONT = "Calibri"
CONTENT_WIDTH = 6.5  # inches: Letter less the template's one-inch margins
# Every zip member gets this timestamp instead of "now", so the bytes of one
# snapshot never change. 1980-01-01 is the earliest a zip can record.
FIXED_ZIP_TIME = (1980, 1, 1, 0, 0, 0)


def _run(para, text: Any, *, bold: bool = False, size: float = 10, color: RGBColor = INK, italic: bool = False, caps: bool = False):
    run = para.add_run(str(text or ""))
    run.bold = bold
    run.italic = italic
    run.font.size = Pt(size)
    run.font.color.rgb = color
    run.font.name = BODY_FONT
    run.font.all_caps = caps
    return run


def _para(doc, text: Any, **kw):
    para = doc.add_paragraph()
    para.paragraph_format.space_after = Pt(kw.pop("space_after", 4))
    _run(para, text, **kw)
    return para


def _widths(count: int, numeric: list[int]) -> list[float]:
    """Same share as the PDF: a text column is worth two figure columns."""
    weights = [1.0 if i in numeric else 2.0 for i in range(count)]
    total = sum(weights) or 1.0
    return [CONTENT_WIDTH * w / total for w in weights]


def _table(doc, block: dict) -> None:
    head, rows, numeric = block["head"], block["rows"], block.get("numeric") or []
    if block.get("title"):
        _para(doc, block["title"], bold=True, size=8, color=MUTED, caps=True, space_after=2)
    table = doc.add_table(rows=1, cols=len(head))
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    try:
        table.style = doc.styles["Table Grid"]
    except KeyError:  # a template without the built-in style still renders, unstyled
        pass
    table.autofit = False
    widths = _widths(len(head), numeric)
    for i, text in enumerate(head):
        cell = table.rows[0].cells[i]
        para = cell.paragraphs[0]
        para.alignment = WD_ALIGN_PARAGRAPH.RIGHT if i in numeric else WD_ALIGN_PARAGRAPH.LEFT
        _run(para, text, bold=True, size=8, color=MUTED, caps=True)
    for row in rows:
        cells = table.add_row().cells
        for i, text in enumerate(row):
            para = cells[i].paragraphs[0]
            para.alignment = WD_ALIGN_PARAGRAPH.RIGHT if i in numeric else WD_ALIGN_PARAGRAPH.LEFT
            _run(para, text, size=8.5)
    # Word needs the width on every cell, not only on the column.
    for r in table.rows:
        for i, cell in enumerate(r.cells):
            cell.width = Inches(widths[i])
    _para(doc, "", space_after=2)


def _cards(doc, cards: list[dict]) -> None:
    """The headline figures, three to a row; a card with no figure prints its reason."""
    chunks = [cards[i:i + 3] for i in range(0, len(cards), 3)]
    for chunk in chunks:
        table = doc.add_table(rows=1, cols=3)
        try:
            table.style = doc.styles["Table Grid"]
        except KeyError:
            pass
        table.autofit = False
        for i in range(3):
            cell = table.rows[0].cells[i]
            cell.width = Inches(CONTENT_WIDTH / 3)
            if i >= len(chunk):
                continue
            card = chunk[i]
            _run(cell.paragraphs[0], card["label"], bold=True, size=7.5, color=MUTED, caps=True)
            _run(cell.add_paragraph(), card["value"], bold=True, size=14 if card.get("supplied") else 9)
            if card.get("change"):
                _run(cell.add_paragraph(), f"{card['change']} on the month before", size=7.5, color=MUTED)
    _para(doc, "", space_after=2)


def _cover(doc, block: dict) -> None:
    _para(doc, block["brand"], bold=True, size=22, color=INK, space_after=0)
    _para(doc, block["period"], bold=True, size=10, color=BLUE, space_after=8)
    heading = doc.add_heading(level=1)
    _run(heading, block["title"], bold=True, size=18)
    if block.get("lines"):
        _para(doc, " · ".join(str(x) for x in block["lines"]), size=8.5, color=MUTED, space_after=8)


def _properties(doc, payload: dict) -> None:
    """Document metadata from the snapshot — never from the clock."""
    stamp = _generated_at(payload)
    props = doc.core_properties
    props.title = shared.title(payload)
    props.author = shared.PREPARED_BY
    props.last_modified_by = shared.PREPARED_BY
    props.subject = "Monthly marketing report"
    props.comments = ""
    props.revision = 1
    props.created = stamp
    props.modified = stamp


def _utc(value: dt.datetime) -> dt.datetime:
    """Word stores core properties without an offset, so the stamp is moved to UTC
    first rather than having its offset dropped where it stands."""
    return value.astimezone(dt.timezone.utc).replace(tzinfo=None) if value.tzinfo else value


def _generated_at(payload: dict) -> dt.datetime:
    raw = payload.get("generatedAt")
    if isinstance(raw, str) and raw:
        try:
            return _utc(dt.datetime.fromisoformat(raw.replace("Z", "+00:00")))
        except ValueError:
            pass
    if isinstance(raw, dt.datetime):
        return _utc(raw)
    # No stamp in the snapshot: a fixed epoch, so the bytes still never move.
    return dt.datetime(1980, 1, 1)


def _normalise(raw: bytes) -> bytes:
    """Re-pack the .docx with a fixed timestamp on every member. Without this two
    renders of one snapshot differ only by the second they were zipped."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as src, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            entry = zipfile.ZipInfo(info.filename, FIXED_ZIP_TIME)
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = info.external_attr
            entry.internal_attr = info.internal_attr
            entry.create_system = 0
            dst.writestr(entry, src.read(info.filename))
    return out.getvalue()


def render(payload: dict) -> bytes:
    """The approved snapshot as .docx bytes. Same snapshot in, same bytes out."""
    blocks = shared.document(payload)
    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = BODY_FONT
    normal.font.size = Pt(10)
    _properties(doc, payload)

    for b in blocks:
        kind = b["type"]
        if kind == "cover":
            _cover(doc, b)
        elif kind == "heading":
            heading = doc.add_heading(level=int(b.get("level") or 2))
            _run(heading, b["text"], bold=True, size=13)
        elif kind == "paragraph":
            _para(doc, b["text"])
        elif kind == "lead":
            _para(doc, b["text"], size=10.5)
        elif kind == "note":
            _para(doc, b["text"], size=8.5, color=MUTED)
        elif kind == "cards":
            _cards(doc, b["cards"])
        elif kind == "table":
            _table(doc, b)

    buf = io.BytesIO()
    doc.save(buf)
    return _normalise(buf.getvalue())


def text_of(raw: bytes) -> list[str]:
    """Every line of a rendered .docx — paragraphs and table cells. Used by the
    tests, and handy in a shell when checking what a merchant will read."""
    doc = Document(io.BytesIO(raw))
    lines = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            lines.extend(cell.text for cell in row.cells)
    return [line for line in lines if line.strip()]


__all__ = ["render", "text_of"]
