"""Merchant menu — extracted from the merchant's Innowi Online Ordering page
(app/modules/merchant_profiling/menu_extractor.py). Lives in the `profiling`
schema beside the rest of the merchant profile.

    merchant_menu       1:1 with merchant — where the menu came from, the
                        restaurant's logo/banner, last run's outcome.
    merchant_menu_item  one row per menu item, replaced wholesale on every
                        successful extraction.
"""
from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import id_column

SCHEMA = "profiling"


class MerchantMenu(Base):
    __tablename__ = "merchant_menu"
    __table_args__ = {"schema": SCHEMA}

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column(
        ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    source_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    sub_url: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    branch_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    restaurant_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    logo_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    banner_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    exclude_catering: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    filter_graphics: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")

    total_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    valid_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    graphic_skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    no_image_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    # OK | FAILED — FAILED keeps the previous items and records why.
    last_status: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_attempt_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    extracted_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    extracted_by: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MerchantMenuItem(Base):
    __tablename__ = "merchant_menu_item"
    __table_args__ = (
        Index("ix_merchant_menu_item_merchant_id", "merchant_id", "position"),
        {"schema": SCHEMA},
    )

    id: Mapped[str] = id_column()
    merchant_id: Mapped[str] = mapped_column(ForeignKey(f"{SCHEMA}.merchant.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    name: Mapped[str] = mapped_column(String, nullable=False)
    price: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    category: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    image_hash: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    # VALID | NO_IMAGE | LOGO_GRAPHIC | REPEATED_GRAPHIC (menu_extractor.STATUS_*)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="VALID")
