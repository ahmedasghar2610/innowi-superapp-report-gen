"""Port of pagination-query.dto.ts + page-meta.dto.ts."""
from __future__ import annotations

import math
from typing import Literal

from fastapi import Query
from pydantic import BaseModel, Field


class PaginationParams:
    """FastAPI dependency mirroring PaginationQueryDto (page 1-based, limit default 25 max 100)."""

    def __init__(
        self,
        page: int = Query(1, ge=1, description="Page number (1-based)"),
        limit: int = Query(25, ge=1, le=100, description="Items per page"),
        order: Literal["asc", "desc"] = Query("desc", description="Sort direction"),
    ) -> None:
        self.page = page
        self.limit = limit
        self.order = order

    @property
    def skip(self) -> int:
        return (self.page - 1) * self.limit


class PageMeta(BaseModel):
    page: int
    limit: int
    total: int
    pageCount: int
    hasNextPage: bool
    hasPreviousPage: bool

    @classmethod
    def build(cls, page: int, limit: int, total: int) -> "PageMeta":
        page_count = math.ceil(total / limit) if limit else 0
        return cls(
            page=page,
            limit=limit,
            total=total,
            pageCount=page_count,
            hasNextPage=page < page_count,
            hasPreviousPage=page > 1,
        )


class Paginated(BaseModel):
    data: list
    meta: PageMeta
