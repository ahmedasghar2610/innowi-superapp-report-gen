"""JWT encode/decode. Mirrors auth.service.ts's use of @nestjs/jwt (HS256)."""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from app.config import get_settings

ALGORITHM = "HS256"


def _ttl_to_seconds(ttl: str) -> int:
    """Mirrors AuthService.ttlToSeconds: '15m' | '1h' | '30d' | '900' style strings."""
    match = re.fullmatch(r"(\d+)([smhd])", ttl)
    if not match:
        return 900
    value = int(match.group(1))
    unit = match.group(2)
    multiplier = {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
    return value * multiplier


def create_access_token(payload: dict[str, Any]) -> tuple[str, int]:
    settings = get_settings()
    ttl_seconds = _ttl_to_seconds(settings.JWT_ACCESS_TTL)
    now = datetime.now(timezone.utc)
    to_encode = {**payload, "iat": now, "exp": now + timedelta(seconds=ttl_seconds)}
    token = jwt.encode(to_encode, settings.JWT_ACCESS_SECRET, algorithm=ALGORITHM)
    return token, ttl_seconds


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.JWT_ACCESS_SECRET, algorithms=[ALGORITHM])
