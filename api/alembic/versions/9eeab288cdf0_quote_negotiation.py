"""quotes: negotiation (revisions, signatures, events) + bundling rule

Revision ID: 9eeab288cdf0
Revises: c3d4e5f6a7b9
Create Date: 2026-10-21

* ``price_item.bundled_in_sku``: an item a selected bundle already includes
  can't be added on top (email/SMS campaigns are inside the marketing package).
* ``quote_revision``: the negotiation trail - every send is an immutable priced
  snapshot. Existing requests are backfilled as revision 1.
* ``quote_signature`` / ``quote_event``: electronic signatures with their
  evidence, and the request's audit trail for the signature certificate.
* ``quote_request``: new statuses SIGNED and EXECUTED, the current revision
  number, the hidden-link "prices revealed" switch and the decline reason.
"""
import hashlib
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.models.common import cuid
from app.modules.quotes.price_sheet import TERMS

revision: str = "9eeab288cdf0"
down_revision: Union[str, None] = "c3d4e5f6a7b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "quotes"
CONSENT_VERSION = "2026-10-21"


def _money(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.Numeric(10, 2), nullable=nullable)


def _content_hash(number: str, rev_no: int, restaurant: str, email: str, plan: str,
                  lines: list[dict], totals: dict[str, str]) -> str:
    # Mirrors app/modules/quotes/signing.content_hash: keep the two in step.
    payload = {
        "number": number, "rev": rev_no, "restaurant": restaurant, "contactEmail": email, "plan": plan,
        "lines": [{"sku": ln.get("sku"), "name": ln.get("name"), "billing": ln.get("billing"),
                   "qty": ln.get("qty"), "unitPrice": str(ln.get("unitPrice")), "total": str(ln.get("total"))}
                  for ln in lines],
        "totals": {k: str(v) for k, v in sorted(totals.items())},
        "terms": list(TERMS),
        "consent": CONSENT_VERSION,
    }
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(blob.encode()).hexdigest()


def _money_str(v) -> str:
    return f"{v:.2f}" if v is not None else "0.00"


