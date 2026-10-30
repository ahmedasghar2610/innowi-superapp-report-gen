-- Partner leads in the Super App: database access for the "superapp" role.
-- Run ONCE in the Supabase SQL editor (project innowi-site-manager) as the project owner.
-- Not an Alembic migration on purpose: these tables belong to the partner portal
-- (partners.innowi.com), not to the Super App.
--
-- Minimum needed by app/modules/partner_leads:
--   read leads / notes / history / team list,
--   change only status, owner and last-contacted on a lead,
--   add notes.
-- Settings and e-mail action tokens stay inaccessible.
grant select on public.partner_leads, public.partner_lead_notes, public.partner_lead_events, public.partner_team to superapp;
grant update (status, assigned_to, last_contacted_at) on public.partner_leads to superapp;
grant insert on public.partner_lead_notes to superapp;

create policy "superapp can read leads"   on public.partner_leads       for select to superapp using (true);
create policy "superapp can update leads" on public.partner_leads       for update to superapp using (true) with check (true);
create policy "superapp can read notes"   on public.partner_lead_notes  for select to superapp using (true);
create policy "superapp can add notes"    on public.partner_lead_notes  for insert to superapp with check (true);
create policy "superapp can read events"  on public.partner_lead_events for select to superapp using (true);
create policy "superapp can read team"    on public.partner_team        for select to superapp using (true);
