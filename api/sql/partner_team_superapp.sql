-- Partner team from the Super App (the partner portal is being retired).
-- Run once on the shared Supabase database, as postgres, AFTER the API deploy
-- that ran migration b2c3d4e5f6a8 (it creates superapp_auth.lead_team()).
-- Idempotent: safe to run again.
--
-- 1) public.superapp_lead_team(): the lead e-mail functions (Supabase, service role)
--    call this instead of reading public.partner_team.
-- 2) partner_apply_token(): the e-mails' one-click buttons check the same team.
--    Assign: only a lead nobody owns yet, only to someone who can be given leads.
--    Status (Contacted, Won ...): only the lead's current owner, while still on the team.
-- public.partner_team itself is left in place (no data is deleted); nothing reads it
-- for assignment any more.

create or replace function public.superapp_lead_team()
returns table (email text, name text, superapp_role text, role text, assignable boolean, receives_new_leads boolean, status text)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$ select * from superapp_auth.lead_team() $$;

revoke all on function public.superapp_lead_team() from public;
revoke all on function public.superapp_lead_team() from anon, authenticated;
grant execute on function public.superapp_lead_team() to service_role;

create or replace function public.partner_apply_token(p_token uuid, p_commit boolean)
returns jsonb
language plpgsql
security definer
-- pg_catalog first: nobody can shadow a built-in (jsonb_build_object, now ...) from public.
set search_path = pg_catalog, public
as $function$
declare t public.partner_lead_tokens; l public.partner_leads; who_name text; who_ok boolean; owner_name text;
        recipient_ok boolean; n int; r jsonb;
begin
  select * into t from public.partner_lead_tokens where token = p_token;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid'); end if;
  if t.expires_at < now() then return jsonb_build_object('ok', false, 'error', 'expired'); end if;
  select * into l from public.partner_leads where id = t.lead_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'lead_gone'); end if;
  if t.action = 'assign' then
    select m.name, m.assignable into who_name, who_ok from public.superapp_lead_team() m where m.email = lower(t.value) limit 1;
  else
    select m.status in ('active', 'invited') into recipient_ok
      from public.superapp_lead_team() m where m.email = lower(t.recipient_email) limit 1;
  end if;

  r := jsonb_build_object('ok', true, 'action', t.action, 'value', t.value,
        'value_name', coalesce(who_name, t.value),
        'recipient', t.recipient_email,
        'lead', jsonb_build_object('id', l.id, 'full_name', l.full_name, 'company', l.company, 'partner_type', l.partner_type,
                                   'status', l.status, 'assigned_to', l.assigned_to, 'created_at', l.created_at),
        'already', case when t.action = 'assign' then l.assigned_to = t.value else l.status = t.value end);

  if t.action = 'assign' and l.assigned_to is distinct from t.value then
    -- The Assign buttons are for a lead nobody owns yet. Once someone has it, an old e-mail
    -- can't move it; change the owner in the Super App instead.
    if l.assigned_to is not null then
      select m.name into owner_name from public.superapp_lead_team() m where m.email = lower(l.assigned_to) limit 1;
      return jsonb_build_object('ok', false, 'error', 'already_assigned', 'owner', coalesce(owner_name, l.assigned_to));
    end if;
    -- Someone who can't be given leads any more (left, turned off, other role): say so up front.
    if coalesce(who_ok, false) is not true then
      return jsonb_build_object('ok', false, 'error', 'assignee_missing');
    end if;
  end if;
  if t.action = 'status' and l.status is distinct from t.value then
    -- Status buttons belong to the lead's current owner, while they're still on the team.
    if coalesce(recipient_ok, false) is not true then
      return jsonb_build_object('ok', false, 'error', 'not_on_team');
    end if;
    if lower(l.assigned_to) is distinct from lower(t.recipient_email) then
      return jsonb_build_object('ok', false, 'error', 'not_owner');
    end if;
  end if;

  if not p_commit then return r; end if;

  perform set_config('app.actor', t.recipient_email, true);
  if t.action = 'assign' then
    update public.partner_leads set assigned_to = t.value where id = l.id and assigned_to is null;
    get diagnostics n = row_count;
    if n = 0 and not coalesce((r->>'already')::boolean, false) then
      -- Someone else took it between the preview and this click.
      return jsonb_build_object('ok', false, 'error', 'already_assigned');
    end if;
  else
    update public.partner_leads set status = t.value where id = l.id and status is distinct from t.value;
  end if;
  update public.partner_lead_tokens set used_at = coalesce(used_at, now()) where token = p_token;
  return r || jsonb_build_object('committed', true);
end $function$;

-- Only the e-mail functions (service role) call it, as before.
revoke all on function public.partner_apply_token(uuid, boolean) from public;
revoke all on function public.partner_apply_token(uuid, boolean) from anon, authenticated;
grant execute on function public.partner_apply_token(uuid, boolean) to service_role;
