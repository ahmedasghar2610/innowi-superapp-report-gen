"""profiling schema — the spine: organizations and deals.

* ``organization``: any company Innowi works with that is not a restaurant —
  ISOs, agents, resellers, and the contractors who install hardware. A partner
  lead that signs becomes one. ``certified`` never expires and blocks nothing.
* ``deal``: one attempt to put Innowi into one restaurant. The merchant is
  created the moment the deal is, so every quote, ticket and call hangs off a
  real merchant from day one. Stages run from the sales steps into the
  onboarding steps ops tracks (order form → processor → menu → ready →
  deployed → live). ``number`` comes from a sequence and shows as ``D-1001``.
* ``deal_event``: the deal's history (stage changes, notes, quotes linked and
  executed, owner changes).
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Index, Integer, Numeric, Sequence, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import id_column
from app.models.enums import DealEventKind, DealStage, DeployedBy, HiredBy, OrganizationKind, OrganizationStatus

SCHEMA = "profiling"
DEAL_KEY_PREFIX = "D"

deal_number_seq = Sequence("deal_number_seq", schema=SCHEMA, start=1001)

# Stages in pipeline order; LOST sits outside the order.
STAGE_ORDER: list[DealStage] = [
    DealStage.NEW, DealStage.DEMO_BOOKED, DealStage.DEMO_DONE, DealStage.QUOTE_SENT, DealStage.ORDER_FORM_SIGNED,
    DealStage.PROCESSOR_SETUP, DealStage.MENU, DealStage.READY_TO_DEPLOY, DealStage.DEPLOYED, DealStage.LIVE,
]
ONBOARDING_STAGES = frozenset({
    DealStage.ORDER_FORM_SIGNED, DealStage.PROCESSOR_SETUP, DealStage.MENU, DealStage.READY_TO_DEPLOY,
    DealStage.DEPLOYED,
})


def stage_index(stage: DealStage) -> int:
    return STAGE_ORDER.index(stage) if stage in STAGE_ORDER else -1


def _enum(e, name: str):
    return Enum(e, name=name, schema=SCHEMA, native_enum=True)


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class Organization(Base):
    __tablename__ = "organization"
    __table_args__ = (
        Index("ix_organization_name", "name"),
        Index("ix_organization_kind", "kind"),
        Index("ix_organization_source", "source"),
        Index("ix_organization_parent_id", "parent_id"),
        Index("ix_organization_stage", "stage"),
        Index("ix_organization_owner_id", "owner_id"),
        Index("ix_organization_came_from", "came_from"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # An agent works under an ISO: the agent is an organization of its own (stage,
    # owner, deals credited to it) whose parent is the ISO. Top-level rows have none.
    parent_id: Mapped[Optional[str]] = mapped_column(
        "parent_id", ForeignKey(f"{SCHEMA}.organization.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[OrganizationKind] = mapped_column(_enum(OrganizationKind, "OrganizationKind"), nullable=False)
    status: Mapped[OrganizationStatus] = mapped_column(
        _enum(OrganizationStatus, "OrganizationStatus"), nullable=False,
        default=OrganizationStatus.PROSPECT, server_default=OrganizationStatus.PROSPECT.value,
    )
    website: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    zip: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Innowi Certified Partner. Never expires, never blocks anything.
    certified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    certified_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # The partners.innowi.com application this organization came from (public.partner_leads.id; no cross-schema FK).
    partner_lead_id: Mapped[Optional[str]] = mapped_column("partner_lead_id", String(60), nullable=True)
    # Where this record came from (app/models/sources.py ORGANIZATION_SOURCES) and the
    # file / lead behind it. Set by the code that creates it; never edited.
    source: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    source_detail: Mapped[Optional[str]] = mapped_column("source_detail", String(300), nullable=True)

    # Where the partner journey stands (app/modules/deals/partners.py PARTNER_STAGES):
    # New -> Demo scheduled ... -> IU enrollment -> Certified, or Not interested.
    # ``status`` (Prospect/Active/Inactive) is kept for history only; whether a
    # partner is active is worked out from its deals (>= 1 in the last 30 days).
    stage: Mapped[str] = mapped_column(String(30), nullable=False, default="NEW", server_default="NEW")
    stage_changed_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # When the partner (or agent) enrolled in Innowi University; kept once set.
    iu_enrolled_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    # Where the relationship started (CAME_FROM): Elavon, BMO, Direct, Conference,
    # Inbound (partner site / support / generic), plus who or what (introducer, event).
    came_from: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    came_from_detail: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    # The salesperson who looks after this partner (or agent).
    owner_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    assigned_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    next_step: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    next_step_due: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    # Stage / came-from filled in by reading the notes; cleared once a person sets them.
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # The Salesforce Account this is (salesforce.account.id), when there is one.
    salesforce_account_id: Mapped[Optional[str]] = mapped_column(String(18), nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    contacts: Mapped[list["OrganizationContact"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan", order_by="OrganizationContact.created_at"
    )
    deals: Mapped[list["Deal"]] = relationship(back_populates="organization", foreign_keys="Deal.organization_id")


class OrganizationContact(Base):
    __tablename__ = "organization_contact"
    __table_args__ = (Index("ix_organization_contact_org", "organization_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    organization_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.organization.id", ondelete="CASCADE"), nullable=False
    )
    organization: Mapped["Organization"] = relationship(back_populates="contacts")
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    role: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    is_primary: Mapped[bool] = mapped_column("is_primary", Boolean, nullable=False, default=False, server_default="false")
    # The business card (public.partner_contacts.id) this person came from, when they did.
    partner_contact_id: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class OrganizationEvent(Base):
    """An organization's history: stage changes, owner changes, links, notes."""
    __tablename__ = "organization_event"
    __table_args__ = (Index("ix_organization_event_org", "organization_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    organization_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.organization.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    # CREATED | STAGE_CHANGED | OWNER_CHANGED | CAME_FROM_CHANGED | LINKED | NOTE | AGENT_ADDED
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    from_value: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    to_value: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Deal(Base):
    __tablename__ = "deal"
    __table_args__ = (
        Index("ix_deal_merchant_id", "merchant_id"),
        Index("ix_deal_organization_id", "organization_id"),
        Index("ix_deal_owner_id", "owner_id"),
        Index("ix_deal_stage", "stage"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    number: Mapped[int] = mapped_column(
        Integer, deal_number_seq, server_default=deal_number_seq.next_value(), unique=True, nullable=False
    )
    merchant_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), nullable=False)
    merchant = relationship("Merchant", foreign_keys=[merchant_id])
    organization_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey(f"{SCHEMA}.organization.id", ondelete="SET NULL"), nullable=True
    )
    organization: Mapped[Optional["Organization"]] = relationship(back_populates="deals", foreign_keys=[organization_id])
    owner_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)

    stage: Mapped[DealStage] = mapped_column(
        _enum(DealStage, "DealStage"), nullable=False, default=DealStage.NEW, server_default=DealStage.NEW.value
    )
    stage_changed_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    source: Mapped[Optional[str]] = mapped_column(String(60), nullable=True)
    lost_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    amount_monthly: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    amount_one_time: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 2), nullable=True)
    demo_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deployment_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    deployed_by: Mapped[Optional[DeployedBy]] = mapped_column(_enum(DeployedBy, "DeployedBy"), nullable=True)
    contractor_organization_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey(f"{SCHEMA}.organization.id", ondelete="SET NULL"), nullable=True
    )
    contractor_organization: Mapped[Optional["Organization"]] = relationship(foreign_keys=[contractor_organization_id])
    hired_by: Mapped[Optional[HiredBy]] = mapped_column(_enum(HiredBy, "HiredBy"), nullable=True)
    go_live_date: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    events: Mapped[list["DealEvent"]] = relationship(
        back_populates="deal", cascade="all, delete-orphan", order_by="DealEvent.created_at.desc()"
    )

    @property
    def key(self) -> str:
        return f"{DEAL_KEY_PREFIX}-{self.number}"


class DealEvent(Base):
    __tablename__ = "deal_event"
    __table_args__ = (Index("ix_deal_event_deal_id", "deal_id"), {"schema": SCHEMA})

    id: Mapped[str] = id_column()
    deal_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.deal.id", ondelete="CASCADE"), nullable=False)
    deal: Mapped["Deal"] = relationship(back_populates="events")
    user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("auth.user.id", ondelete="SET NULL"), nullable=True)
    kind: Mapped[DealEventKind] = mapped_column(_enum(DealEventKind, "DealEventKind"), nullable=False)
    from_stage: Mapped[Optional[DealStage]] = mapped_column(_enum(DealStage, "DealStage"), nullable=True)
    to_stage: Mapped[Optional[DealStage]] = mapped_column(_enum(DealStage, "DealStage"), nullable=True)
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
