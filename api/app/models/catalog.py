"""catalog schema — Package, Service, Entitlement."""
from __future__ import annotations

from typing import Optional

from sqlalchemy import Boolean, Enum, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.common import id_column
from app.models.enums import DeliveryFrequency, OwnerTeam, ServiceCategory

SCHEMA = "catalog"


class Package(Base):
    __tablename__ = "package"
    __table_args__ = {"schema": SCHEMA}

    code: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)

    subscriptions: Mapped[list["Subscription"]] = relationship(back_populates="package")  # noqa: F821
    entitlements: Mapped[list["Entitlement"]] = relationship(back_populates="package")


class Service(Base):
    __tablename__ = "service"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    name: Mapped[str] = mapped_column(String, unique=True, nullable=False)
    category: Mapped[ServiceCategory] = mapped_column(
        Enum(ServiceCategory, name="ServiceCategory", schema=SCHEMA, native_enum=True), nullable=False
    )
    owner_team: Mapped[OwnerTeam] = mapped_column(
        "owner_team", Enum(OwnerTeam, name="OwnerTeam", schema=SCHEMA, native_enum=True), nullable=False
    )

    entitlements: Mapped[list["Entitlement"]] = relationship(back_populates="service")


class Entitlement(Base):
    __tablename__ = "entitlement"
    __table_args__ = (
        UniqueConstraint("service_id", "package_code", name="uq_entitlement_service_package"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    service_id: Mapped[str] = mapped_column("service_id", ForeignKey(f"{SCHEMA}.service.id"), nullable=False)
    service: Mapped["Service"] = relationship(back_populates="entitlements")
    package_code: Mapped[str] = mapped_column("package_code", ForeignKey(f"{SCHEMA}.package.code"), nullable=False)
    package: Mapped["Package"] = relationship(back_populates="entitlements")

    included: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    qty_per_period: Mapped[Optional[int]] = mapped_column("qty_per_period", Integer, nullable=True)
    frequency: Mapped[DeliveryFrequency] = mapped_column(
        Enum(DeliveryFrequency, name="DeliveryFrequency", schema=SCHEMA, native_enum=True), nullable=False
    )
    definition_of_done: Mapped[Optional[str]] = mapped_column("definition_of_done", String, nullable=True)
    owner_team: Mapped[OwnerTeam] = mapped_column(
        "owner_team", Enum(OwnerTeam, name="OwnerTeam", schema=SCHEMA, native_enum=True), nullable=False
    )
