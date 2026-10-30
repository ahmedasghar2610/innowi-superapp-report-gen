"""DTOs for Merchant → Profiling → Menu (routers/menu.py)."""
from __future__ import annotations

import datetime as dt
from typing import Optional

from pydantic import BaseModel, Field


class ExtractMenuDto(BaseModel):
    model_config = {"extra": "forbid"}

    # Ordering link or bare branch slug. Omitted → the merchant's saved
    # "Online ordering" value (when it is an Innowi link).
    link: Optional[str] = Field(None, max_length=500)
    excludeCatering: bool = False
    # Drop logo/banner copies and stock images shared by >5 items.
    filterGraphics: bool = True
    # Write the link back to the merchant's "Online ordering" field.
    saveLink: bool = True


class MenuStatsDto(BaseModel):
    total: int = 0
    valid: int = 0
    graphicSkipped: int = 0
    noImage: int = 0


class MenuItemDto(BaseModel):
    id: str
    name: str
    price: Optional[float] = None
    category: Optional[str] = None
    description: Optional[str] = None
    imageUrl: Optional[str] = None
    status: str


class MenuProgressDto(BaseModel):
    # connecting | menu | images | saving | done
    phase: str
    done: int = 0
    total: int = 0


class MenuSummaryDto(BaseModel):
    merchantId: str
    exists: bool
    # The merchant's saved "Online ordering" value, and whether it's usable here.
    merchantOnlineOrdering: Optional[str] = None
    merchantLinkUsable: bool = False
    # The Innowi link the menu is fetched from, and every Innowi link found in the Online ordering text.
    merchantLink: Optional[str] = None
    merchantLinks: list[str] = []
    sourceUrl: Optional[str] = None
    subUrl: Optional[str] = None
    branchId: Optional[int] = None
    restaurantName: Optional[str] = None
    logoUrl: Optional[str] = None
    bannerUrl: Optional[str] = None
    excludeCatering: bool = False
    filterGraphics: bool = True
    stats: MenuStatsDto = MenuStatsDto()
    # OK | FAILED | RUNNING
    lastStatus: Optional[str] = None
    progress: Optional[MenuProgressDto] = None
    lastError: Optional[str] = None
    lastAttemptAt: Optional[dt.datetime] = None
    extractedAt: Optional[dt.datetime] = None
    extractedBy: Optional[str] = None


class MenuResponseDto(MenuSummaryDto):
    categories: list[str] = []
    items: list[MenuItemDto] = []
