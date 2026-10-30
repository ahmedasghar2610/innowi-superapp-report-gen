"""Building blocks for the assistant's lookups.

A lookup ("tool") is a fixed, read-only query the model may ask for by name
with a few typed arguments. The model never writes SQL: every filter is a
bound parameter and every grouping is chosen from a fixed list here. Each
lookup names the capability a person needs, and only lookups the person
holds are offered to the model at all - a lookup they lack can't be called
even if the model asks for it by name (see engine.run_tool).
"""
from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from typing import Any, Awaitable, Callable, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.common.capabilities import Capability, has_capability
from app.common.deps import AuthenticatedUser

MAX_ROWS = 50
DEFAULT_ROWS = 20


class ToolError(Exception):
    """A problem with the arguments, reported back to the model so it can retry."""


@dataclass
class Ctx:
    db: AsyncSession
    user: AuthenticatedUser
    charts: list[dict[str, Any]] = field(default_factory=list)
    # Proposed actions (actions.py): cards put on screen this answer, the chat they belong
    # to, and a session factory for saving them (the lookup session is read-only).
    actions: list[dict[str, Any]] = field(default_factory=list)
    chat_id: Optional[str] = None
    session_factory: Any = None
    # Every "id" a lookup returned in this answer. Actions may only target these, so text
    # inside a record can't slip in a record the person never looked at.
    seen_ids: set[str] = field(default_factory=set)
    _scope: Any = None

    def can(self, capability: Capability) -> bool:
        return has_capability(self.user.role, capability)

    async def sales_scope(self):
        if self._scope is None:
            from app.modules.salesforce.service import load_scope

            self._scope = await load_scope(self.db, self.user)
        return self._scope


Runner = Callable[[Ctx, dict[str, Any]], Awaitable[Any]]


@dataclass
class Tool:
    name: str
    label: str                       # shown on screen while it runs ("Looking up deals")
    description: str
    properties: dict[str, Any]
    run: Runner
    capability: Optional[Capability] = None
    required: tuple[str, ...] = ()

    def schema(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": {
                "type": "object",
                "properties": self.properties,
                "required": list(self.required),
                "additionalProperties": False,
            },
        }

    def allowed(self, ctx: Ctx) -> bool:
        return self.capability is None or ctx.can(self.capability)


# ------------------------------------------------------------ arguments ----
def text_arg(args: dict, key: str, *, max_len: int = 120) -> Optional[str]:
    value = args.get(key)
    if value is None:
        return None
    if not isinstance(value, (str, int, float)):
        raise ToolError(f"{key} must be text")
    value = str(value).strip()
    if not value:
        return None
    return value[:max_len]


def choice_arg(args: dict, key: str, options: tuple[str, ...], default: Optional[str] = None) -> Optional[str]:
    value = args.get(key)
    if value is None or value == "":
        return default
    if value not in options:
        raise ToolError(f"{key} must be one of: {', '.join(options)}")
    return value


def date_arg(args: dict, key: str) -> Optional[dt.date]:
    value = args.get(key)
    if value in (None, ""):
        return None
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except ValueError:
        raise ToolError(f"{key} must be a date like 2026-10-01")


def number_arg(args: dict, key: str) -> Optional[float]:
    value = args.get(key)
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ToolError(f"{key} must be a number")


def bool_arg(args: dict, key: str, default: bool = False) -> bool:
    value = args.get(key)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if str(value).lower() in ("true", "1", "yes"):
        return True
    if str(value).lower() in ("false", "0", "no"):
        return False
    raise ToolError(f"{key} must be true or false")


def limit_arg(args: dict, default: int = DEFAULT_ROWS) -> int:
    value = args.get("limit")
    if value in (None, ""):
        return default
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise ToolError("limit must be a whole number")
    return max(1, min(MAX_ROWS, n))


def uuid_arg(args: dict, key: str) -> str:
    value = args.get(key)
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError):
        raise ToolError(f"{key} must be an id from an earlier lookup")


def day_start(d: dt.date, tz: dt.tzinfo) -> dt.datetime:
    return dt.datetime.combine(d, dt.time.min, tzinfo=tz)


def day_end_exclusive(d: dt.date, tz: dt.tzinfo) -> dt.datetime:
    return dt.datetime.combine(d + dt.timedelta(days=1), dt.time.min, tzinfo=tz)


# --------------------------------------------------------------- output ----
def jsonable(value: Any) -> Any:
    """Plain JSON for the model: Decimals become numbers, dates ISO strings."""
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items() if v is not None}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if isinstance(value, Decimal):
        f = float(value)
        return int(f) if f.is_integer() else round(f, 2)
    if isinstance(value, float):
        return int(value) if value.is_integer() else round(value, 2)
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, uuid.UUID):
        return str(value)
    if hasattr(value, "model_dump"):
        return jsonable(value.model_dump(mode="python"))
    return value


def page(rows: list, total: int, limit: int, **extra) -> dict[str, Any]:
    out: dict[str, Any] = {"total": total, "shown": len(rows), "rows": rows}
    if total > len(rows):
        out["note"] = f"Showing {len(rows)} of {total}. Use group_by or narrower filters for the full picture."
    out.update(extra)
    return out


SEARCH = {"type": "string", "description": "Words to find in the name (case-insensitive, partial match)."}
LIMIT = {"type": "integer", "minimum": 1, "maximum": MAX_ROWS, "description": f"Rows to return (default {DEFAULT_ROWS}, max {MAX_ROWS})."}
DATE = {"type": "string", "description": "A date, YYYY-MM-DD (inclusive)."}
