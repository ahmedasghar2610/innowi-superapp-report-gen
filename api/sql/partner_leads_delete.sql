-- Lets the SuperApp delete partner leads (DELETE /api/v1/partner-leads/{id}, admins only).
-- Run once as the database owner on the shared Supabase database; safe to run again.
-- Child rows (notes, history, tokens) go with the lead through their ON DELETE CASCADE
-- foreign keys (checked 2026-10-19; there is no delete trigger on partner_leads). A promoted
-- Partner Network contact stays, with promoted_lead_id set to NULL.
grant delete on public.partner_leads to superapp;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'partner_leads'
                 and policyname = 'superapp can delete leads') then
    create policy "superapp can delete leads" on public.partner_leads for delete to superapp using (true);
  end if;
end $$;
