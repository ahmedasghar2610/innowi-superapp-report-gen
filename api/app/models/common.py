"""Shared column helpers used across every model module."""
from __future__ import annotations

import random
import string
import time

from sqlalchemy import String
from sqlalchemy.orm import mapped_column


_ALPHABET = string.ascii_lowercase + string.digits


def cuid() -> str:
    """
    Not a byte-for-byte port of the `cuid` npm package's algorithm — just a
    collision-resistant, sortable-ish opaque id in the same shape (lowercase
    alnum, ~25 chars) that Prisma's `@default(cuid())` produces, since nothing
    in this codebase parses the internal structure of an id.
    """
    ts = format(int(time.time() * 1000), "x")
    rand = "".join(random.choices(_ALPHABET, k=16))
    return f"c{ts}{rand}"[:25]


def id_column():
    return mapped_column(String(30), primary_key=True, default=cuid)
