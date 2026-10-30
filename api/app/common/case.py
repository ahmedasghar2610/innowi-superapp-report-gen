"""
camelCase <-> snake_case helpers.

Every DTO in this codebase mirrors the NestJS/class-validator DTOs verbatim,
so its field names are camelCase (matching the wire JSON, exactly like the
original). Every SQLAlchemy model attribute, by contrast, is snake_case
(matching normal Python/ORM convention and the underlying Postgres columns).

Any place that does `Model(**dto.model_dump())` or
`setattr(entity, key, value)` over a dict from `dto.model_dump()` MUST first
convert the keys through `to_snake_dict()`, or camelCase keys like
`preferredChannel` will raise `TypeError: invalid keyword argument` (on a
constructor) or silently set a nonexistent attribute (on setattr, since
Python objects allow arbitrary attribute assignment).
"""
from __future__ import annotations

import re

_CAMEL_RE = re.compile(r"(?<!^)(?=[A-Z])")


def camel_to_snake(name: str) -> str:
    return _CAMEL_RE.sub("_", name).lower()


def to_snake_dict(data: dict) -> dict:
    return {camel_to_snake(k): v for k, v in data.items()}
