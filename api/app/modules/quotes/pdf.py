"""Proposal PDF for a quote request (reportlab, pure Python - works on Vercel).

One document for both audiences: the restaurant downloads it from a price
link's proposal page, and staff download it from the Super App for any request.
A signed document ends with a signature block and a signature certificate page
(the audit trail: who signed, how, from where, and the hash of what they
signed) - the same pattern the e-signature platforms use as evidence.
"""
from __future__ import annotations

import base64
import datetime as dt
import io
from decimal import Decimal
from typing import Optional
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.models import quotes as m
from app.modules.quotes.price_sheet import GOLD_INCLUDED, LEASE_MONTHS, TERMS
from app.modules.quotes.signing import CONSENT_TEXT

INK = colors.HexColor("#0A0A0A")
MUTED = colors.HexColor("#6B7280")
LINE = colors.HexColor("#E5E7EB")
BLUE = colors.HexColor("#2F6BFF")
PANEL = colors.HexColor("#F5F7FB")

_base = ParagraphStyle("base", fontName="Helvetica", fontSize=9.5, leading=13, textColor=INK)
S = {
    "brand": ParagraphStyle("brand", parent=_base, fontName="Helvetica-Bold", fontSize=22, leading=26),
    "title": ParagraphStyle("title", parent=_base, fontName="Helvetica-Bold", fontSize=15, leading=19),
    "h": ParagraphStyle("h", parent=_base, fontName="Helvetica-Bold", fontSize=8, leading=11, textColor=BLUE,
                        spaceBefore=10, spaceAfter=4),
    "body": _base,
    "muted": ParagraphStyle("muted", parent=_base, fontSize=8.5, leading=11.5, textColor=MUTED),
    "cell": ParagraphStyle("cell", parent=_base, fontSize=9, leading=12),
    "cellr": ParagraphStyle("cellr", parent=_base, fontSize=9, leading=12, alignment=TA_RIGHT),
    "small": ParagraphStyle("small", parent=_base, fontSize=7.5, leading=10, textColor=MUTED),
    "bigr": ParagraphStyle("bigr", parent=_base, fontName="Helvetica-Bold", fontSize=13, leading=16, alignment=TA_RIGHT),
}


def usd(v) -> str:
    d = Decimal(str(v))
    return f"${d:,.2f}"


def _p(text: str, style: str = "cell") -> Paragraph:
    return Paragraph(text, S[style])


def _line_rows(lines: list[dict], show_list: bool) -> list[list]:
    rows = []
    for line in lines:
        name = f"<b>{escape(line['name'])}</b>"
        if line.get("detail"):
            name += f"<br/><font color='#6B7280' size='8'>{escape(line['detail'])}</font>"
        unit = usd(line["unitPrice"]) + (f" <font color='#6B7280' size='7.5'>{escape(line['unitLabel'])}</font>"
                                         if line.get("unitLabel") else "")
        row = [_p(name), _p(str(line["qty"]), "cellr")]
        if show_list:
            lst = Decimal(line["unitList"]) if line.get("unitList") is not None else None
            cur = Decimal(line["unitPrice"])
            row.append(_p(f"<strike>{usd(lst)}</strike>" if lst is not None and lst > cur else "", "cellr"))
        row += [_p(unit, "cellr"), _p(f"<b>{usd(line['total'])}</b>", "cellr")]
        rows.append(row)
    return rows


def _table(title: str, lines: list[dict], show_list: bool, total_label: str, total: Decimal) -> list:
    if not lines:
        return []
    head = ["Item", "Qty"] + (["List"] if show_list else []) + ["Price", "Total"]
    widths = [3.35 * inch, 0.45 * inch] + ([0.8 * inch] if show_list else []) + [1.2 * inch, 1.0 * inch]
    if not show_list:
        widths[0] += 0.8 * inch
    data = [[_p(f"<font color='#6B7280' size='7.5'><b>{h.upper()}</b></font>", "cellr" if i else "cell")
             for i, h in enumerate(head)]]
    data += _line_rows(lines, show_list)
    data.append([_p(f"<b>{total_label}</b>")] + [""] * (len(head) - 2) + [_p(f"<b>{usd(total)}</b>", "cellr")])
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, LINE),
        ("LINEABOVE", (0, -1), (-1, -1), 0.8, INK),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]))
    return [Paragraph(title.upper(), S["h"]), t]


