-- Quote builder on the shared database: the schema it lives in.
-- Run ONCE in the Supabase SQL editor (project innowi-site-manager) as the project owner,
-- BEFORE deploying the migration e0f1a2b3c4d5. The "superapp" role cannot create
-- schemas there; owning this one lets its migration create the tables inside it.
create schema if not exists superapp_quotes authorization superapp;
