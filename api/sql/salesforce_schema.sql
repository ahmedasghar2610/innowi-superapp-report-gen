-- Sales module (Salesforce data) on the shared database: the schema it lives in.
-- Run ONCE in the Supabase SQL editor (project innowi-site-manager) as the project owner,
-- BEFORE deploying the migration d9e0f1a2b3c4. The "superapp" role cannot create
-- schemas there; owning this one lets its migration create the tables inside it.
create schema if not exists superapp_salesforce authorization superapp;
