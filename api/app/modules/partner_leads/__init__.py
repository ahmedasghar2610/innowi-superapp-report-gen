"""Partner leads: applications from partners.innowi.com, shown inside the Super App.

The data is owned by the partner portal (Supabase tables public.partner_leads,
partner_lead_notes, partner_lead_events, partner_team in the same database).
This module reads and updates them with plain SQL — no ORM models — so they
stay out of Alembic: the Super App never migrates the partner portal's tables.
"""
