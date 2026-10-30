"""
Async engine + session factory. Mirrors PrismaService/PrismaModule: one shared
engine for the process, a scoped AsyncSession per request via FastAPI's
dependency system.
"""
from __future__ import annotations

from typing import Any, AsyncGenerator
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.db.schemas import schema_translate_map

_settings = get_settings()


def engine_kwargs() -> dict[str, Any]:
    """``create_async_engine`` options for this deployment. Tests that open their
    own engine against the same database should use these too, so they work
    through the same pooler as the app."""
    kwargs: dict[str, Any] = {"pool_pre_ping": True, "echo": False}
    if _settings.DB_POOL_MODE == "null":
        # Serverless: no idle pool per instance (see Settings.DB_POOL_MODE), and
        # no prepared-statement caching. Serverless traffic should go through a
        # *transaction-mode* pooler (Supabase port 6543), which hands a different
        # server connection to every transaction: a statement prepared before a
        # commit does not exist on the connection that serves the next query,
        # and asyncpg's default numbered names ("__asyncpg_stmt_1__") collide
        # between clients that share a server connection. With a fresh
        # connection per request the cache bought nothing anyway.
        kwargs = {
            "poolclass": NullPool,
            "echo": False,
            "connect_args": {
                "prepared_statement_cache_size": 0,
                "statement_cache_size": 0,
                "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
            },
        }
    translate = schema_translate_map()
    if translate:
        # Shared database: map the plain schema names onto the prefixed ones
        # (see app/db/schemas.py).
        kwargs["execution_options"] = {"schema_translate_map": translate}
    return kwargs


engine: AsyncEngine = create_async_engine(_settings.database_url_async, **engine_kwargs())

SessionLocal = async_sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
