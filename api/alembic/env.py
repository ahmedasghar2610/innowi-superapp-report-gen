from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from app.config import get_settings, to_asyncpg_url
from app.db.schemas import schema_translate_map
from app.db.base import Base
from app.models import auth, audit, catalog, profiling, boundary, website, salesforce, quotes, assistant, roadmap, requests, ops, gbp, ads, seo, menu, report_gen  # noqa: F401 — populate metadata

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# All 8 Postgres schemas from schema.prisma (multiSchema) must exist before
# Alembic creates tables inside them — see docker/init/01-init.sql, mirrored
# by scripts in this repo's docker-compose.yml init.
SCHEMAS = ["audit", "auth", "profiling", "catalog", "delivery", "performance", "marketing", "payments", "salesforce", "quotes", "roadmap", "ops"]


def get_url() -> str:
    settings = get_settings()
    # Migrations run against the DIRECT (unpooled) connection, mirroring
    # Prisma Migrate's directUrl. Neon (and other managed Postgres) URLs
    # commonly carry sslmode/channel_binding query params that asyncpg's
    # connect() rejects outright — to_asyncpg_url() strips them.
    return to_asyncpg_url(settings.DIRECT_URL)


def run_migrations_offline() -> None:
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=get_settings().ALEMBIC_VERSION_SCHEMA,
        include_schemas=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _include_object(object, name, type_, reflected, compare_to):
    # The alembic_version bookkeeping table itself must never appear in a diff.
    if type_ == "table" and name == "alembic_version":
        return False
    return True


def _translate_operation_schemas(translate: dict[str, str]) -> None:
    """Rename schemas on every Alembic operation before it runs.

    SQLAlchemy's schema_translate_map covers CREATE TABLE and the like, but
    Alembic's ALTER-style operations (drop_column, alter_column, add_column,
    create_index, create_foreign_key ...) render the schema string directly.
    Every operation goes through Operations.invoke(), so translating the
    schema attributes there covers all of them. Only plain app schema names
    are in the map; anything else passes through unchanged.
    """
    from alembic.operations import Operations

    if getattr(Operations.invoke, "_schema_translating", False):
        return
    original_invoke = Operations.invoke

    def invoke(self, operation):
        for attr in ("schema", "source_schema", "referent_schema"):
            value = getattr(operation, attr, None)
            if isinstance(value, str) and value in translate:
                setattr(operation, attr, translate[value])
        return original_invoke(self, operation)

    invoke._schema_translating = True  # type: ignore[attr-defined]
    Operations.invoke = invoke  # type: ignore[method-assign]


def do_run_migrations(connection) -> None:
    translate = schema_translate_map()
    if translate:
        # Shared database: run every migration against the prefixed schemas
        # (see app/db/schemas.py). Hand-written SQL in migrations uses
        # app.db.schemas.qualified() instead.
        connection = connection.execution_options(schema_translate_map=translate)
        _translate_operation_schemas(translate)
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        version_table_schema=get_settings().ALEMBIC_VERSION_SCHEMA,
        include_schemas=True,
        include_object=_include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        {"sqlalchemy.url": get_url()},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
