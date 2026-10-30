-- Ops CRM on the shared database: the schema it lives in.
-- Run ONCE in the Supabase SQL editor (project innowi-site-manager) as the project owner,
-- BEFORE deploying the migration 50c8e72bcd7e (ops_tickets). The "superapp" role cannot
-- create schemas there; owning this one lets its migrations create the tables inside it.
-- (GBP, Google Ads, SEO and the merchant menu use the existing superapp_marketing and
-- superapp_profiling schemas, so they need nothing here.)
create schema if not exists superapp_ops authorization superapp;
