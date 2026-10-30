"""The merchant report as a PDF (ReportLab, pure Python — works on Vercel).

Same house style as the quote proposal (app/modules/quotes/pdf.py): Helvetica,
the "innowi" word mark over a blue rule, grey rules between table rows. This
file only draws the blocks `shared.document()` produces, so it holds no wording
and no ordering of its own.

Deterministic by construction (MFR10): the canvas is built with
`invariant=1`, which fixes the PDF's own CreationDate / ModDate and document
id, and every date in the content comes from the frozen snapshot. Rendering the
same approved snapshot twice gives the same bytes.
"""
from __future__ import annotations

import io
from typing import Any
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import HRFlowable, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.modules.report_gen.exports import shared

INK = colors.HexColor("#0A0A0A")
MUTED = colors.HexColor("#6B7280")
LINE = colors.HexColor("#E5E7EB")
BLUE = colors.HexColor("#2F6BFF")
PANEL = colors.HexColor("#F5F7FB")

LEFT = RIGHT = 0.75 * inch
WIDTH = LETTER[0] - LEFT - RIGHT

_base = ParagraphStyle("base", fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK)
S = {
    "brand": ParagraphStyle("brand", parent=_base, fontName="Helvetica-Bold", fontSize=22, leading=26),
    "title": ParagraphStyle("title", parent=_base, fontName="Helvetica-Bold", fontSize=16, leading=20),
    "h2": ParagraphStyle("h2", parent=_base, fontName="Helvetica-Bold", fontSize=12, leading=15, spaceBefore=12, spaceAfter=3),
    "lead": ParagraphStyle("lead", parent=_base, fontSize=10.5, leading=14.5, spaceBefore=4),
    "body": ParagraphStyle("body", parent=_base, spaceAfter=3),
    "muted": ParagraphStyle("muted", parent=_base, fontSize=8.5, leading=11.5, textColor=MUTED),
    "cell": ParagraphStyle("cell", parent=_base, fontSize=8.5, leading=11),
    "cellr": ParagraphStyle("cellr", parent=_base, fontSize=8.5, leading=11, alignment=TA_RIGHT),
    "head": ParagraphStyle("head", parent=_base, fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=MUTED),
    "headr": ParagraphStyle("headr", parent=_base, fontName="Helvetica-Bold", fontSize=7.5, leading=10, textColor=MUTED, alignment=TA_RIGHT),
    "cardlabel": ParagraphStyle("cardlabel", parent=_base, fontSize=7.5, leading=10, textColor=MUTED),
    "cardvalue": ParagraphStyle("cardvalue", parent=_base, fontName="Helvetica-Bold", fontSize=14, leading=17),
    "cardsmall": ParagraphStyle("cardsmall", parent=_base, fontName="Helvetica-Bold", fontSize=8.5, leading=11),
    "small": ParagraphStyle("small", parent=_base, fontSize=7.5, leading=10, textColor=MUTED),
}

# Helvetica's WinAnsi encoding has no typographic minus or non-breaking hyphen;
# the narrative and reviewer text may carry either. Swapped for the ASCII forms
# rather than dropped, so no figure loses its sign.
_SAFE = {0x2212: "-", 0x2011: "-", 0x2007: " ", 0x00A0: " ", 0x2009: " ", 0x200B: ""}


def _t(text: Any) -> str:
    return escape(str(text or "").translate(_SAFE))


def _p(text: Any, style: str = "cell") -> Paragraph:
    return Paragraph(_t(text), S[style])


def _widths(head: list[str], numeric: list[int]) -> list[float]:
    """Text columns get twice the share of a figure column, so a search term or a
    recommendation has room while the numbers stay tight."""
    weights = [1.0 if i in numeric else 2.0 for i in range(len(head))]
    total = sum(weights) or 1.0
    return [WIDTH * w / total for w in weights]


def _grid(block: dict) -> list:
    head, rows, numeric = block["head"], block["rows"], block.get("numeric") or []
    # Caps here, `all_caps` on the DOCX runs: the same heading, shown the same way.
    data = [[_p(str(h).upper(), "headr" if i in numeric else "head") for i, h in enumerate(head)]]
    for row in rows:
        data.append([_p(c, "cellr" if i in numeric else "cell") for i, c in enumerate(row)])
    t = Table(data, colWidths=_widths(head, numeric), repeatRows=1)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    out: list = []
    if block.get("title"):
        out.append(Paragraph(_t(block["title"]).upper(), S["head"]))
        out.append(Spacer(1, 2))
    out += [t, Spacer(1, 6)]
    return out


def _cards(cards: list[dict]) -> list:
    """The headline figures, three to a row. A figure that is not supplied keeps its
    card and prints the reason in place of a number (MFR04)."""
    cells = []
    for c in cards:
        style = "cardvalue" if c.get("supplied") else "cardsmall"
        bits = [_p(str(c["label"]).upper(), "cardlabel"), Paragraph(_t(c["value"]), S[style])]
        if c.get("change"):
            bits.append(_p(f"{c['change']} on the month before", "small"))
        cells.append(bits)
    rows = [cells[i:i + 3] for i in range(0, len(cells), 3)]
    out: list = []
    for row in rows:
        row = row + [""] * (3 - len(row))
        t = Table([row], colWidths=[WIDTH / 3] * 3)
        t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("BACKGROUND", (0, 0), (-1, -1), PANEL),
                               ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
                               ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                               ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
        out.append(t)
    out.append(Spacer(1, 8))
    return out


def _cover(block: dict) -> list:
    head = Table([[Paragraph(_t(block["brand"]), S["brand"]),
                   Paragraph(f"<b>{_t(block['period'])}</b>", S["cellr"])]], colWidths=[WIDTH / 2] * 2)
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 0), (-1, 0), 2, BLUE),
                              ("BOTTOMPADDING", (0, 0), (-1, -1), 10), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                              ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    out: list = [head, Spacer(1, 12), Paragraph(_t(block["title"]), S["title"])]
    if block.get("lines"):
        out += [Spacer(1, 4), _p(" · ".join(str(x) for x in block["lines"]), "muted")]
    return out


def _flowables(blocks: list[dict]) -> list:
    story: list = []
    for b in blocks:
        kind = b["type"]
        if kind == "cover":
            story += _cover(b)
        elif kind == "heading":
            story += [Paragraph(_t(b["text"]), S["h2"]), HRFlowable(width="100%", thickness=0.6, color=LINE, spaceAfter=5)]
        elif kind == "paragraph":
            story.append(_p(b["text"], "body"))
        elif kind == "lead":
            story.append(_p(b["text"], "lead"))
        elif kind == "note":
            story.append(_p(b["text"], "muted"))
        elif kind == "cards":
            story += _cards(b["cards"])
        elif kind == "table":
            story += _grid(b)
    return story


def render(payload: dict) -> bytes:
    """The approved snapshot as PDF bytes. Same snapshot in, same bytes out."""
    blocks = shared.document(payload)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=LETTER, leftMargin=LEFT, rightMargin=RIGHT, topMargin=0.6 * inch, bottomMargin=0.6 * inch,
        title=shared.title(payload), author="Innowi", subject="Monthly marketing report", creator="Innowi Super App",
        # Fixes the PDF's own CreationDate, ModDate and document id so two runs
        # of the same snapshot cannot differ (MFR10, snapshot immutability).
        invariant=1,
    )
    story = _flowables(blocks)
    # Keep the word mark, the rule and the report title on one page together.
    doc.build([KeepTogether(story[:3])] + story[3:] if len(story) > 3 else story)
    return buf.getvalue()


__all__ = ["render"]