def upgrade() -> None:
    # ── bundling rule ─────────────────────────────────────────────────────
    op.add_column("price_item", sa.Column("bundled_in_sku", sa.String(length=40), nullable=True), schema=S)
    op.execute(
        f'UPDATE "{_schema_name()}".price_item SET bundled_in_sku = \'MKT-PACKAGE\' WHERE sku = \'SW-EMAIL-SMS\''
    )

    # ── request columns and the wider status list ────────────────────────
    op.add_column("quote_request",
                  sa.Column("current_revision_no", sa.Integer(), server_default=sa.text("1"), nullable=False),
                  schema=S)
    op.add_column("quote_request",
                  sa.Column("prices_revealed", sa.Boolean(), server_default=sa.text("false"), nullable=False),
                  schema=S)
    op.add_column("quote_request", sa.Column("declined_reason", sa.Text(), nullable=True), schema=S)
    op.drop_constraint("ck_quote_request_status", "quote_request", schema=S, type_="check")
    op.create_check_constraint(
        "ck_quote_request_status", "quote_request",
        "status IN ('REQUESTED','PROPOSED','ACCEPTED','SIGNED','EXECUTED','DECLINED','CLOSED')", schema=S,
    )

    # ── the negotiation trail ────────────────────────────────────────────
    op.create_table(
        "quote_revision",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("request_id", sa.String(length=30), sa.ForeignKey(f"{S}.quote_request.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("rev_no", sa.Integer(), nullable=False),
        sa.Column("author_kind", sa.String(length=20), nullable=False),
        sa.Column("author_name", sa.String(length=160), nullable=True),
        sa.Column("author_email", sa.String(length=200), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("hardware_plan", sa.String(length=10), nullable=False),
        sa.Column("selections", sa.JSON(), nullable=False),
        sa.Column("lines", sa.JSON(), nullable=False),
        _money("one_time_total", nullable=False),
        _money("monthly_software_total", nullable=False),
        _money("monthly_lease_total", nullable=False),
        _money("list_one_time_total", nullable=False),
        _money("list_monthly_total", nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("request_id", "rev_no", name="uq_quote_revision_no"),
        sa.CheckConstraint("author_kind IN ('STAFF','RESTAURANT')", name="ck_quote_revision_author"),
        schema=S,
    )
    op.create_index("ix_quote_revision_request_id", "quote_revision", ["request_id"], schema=S)

    op.create_table(
        "quote_signature",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("request_id", sa.String(length=30), sa.ForeignKey(f"{S}.quote_request.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("rev_no", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=True),
        sa.Column("email", sa.String(length=200), nullable=True),
        sa.Column("method", sa.String(length=10), nullable=False),
        sa.Column("signature_data", sa.Text(), nullable=False),
        sa.Column("consent_version", sa.String(length=40), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=300), nullable=True),
        sa.Column("signed_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("request_id", "rev_no", "role", name="uq_quote_signature_role"),
        sa.CheckConstraint("role IN ('CLIENT','INNOWI')", name="ck_quote_signature_role"),
        sa.CheckConstraint("method IN ('DRAWN','TYPED')", name="ck_quote_signature_method"),
        schema=S,
    )
    op.create_index("ix_quote_signature_request_id", "quote_signature", ["request_id"], schema=S)

    op.create_table(
        "quote_event",
        sa.Column("id", sa.String(length=30), primary_key=True),
        sa.Column("request_id", sa.String(length=30), sa.ForeignKey(f"{S}.quote_request.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("rev_no", sa.Integer(), nullable=True),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("actor", sa.String(length=200), nullable=True),
        sa.Column("detail", sa.JSON(), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=300), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        schema=S,
    )
    op.create_index("ix_quote_event_request_id", "quote_event", ["request_id"], schema=S)

    # ── backfill: every existing request becomes its own revision 1 ──────
    bind = op.get_bind()
    schema = _schema_name()
    rows = bind.execute(sa.text(
        f'SELECT id, number, status, restaurant_name, contact_name, contact_email, notes, hardware_plan, '
        f'selections, lines, one_time_total, monthly_software_total, monthly_lease_total, '
        f'list_one_time_total, list_monthly_total, accepted_at, accepted_name, accepted_title, accepted_ip, '
        f'client_ip, user_agent, created_at FROM "{schema}".quote_request'
    )).mappings().all()
    for r in rows:
        lines = r["lines"] if isinstance(r["lines"], list) else json.loads(r["lines"])
        selections = r["selections"] if isinstance(r["selections"], list) else json.loads(r["selections"])
        monthly = (r["monthly_software_total"] or 0) + (r["monthly_lease_total"] or 0)
        totals = {
            "oneTime": _money_str(r["one_time_total"]), "monthlySoftware": _money_str(r["monthly_software_total"]),
            "monthlyLease": _money_str(r["monthly_lease_total"]), "monthly": f"{monthly:.2f}",
            "listOneTime": _money_str(r["list_one_time_total"]), "listMonthly": _money_str(r["list_monthly_total"]),
            "savingsOneTime": f"{(r['list_one_time_total'] or 0) - (r['one_time_total'] or 0):.2f}",
            "savingsMonthly": f"{(r['list_monthly_total'] or 0) - monthly:.2f}",
        }
        content = _content_hash(r["number"], 1, r["restaurant_name"], r["contact_email"], r["hardware_plan"],
                                lines, totals)
        bind.execute(sa.text(
            f'INSERT INTO "{schema}".quote_revision (id, request_id, rev_no, author_kind, author_name, author_email, '
            f'note, hardware_plan, selections, lines, one_time_total, monthly_software_total, monthly_lease_total, '
            f'list_one_time_total, list_monthly_total, content_hash, created_at) VALUES '
            f'(:id, :rid, 1, \'RESTAURANT\', :an, :ae, :note, :plan, :sel, :lines, :ott, :mst, :mlt, :lot, :lmt, '
            f':hash, :at)'
        ), {"id": cuid(), "rid": r["id"], "an": r["contact_name"], "ae": r["contact_email"], "note": r["notes"],
            "plan": r["hardware_plan"], "sel": json.dumps(selections), "lines": json.dumps(lines),
            "ott": r["one_time_total"], "mst": r["monthly_software_total"], "mlt": r["monthly_lease_total"],
            "lot": r["list_one_time_total"], "lmt": r["list_monthly_total"], "hash": content, "at": r["created_at"]})
        bind.execute(sa.text(
            f'INSERT INTO "{schema}".quote_event (id, request_id, rev_no, kind, actor, ip, user_agent, created_at) '
            f'VALUES (:id, :rid, 1, \'SUBMITTED\', :actor, :ip, :ua, :at)'
        ), {"id": cuid(), "rid": r["id"], "actor": r["contact_name"], "ip": r["client_ip"], "ua": r["user_agent"],
            "at": r["created_at"]})
        if r["status"] == "ACCEPTED" and r["accepted_at"] is not None:
            # Legacy online accept (typed name + tick box): keep it visible as a
            # typed signature so old deals read the same as new ones.
            bind.execute(sa.text(
                f'INSERT INTO "{schema}".quote_signature (id, request_id, rev_no, role, name, title, email, method, '
                f'signature_data, consent_version, content_hash, ip, signed_at) VALUES '
                f'(:id, :rid, 1, \'CLIENT\', :name, :title, :email, \'TYPED\', :data, \'legacy-accept\', :hash, '
                f':ip, :at)'
            ), {"id": cuid(), "rid": r["id"], "name": r["accepted_name"] or r["contact_name"],
                "title": r["accepted_title"], "email": r["contact_email"],
                "data": r["accepted_name"] or r["contact_name"], "hash": content, "ip": r["accepted_ip"],
                "at": r["accepted_at"]})
            bind.execute(sa.text(
                f'INSERT INTO "{schema}".quote_event (id, request_id, rev_no, kind, actor, ip, created_at) '
                f'VALUES (:id, :rid, 1, \'SIGNED_CLIENT\', :actor, :ip, :at)'
            ), {"id": cuid(), "rid": r["id"], "actor": r["accepted_name"] or r["contact_name"],
                "ip": r["accepted_ip"], "at": r["accepted_at"]})


def _schema_name() -> str:
    """The real (possibly prefixed) quotes schema, matching alembic/env.py's translate map."""
    from app.db.schemas import qualified

    return qualified(S)


def downgrade() -> None:
    op.drop_table("quote_event", schema=S)
    op.drop_table("quote_signature", schema=S)
    op.drop_table("quote_revision", schema=S)
    op.drop_constraint("ck_quote_request_status", "quote_request", schema=S, type_="check")
    op.create_check_constraint(
        "ck_quote_request_status", "quote_request",
        "status IN ('REQUESTED','PROPOSED','ACCEPTED','DECLINED','CLOSED')", schema=S,
    )
    op.drop_column("quote_request", "declined_reason", schema=S)
    op.drop_column("quote_request", "prices_revealed", schema=S)
    op.drop_column("quote_request", "current_revision_no", schema=S)
    op.drop_column("price_item", "bundled_in_sku", schema=S)