def _signature_flowable(sig: m.QuoteSignature):
    """The signature itself: the drawn image, or the typed adoption in italics."""
    if sig.method == "DRAWN" and sig.signature_data.startswith("data:image/png;base64,"):
        try:
            raw = base64.b64decode(sig.signature_data.split(",", 1)[1])
            reader = ImageReader(io.BytesIO(raw))
            w, h = reader.getSize()
            height = 0.55 * inch
            width = min(2.6 * inch, height * (w / h) if h else 2.6 * inch)
            return Image(io.BytesIO(raw), width=width, height=height)
        except Exception:  # noqa: BLE001 - fall back to the name rather than fail the PDF
            pass
    adopted = ParagraphStyle("adopted", parent=_base, fontName="Times-Italic", fontSize=17, leading=22)
    return Paragraph(escape(sig.signature_data if sig.method == "TYPED" else sig.name), adopted)


def _signature_block(signatures: list[m.QuoteSignature]) -> list:
    cells = []
    for role in ("CLIENT", "INNOWI"):
        sig = next((s for s in signatures if s.role == role), None)
        label = "Restaurant" if role == "CLIENT" else "Innowi, Inc."
        if sig is None:
            cells.append([Paragraph(f"<font color='#6B7280' size='8'><b>{label.upper()}</b></font>", S["body"]),
                          Spacer(1, 32), Paragraph("Signature pending", S["muted"])])
            continue
        who = f"<b>{escape(sig.name)}</b>" + (f", {escape(sig.title)}" if sig.title else "")
        cells.append([
            Paragraph(f"<font color='#6B7280' size='8'><b>{label.upper()}</b></font>", S["body"]),
            _signature_flowable(sig),
            Paragraph(who, S["cell"]),
            Paragraph(f"Signed {sig.signed_at:%B %-d, %Y at %H:%M} UTC"
                      + (" · VOIDED by a later revision" if sig.voided_at else ""), S["small"]),
        ])
    t = Table([[cells[0], cells[1]]], colWidths=[3.5 * inch, 3.5 * inch])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEABOVE", (0, 0), (-1, 0), 0.8, INK),
                           ("TOPPADDING", (0, 0), (-1, -1), 8)]))
    return [Spacer(1, 12), Paragraph("SIGNATURES", S["h"]), t]


_EVENT_LABEL = {
    "SUBMITTED": "Submitted by the restaurant", "VIEWED": "Opened by the restaurant",
    "REVISED_STAFF": "Revision sent by Innowi", "REVISED_CLIENT": "Revision sent by the restaurant",
    "PRICES_REVEALED": "Prices shown to the restaurant", "SIGNED_CLIENT": "Signed by the restaurant",
    "SIGNED_INNOWI": "Countersigned by Innowi", "SIGNATURE_VOIDED": "Signature voided by a new revision",
    "DECLINED": "Declined by the restaurant", "STATUS_CHANGED": "Status changed by the team",
}


