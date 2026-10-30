-- Partner network contacts: people met at conferences (business cards), imports,
-- or added by hand. A contact is NOT a lead. Someone on the team decides a contact
-- is a potential partner and promotes it; only then does a row appear in
-- public.partner_leads and the existing lead pipeline (assignment, reminders,
-- e-mails) takes over.
--
-- Run ONCE in the Supabase SQL editor (project innowi-site-manager) as the project
-- owner, like partner_leads_access.sql. Not an Alembic migration on purpose: the
-- table lives next to the partner portal's tables in `public`, not in a Super App
-- schema, so the card agent can write to it with the portal's publishable key.
--
-- Writers:
--   anon / authenticated  insert only (the card agent on Shayan's Mac, status 'new')
--   superapp              read, insert (manual add), update, promote (Super App API)
--   partner portal team   read / update (partner_is_team), for parity with leads

create table if not exists public.partner_contacts (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  status           text not null default 'new'
                   check (status in ('new', 'potential_partner', 'not_a_fit', 'customer', 'vendor', 'other')),
  full_name        text not null,
  title            text,
  company          text,
  email            text,
  phone            text,
  website          text,
  address          text,
  partner_type     text,
  notes            text,
  tags             text[] not null default '{}',
  met_at           text,                       -- event / place, e.g. "WSAA 2026"
  met_on           date,
  source           text not null default 'business-card'
                   check (source in ('business-card', 'manual', 'import')),
  scanned_by       text,                       -- who scanned / added it
  card_id          text,                       -- card agent's local id
  other_text       text,                       -- anything else printed on the card
  photo_url        text,
  batch_id         text,
  promoted_lead_id uuid references public.partner_leads (id) on delete set null,
  promoted_at      timestamptz,
  promoted_by      text
);

comment on table public.partner_contacts is
  'Partner network: contacts from business cards, imports or manual entry. Promote one to create a partner lead.';

create index if not exists partner_contacts_created_idx on public.partner_contacts (created_at desc);
create index if not exists partner_contacts_status_idx  on public.partner_contacts (status);
-- One contact per e-mail address. Re-scanning the same card updates instead of duplicating (trigger below).
create unique index if not exists partner_contacts_email_key
  on public.partner_contacts (lower(email)) where email is not null and email <> '';

-- updated_at on every change.
create or replace function public.partner_contacts_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists partner_contacts_touch on public.partner_contacts;
create trigger partner_contacts_touch before update on public.partner_contacts
  for each row execute function public.partner_contacts_touch();

-- Merge on insert: if a contact with the same e-mail exists, fill its blanks from the new
-- row, note the new meeting, and skip the insert. Keeps the card agent insert-only.
create or replace function public.partner_contacts_merge() returns trigger
language plpgsql security definer set search_path = public as $$
declare existing public.partner_contacts%rowtype;
begin
  if new.email is null or new.email = '' then
    return new;
  end if;
  new.email := lower(trim(new.email));
  select * into existing from public.partner_contacts where lower(email) = new.email limit 1;
  if not found then
    return new;
  end if;
  update public.partner_contacts set
    title        = coalesce(nullif(existing.title, ''),   new.title),
    company      = coalesce(nullif(existing.company, ''), new.company),
    phone        = coalesce(nullif(existing.phone, ''),   new.phone),
    website      = coalesce(nullif(existing.website, ''), new.website),
    address      = coalesce(nullif(existing.address, ''), new.address),
    partner_type = coalesce(nullif(existing.partner_type, ''), new.partner_type),
    other_text   = coalesce(nullif(existing.other_text, ''), new.other_text),
    photo_url    = coalesce(existing.photo_url, new.photo_url),
    met_at       = case when new.met_at is null or new.met_at = '' or existing.met_at = new.met_at
                        then existing.met_at
                        else concat_ws(', ', existing.met_at, new.met_at) end,
    notes        = case when new.met_at is not null and new.met_at <> '' and coalesce(existing.met_at, '') <> new.met_at
                        then concat_ws(E'\n', existing.notes, 'Met again at ' || new.met_at || ' (' || to_char(now(), 'YYYY-MM-DD') || ')')
                        else existing.notes end
  where id = existing.id;
  return null;  -- skip the insert; the existing row was updated
end $$;
drop trigger if exists partner_contacts_merge on public.partner_contacts;
create trigger partner_contacts_merge before insert on public.partner_contacts
  for each row execute function public.partner_contacts_merge();

-- Promote: copy the contact into partner_leads (source_cta 'network') and link the rows.
-- The lead insert fires the portal's normal new-lead e-mail, because at this point the
-- team has decided it IS a partner prospect. Requires an e-mail (leads do).
create or replace function public.promote_contact_to_lead(p_contact_id uuid, p_partner_type text default null, p_actor text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare c public.partner_contacts%rowtype; lead_id uuid;
begin
  select * into c from public.partner_contacts where id = p_contact_id for update;
  if not found then raise exception 'contact not found' using errcode = 'P0002'; end if;
  if c.promoted_lead_id is not null then return c.promoted_lead_id; end if;
  if c.email is null or c.email = '' then raise exception 'contact has no e-mail; a partner lead needs one' using errcode = '23502'; end if;
  insert into public.partner_leads
    (full_name, title, company, email, phone, website, partner_type, heard_about, message, wants_call,
     source_cta, utm_source, utm_medium, utm_campaign, utm_content, user_agent)
  values
    (c.full_name, c.title, c.company, c.email, c.phone, c.website,
     coalesce(nullif(p_partner_type, ''), c.partner_type, 'Other'), c.met_at,
     concat_ws(E'\n', 'Promoted from the partner network' || coalesce(' by ' || p_actor, '') || '.',
               nullif('Met at ' || c.met_at, 'Met at '), nullif('Address: ' || c.address, 'Address: '),
               nullif('Card: ' || c.other_text, 'Card: '), c.notes),
     false, 'network', 'network', 'contact', lower(regexp_replace(coalesce(c.met_at, 'network'), '[^A-Za-z0-9]+', '-', 'g')),
     c.batch_id, 'superapp/network')
  returning id into lead_id;
  update public.partner_contacts
    set promoted_lead_id = lead_id, promoted_at = now(), promoted_by = p_actor,
        status = case when status = 'new' then 'potential_partner' else status end
    where id = p_contact_id;
  return lead_id;
end $$;

-- ── Access ───────────────────────────────────────────────────────────────────
alter table public.partner_contacts enable row level security;

-- The card agent (and anything else with the publishable key): insert only, always as 'new',
-- never pre-promoted. No select, so it can't read the network back.
drop policy if exists "public can add contacts" on public.partner_contacts;
create policy "public can add contacts" on public.partner_contacts
  for insert to anon, authenticated
  with check (status = 'new' and promoted_lead_id is null and promoted_at is null and promoted_by is null);

-- Partner portal team (same people as the leads dashboard).
drop policy if exists "team can read contacts" on public.partner_contacts;
create policy "team can read contacts" on public.partner_contacts for select to authenticated using (partner_is_team());
drop policy if exists "team can update contacts" on public.partner_contacts;
create policy "team can update contacts" on public.partner_contacts for update to authenticated
  using (partner_is_team()) with check (partner_is_team());

-- Super App API (the restricted "superapp" DB role).
grant select, insert, update on public.partner_contacts to superapp;
drop policy if exists "superapp can read contacts" on public.partner_contacts;
create policy "superapp can read contacts"   on public.partner_contacts for select to superapp using (true);
drop policy if exists "superapp can add contacts" on public.partner_contacts;
create policy "superapp can add contacts"    on public.partner_contacts for insert to superapp with check (true);
drop policy if exists "superapp can update contacts" on public.partner_contacts;
create policy "superapp can update contacts" on public.partner_contacts for update to superapp using (true) with check (true);

-- Promotion is a Super App action (it checks partners.edit), never public.
revoke all on function public.promote_contact_to_lead(uuid, text, text) from public, anon, authenticated;
grant execute on function public.promote_contact_to_lead(uuid, text, text) to superapp;
