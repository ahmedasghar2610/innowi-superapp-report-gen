"""Feature flag. Off by default: the routes exist but answer 404 until
REPORT_GEN_ENABLED=true, so a deploy with the code in it changes nothing."""
from __future__ import annotations

from fastapi import HTTPException, status

from app.config import get_settings


def enabled() -> bool:
    return bool(get_settings().REPORT_GEN_ENABLED)


async def require_enabled() -> None:
    if not enabled():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