def _certificate(r: m.QuoteRequest, rev_no: int, content_hash: str,
                 signatures: list[m.QuoteSignature], events: list[m.QuoteEvent]) -> list:
    """The evidence page: what was signed, by whom, from where, and the trail."""
    story: list = [PageBreak(), Paragraph("Signature certificate", S["title"]), Spacer(1, 4),
                   Paragraph(f"Proposal {escape(r.number)} · revision {rev_no} · {escape(r.restaurant_name)}", S["muted"]),
                   Spacer(1, 8),
                   Paragraph("DOCUMENT", S["h"]),
                   Paragraph(f"SHA-256 of the agreed content (lines, totals, terms, consent): "
                             f"<font name='Courier' size='7.5'>{escape(content_hash)}</font>", S["small"]),
                   Spacer(1, 4), Paragraph("SIGNERS", S["h"])]
    rows = [[_p("<font color='#6B7280' size='7.5'><b>PARTY</b></font>"),
             _p("<font color='#6B7280' size='7.5'><b>NAME</b></font>"),
             _p("<font color='#6B7280' size='7.5'><b>METHOD</b></font>"),
             _p("<font color='#6B7280' size='7.5'><b>E-MAIL / IP</b></font>"),
             _p("<font color='#6B7280' size='7.5'><b>SIGNED (UTC)</b></font>")]]
    for s in signatures:
        who = escape(s.name) + (f"<br/><font size='7.5' color='#6B7280'>{escape(s.title)}</font>" if s.title else "")
        contact = escape(s.email or "-") + (f"<br/><font size='7.5' color='#6B7280'>{escape(s.ip)}</font>" if s.ip else "")
        rows.append([_p("Restaurant" if s.role == "CLIENT" else "Innowi, Inc."), _p(who),
                     _p("Drawn" if s.method == "DRAWN" else "Typed"), _p(contact),
                     _p(f"{s.signed_at:%Y-%m-%d %H:%M:%S}")])
    t = Table(rows, colWidths=[1.0 * inch, 1.7 * inch, 0.7 * inch, 2.1 * inch, 1.5 * inch], repeatRows=1)
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LINEBELOW", (0, 0), (-1, 0), 0.8, INK),
                           ("LINEBELOW", (0, 1), (-1, -1), 0.4, LINE), ("TOPPADDING", (0, 0), (-1, -1), 4),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LEFTPADDING", (0, 0), (-1, -1), 2),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 2)]))
    story += [t, Spacer(1, 6), Paragraph("CONSENT", S["h"]), Paragraph(escape(CONSENT_TEXT), S["small"]),
              Spacer(1, 6), Paragraph("TRAIL", S["h"])]
    for e in events:
        label = _EVENT_LABEL.get(e.kind, e.kind)
        bits = [f"{e.created_at:%Y-%m-%d %H:%M:%S} UTC", label]
        if e.actor:
            bits.append(e.actor)
        if e.ip:
            bits.append(f"IP {e.ip}")
        if e.rev_no:
            bits.append(f"rev {e.rev_no}")
        story.append(Paragraph("– " + escape(" · ".join(bits)), S["small"]))
    story += [Spacer(1, 8),
              Paragraph("Signed electronically in the Innowi Super App. This certificate and the request's stored "
                        "revision snapshot are the record of the transaction.", S["small"])]
    return story


