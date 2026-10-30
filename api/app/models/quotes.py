"""quotes schema - the restaurant quote builder.

Three parts:

* ``price_item``: Innowi's price list (the official price sheet). Every row is
  one thing a restaurant can add to a quote: a device (hardware + its monthly
  software), other hardware, a monthly software add-on, or a one-time service.
* ``quote_link`` (+ ``quote_link_item``): a link the team sends one restaurant.
  It carries the mode (prices shown or hidden) and any special pricing for that
  client. Only a SHA-256 of the link's token is stored.
* ``quote_request``: what the restaurant submitted through a link. The priced
  lines and totals are stored as a snapshot, so a later price-list change never
  rewrites a proposal someone already saw or accepted.
* ``quote_revision``: the negotiation trail. Every send - the restaurant's
  first submission, a staff counter, a restaurant counter - is one immutable
  revision with its own priced snapshot and content hash. The request's own
  columns always mirror the current revision.
* ``quote_signature``: electronic signatures on one revision (the client's,
  then Innowi's countersignature), with the evidence that backs them: who,
  how (drawn or typed), from where, when, and the hash of what was signed.
* ``quote_event``: the request's audit trail (submitted, viewed, revised,
  signed, voided ...), printed on the signature certificate.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import id_column

SCHEMA = "quotes"

# price_item.kind
KIND_DEVICE = "DEVICE"  # hardware (buy or lease) + monthly software per device
KIND_HARDWARE = "HARDWARE"  # hardware only (buy, or lease when a lease price exists)
KIND_SOFTWARE = "SOFTWARE"  # monthly, per unit
KIND_SERVICE = "SERVICE"  # one-time
ITEM_KINDS = (KIND_DEVICE, KIND_HARDWARE, KIND_SOFTWARE, KIND_SERVICE)

# quote_link.mode
MODE_SHOW = "SHOW_PRICES"
MODE_HIDE = "HIDE_PRICES"
LINK_MODES = (MODE_SHOW, MODE_HIDE)

# quote_request.status
STATUS_REQUESTED = "REQUESTED"  # hidden-price link: the team prices and follows up
STATUS_PROPOSED = "PROPOSED"  # price link: the restaurant saw a proposal
STATUS_ACCEPTED = "ACCEPTED"  # legacy: accepted online before signatures existed
STATUS_SIGNED = "SIGNED"  # the client signed; Innowi's countersignature is next
STATUS_EXECUTED = "EXECUTED"  # both parties signed
STATUS_DECLINED = "DECLINED"
STATUS_CLOSED = "CLOSED"  # handled outside the app / superseded
REQUEST_STATUSES = (STATUS_REQUESTED, STATUS_PROPOSED, STATUS_ACCEPTED, STATUS_SIGNED, STATUS_EXECUTED,
                    STATUS_DECLINED, STATUS_CLOSED)
# Statuses that count as a closed-won deal (the "Accepted" tiles).
WON_STATUSES = (STATUS_ACCEPTED, STATUS_SIGNED, STATUS_EXECUTED)

# quote_revision.author_kind
AUTHOR_STAFF = "STAFF"
AUTHOR_RESTAURANT = "RESTAURANT"

# quote_signature.role / method
SIGN_CLIENT = "CLIENT"
SIGN_INNOWI = "INNOWI"
SIGN_DRAWN = "DRAWN"
SIGN_TYPED = "TYPED"

# quote_event.kind
EVENT_KINDS = ("SUBMITTED", "VIEWED", "REVISED_STAFF", "REVISED_CLIENT", "PRICES_REVEALED",
               "SIGNED_CLIENT", "SIGNED_INNOWI", "SIGNATURE_VOIDED", "DECLINED", "STATUS_CHANGED")

MONEY = Numeric(10, 2)


def _ts(nullable: bool = True):
    return mapped_column(DateTime(timezone=True), nullable=nullable)


class PriceItem(Base):
    __tablename__ = "price_item"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    sku: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    # Shown to the restaurant next to the item (e.g. "500 SMS included").
    note: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    section: Mapped[str] = mapped_column(String(40), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    unit_label: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)

    monthly_price: Mapped[Optional[Decimal]] = mapped_column(MONEY, nullable=True)
    purchase_price: Mapped[Optional[Decimal]] = mapped_column(MONEY, nullable=True)  # hardware, or a one-time service
    lease_price: Mapped[Optional[Decimal]] = mapped_column(MONEY, nullable=True)  # per month

    # Devices that count as a "station" for the first-station rule (POS terminal, handheld).
    is_station: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # SKU of a bundle that already includes this item (e.g. the marketing package
    # includes email/SMS campaigns). When the bundle is on a quote, this item
    # can't be added on top - it's stripped server-side and disabled in the UI.
    bundled_in_sku: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    # Pricing-rule rows (e.g. the first-station price) are not offered on their own.
    selectable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    max_qty: Mapped[int] = mapped_column(Integer, nullable=False, default=20, server_default="20")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class QuoteLink(Base):
    __tablename__ = "quote_link"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ACTIVE", server_default="ACTIVE")

    restaurant_name: Mapped[str] = mapped_column(String(160), nullable=False)
    contact_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    contact_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    merchant_id: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    # The deal this quote belongs to (profiling.deal). When the request is
    # executed, the deal moves to ORDER_FORM_SIGNED and takes the totals.
    deal_id: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    # A short note shown at the top of the builder ("Hi Maria, here's ...").
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Applies to every line that has no special price of its own.
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False, default=0, server_default="0")
    allow_lease: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    expires_at: Mapped[Optional[dt.datetime]] = _ts()
    created_by_id: Mapped[str] = mapped_column(String(30), nullable=False)
    created_by_email: Mapped[str] = mapped_column(String(200), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    last_opened_at: Mapped[Optional[dt.datetime]] = _ts()
    open_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    items: Mapped[list["QuoteLinkItem"]] = relationship(
        back_populates="link", cascade="all, delete-orphan", lazy="selectin"
    )


class QuoteLinkItem(Base):
    """Special pricing for one item on one link. Empty price fields mean 'use the list price'."""

    __tablename__ = "quote_link_item"
    __table_args__ = (UniqueConstraint("link_id", "item_id", name="uq_quote_link_item"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    link_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.quote_link.id", ondelete="CASCADE"), nullable=False)
    item_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.price_item.id", ondelete="CASCADE"), nullable=False)
    percent_off: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    monthly_price: Mapped[Optional[Decimal]] = mapped_column(MONEY, nullable=True)
    purchase_price: Mapped[Optional[Decimal]] = mapped_column(MONEY, nullable=True)
    lease_price: Mapped[Optional[Decimal]] = mapped_column(MONEY, nullable=True)
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")

    link: Mapped["QuoteLink"] = relationship(back_populates="items")


class QuoteRequest(Base):
    __tablename__ = "quote_request"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    number: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    link_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.quote_link.id", ondelete="CASCADE"), nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)

    restaurant_name: Mapped[str] = mapped_column(String(160), nullable=False)
    contact_name: Mapped[str] = mapped_column(String(120), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(200), nullable=False)
    contact_phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # The request's own columns mirror its CURRENT revision (quote_revision).
    current_revision_no: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    # Hidden-price link: once staff send a priced revision with "reveal", the
    # restaurant sees prices for THIS request (the link's catalog stays hidden).
    prices_revealed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    declined_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    hardware_plan: Mapped[str] = mapped_column(String(10), nullable=False)  # BUY | LEASE
    selections: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    lines: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)  # priced snapshot
    one_time_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    monthly_software_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    monthly_lease_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    list_one_time_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    list_monthly_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)

    accepted_at: Mapped[Optional[dt.datetime]] = _ts()
    accepted_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    accepted_title: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    accepted_ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    client_ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    notified: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    staff_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    revisions: Mapped[list["QuoteRevision"]] = relationship(
        back_populates="request", cascade="all, delete-orphan", lazy="selectin", order_by="QuoteRevision.rev_no"
    )
    signatures: Mapped[list["QuoteSignature"]] = relationship(
        back_populates="request", cascade="all, delete-orphan", lazy="selectin", order_by="QuoteSignature.signed_at"
    )


class QuoteRevision(Base):
    """One send in the negotiation: an immutable priced snapshot of the quote.

    rev 1 is the restaurant's original submission; later revisions are staff
    counters (author STAFF) or restaurant counters (author RESTAURANT). The
    parent request's columns mirror the highest revision. ``content_hash`` is
    the SHA-256 of what a signature on this revision covers - see
    app/modules/quotes/signing.py.
    """

    __tablename__ = "quote_revision"
    __table_args__ = (UniqueConstraint("request_id", "rev_no", name="uq_quote_revision_no"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    request_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.quote_request.id", ondelete="CASCADE"), nullable=False)
    rev_no: Mapped[int] = mapped_column(Integer, nullable=False)
    author_kind: Mapped[str] = mapped_column(String(20), nullable=False)  # STAFF | RESTAURANT
    author_name: Mapped[Optional[str]] = mapped_column(String(160), nullable=True)
    author_email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    # A short message to the other party ("Here's 10% off the kiosk ...").
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    hardware_plan: Mapped[str] = mapped_column(String(10), nullable=False)
    selections: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    lines: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    one_time_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    monthly_software_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    monthly_lease_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    list_one_time_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    list_monthly_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    request: Mapped["QuoteRequest"] = relationship(back_populates="revisions")


class QuoteSignature(Base):
    """An electronic signature on one revision, with its evidence.

    ``signature_data`` is a PNG data URL for a drawn signature, or the adopted
    text for a typed one. ``content_hash`` is the revision's hash at signing
    time, so a signature can never drift onto changed numbers.
    """

    __tablename__ = "quote_signature"
    __table_args__ = (UniqueConstraint("request_id", "rev_no", "role", name="uq_quote_signature_role"),
                      {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    request_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.quote_request.id", ondelete="CASCADE"), nullable=False)
    rev_no: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(String(10), nullable=False)  # CLIENT | INNOWI
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    method: Mapped[str] = mapped_column(String(10), nullable=False)  # DRAWN | TYPED
    signature_data: Mapped[str] = mapped_column(Text, nullable=False)
    consent_version: Mapped[str] = mapped_column(String(40), nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # Signatures stay on their revision for the record; a later revision voids
    # them for the deal (voided_at set) and signing starts over.
    voided_at: Mapped[Optional[dt.datetime]] = _ts()
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    signed_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    request: Mapped["QuoteRequest"] = relationship(back_populates="signatures")


class QuoteEvent(Base):
    """The request's trail (see EVENT_KINDS), printed on the signature certificate."""

    __tablename__ = "quote_event"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    request_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.quote_request.id", ondelete="CASCADE"), nullable=False)
    rev_no: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    actor: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    detail: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
