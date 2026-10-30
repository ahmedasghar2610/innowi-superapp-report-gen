-- =============================================================================
-- First-boot initialization (runs once, before Alembic connects).
-- Creates the ownership schemas from schema.prisma's multiSchema layout.
-- Alembic (via SQLAlchemy) manages TABLES inside them; this file only
-- establishes the schemas themselves, since `CREATE SCHEMA` isn't something
-- autogenerate will ever emit for you on a from-scratch database.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS profiling;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS delivery;
CREATE SCHEMA IF NOT EXISTS performance;
CREATE SCHEMA IF NOT EXISTS marketing;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS salesforce;
-- Ops CRM (tickets). Also created by its Alembic migration, for databases
-- that were initialised before this schema existed.
CREATE SCHEMA IF NOT EXISTS ops;