def render_proposal(r: m.QuoteRequest, *, prepared_by: Optional[str], valid_until: Optional[dt.datetime],
                    events: Optional[list[m.QuoteEvent]] = None,
                    revision: Optional[m.QuoteRevision] = None) -> bytes:
    """The proposal, by default at its current revision; pass ``revision`` for an earlier one."""
    buf = io.BytesIO()
    rev_no = revision.rev_no if revision is not None else (r.current_revision_no or 1)
    src = revision if revision is not None else r
    doc = SimpleDocTemplate(buf, pagesize=LETTER, leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                            topMargin=0.6 * inch, bottomMargin=0.6 * inch,
                            title=f"Innowi proposal {r.number} (rev {rev_no})", author="Innowi")
    lines = list(src.lines or [])
    show_list = any(Decimal(str(line.get("unitList") or 0)) > Decimal(str(line.get("unitPrice") or 0)) for line in lines)
    one_time = [line for line in lines if line["billing"] == "ONE_TIME"]
    software = [line for line in lines if line["billing"] == "MONTHLY" and line["category"] == "software"]
    lease = [line for line in lines if line["billing"] == "MONTHLY" and line["category"] == "lease"]
    monthly = Decimal(src.monthly_software_total) + Decimal(src.monthly_lease_total)
    rev_note = f" · REV {rev_no}" if rev_no > 1 else ""

    story: list = []
    head = Table([[Paragraph("innowi", S["brand"]),
                   Paragraph(f"<b>PROPOSAL {escape(r.number)}{rev_note}</b><br/>"
                             f"<font color='#6B7280'>{(revision.created_at if revision is not None else r.created_at):%B %-d, %Y}</font>", S["cellr"])]],
                 colWidths=[3.5 * inch, 3.5 * inch])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 0), (-1, 0), 2, BLUE),
                              ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    story += [head, Spacer(1, 12)]
    story.append(Paragraph(f"{escape(r.restaurant_name)}: restaurant platform proposal", S["title"]))
    who = [f"Prepared for <b>{escape(r.contact_name)}</b> ({escape(r.contact_email)})"]
    if prepared_by:
        who.append(f"Prepared by {escape(prepared_by)}")
    if valid_until:
        who.append(f"Valid until {valid_until:%B %-d, %Y}")
    story += [Spacer(1, 4), Paragraph(" · ".join(who), S["muted"]), Spacer(1, 6)]

    # Totals panel
    hw_note = (f"Hardware leased over {LEASE_MONTHS} months" if src.hardware_plan == "LEASE"
               else "Hardware bought outright")
    totals = Table([
        [_p("<font color='#6B7280' size='8'><b>DUE AT START (ONE-TIME)</b></font>"),
         _p("<font color='#6B7280' size='8'><b>MONTHLY</b></font>", "cellr")],
        [Paragraph(usd(src.one_time_total), S["title"]), Paragraph(usd(monthly) + " /mo", S["bigr"])],
        [_p(f"<font color='#6B7280' size='8'>{hw_note}. Shipping, sales tax, warranty and insurance are added to hardware.</font>"),
         _p(f"<font color='#6B7280' size='8'>Software {usd(src.monthly_software_total)}"
            + (f" + lease {usd(src.monthly_lease_total)}" if Decimal(src.monthly_lease_total) else "") + "</font>", "cellr")],
    ], colWidths=[3.5 * inch, 3.5 * inch])
    totals.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), PANEL), ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                                ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                                ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
    story += [totals, Spacer(1, 4)]
    savings = (Decimal(src.list_one_time_total) - Decimal(src.one_time_total)) + (Decimal(src.list_monthly_total) - monthly)
    if savings > 0:
        story.append(Paragraph(
            f"Includes special pricing: {usd(Decimal(src.list_one_time_total) - Decimal(src.one_time_total))} off one-time "
            f"and {usd(Decimal(src.list_monthly_total) - monthly)}/mo off list price.", S["muted"]))

    story += _table("One-time", one_time, show_list, "One-time total", Decimal(src.one_time_total))
    story += _table("Monthly software", software, show_list, "Monthly software", Decimal(src.monthly_software_total))
    story += _table(f"Hardware lease ({LEASE_MONTHS} months)", lease, show_list, "Monthly lease", Decimal(src.monthly_lease_total))

    story.append(Paragraph("INCLUDED WITH GOLD", S["h"]))
    story.append(Paragraph(" · ".join(escape(x) for x in GOLD_INCLUDED), S["body"]))
    if r.notes:
        story += [Paragraph("YOUR NOTES", S["h"]), Paragraph(escape(r.notes).replace("\n", "<br/>"), S["body"])]

    story.append(Paragraph("TERMS AND NOTES", S["h"]))
    for t in TERMS:
        story.append(Paragraph(f"– {escape(t)}", S["small"]))

    # Signatures: the ones on the rendered revision (live on the current one,
    # the voided record on an earlier one).
    rev_signatures = [s for s in (r.signatures or []) if s.rev_no == rev_no]
    if rev_signatures:
        story += _signature_block(rev_signatures)
    elif r.status == m.STATUS_ACCEPTED and r.accepted_at:
        sign = (f"<b>Accepted</b> by {escape(r.accepted_name or '')}"
                + (f", {escape(r.accepted_title)}" if r.accepted_title else "")
                + f" on {r.accepted_at:%B %-d, %Y at %H:%M} UTC.")
        story += [Spacer(1, 10), Paragraph(sign, S["body"])]
    else:
        story += [Spacer(1, 10), Paragraph(
            "To go ahead, review and sign this proposal online. Innowi countersigns, and both parties "
            "get the fully signed copy.", S["muted"])]
    story += [Spacer(1, 14), Paragraph("innowi.com · partners.innowi.com · (510) 588-7102 · info@innowi.com", S["small"])]

    if rev_signatures:
        content_hash = next((rev.content_hash for rev in (r.revisions or []) if rev.rev_no == rev_no), "")
        story += _certificate(r, rev_no, content_hash, rev_signatures, events or [])

    doc.build([KeepTogether(story[:6])] + story[6:])
    return buf.getvalue()
