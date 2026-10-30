"""partner leads: the team comes from the Super App (people + invitations), not the portal

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f7
Create Date: 2026-10-19

The partner portal is being retired. Who a partner lead can be assigned to, and
who gets the new-lead e-mails, now comes from the Super App:

* everyone signed up (status ACTIVE) or invited (pending, not expired) with a
  role that can work leads (Super Admin, Admin, Sales Manager, Sales Executive);
* `auth.lead_routing` keeps the two per-person switches, keyed by e-mail so an
  invitation's settings carry over when it is accepted. `assignable` NULL means
  "the role's default": on for Sales Manager / Sales Executive, off for admins.
* `auth.lead_team()` is the one definition of the team. The API and the lead
  e-mails (Supabase functions, through a small public wrapper created by
  api/sql/partner_team_superapp.sql) both read it.

Seeded from the portal's public.partner_team (when it exists) so names and the
switches survive, e.g. who receives new-lead e-mails. People there without a
Super App login stay listed for their name only and can't be assigned.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.db.schemas import qualified

revision: str = "b2c3d4e5f6a8"
down_revision: Union[str, None] = "a1b2c3d4e5f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

S = "auth"


def upgrade() -> None:
    A = qualified(S)
    op.create_table(
        "lead_routing",
        sa.Column("email", sa.String(length=254), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=True),
        sa.Column("assignable", sa.Boolean(), nullable=True),
        sa.Column("receives_new_leads", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_by", sa.String(length=254), nullable=True),
        schema=S,
    )

    conn = op.get_bind()
    if conn.execute(sa.text("select to_regclass('public.partner_team') is not null")).scalar():
        op.execute(
            f"""insert into {A}.lead_routing (email, name, assignable, receives_new_leads, updated_by)
                select distinct on (lower(email)) lower(email), name, assignable, coalesce(receives_new_leads, false), 'partner portal'
                from public.partner_team where email is not null and email <> ''
                order by lower(email)
                on conflict (email) do nothing"""
        )

    op.execute(
        f"""
create or replace function {A}.lead_team()
returns table (email text, name text, superapp_role text, role text, assignable boolean, receives_new_leads boolean, status text)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  with people as (
    select lower(u.email) as email,
           nullif(btrim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), '') as name,
           u.role::text as r, 'active'::text as st
      from {A}."user" u
     where u.status = 'ACTIVE'
    union all
    (select distinct on (lower(i.email)) lower(i.email), null::text, i.role::text, 'invited'::text
       from {A}.invitation i
      where i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
        and not exists (select 1 from {A}."user" u2 where lower(u2.email) = lower(i.email))
      order by lower(i.email), i.created_at desc)
  ),
  eligible as (
    select * from people where r in ('SUPER_ADMIN', 'ADMIN', 'SALES_MANAGER', 'SALES_EXECUTIVE')
  )
  select e.email,
         coalesce(e.name, lr.name),
         e.r,
         case when e.r in ('SUPER_ADMIN', 'ADMIN') then 'admin' else 'member' end,
         coalesce(lr.assignable, e.r in ('SALES_MANAGER', 'SALES_EXECUTIVE')),
         coalesce(lr.receives_new_leads, false),
         e.st
    from eligible e
    left join {A}.lead_routing lr on lr.email = e.email
  union all
  -- Known names that can't take leads right now (no login, turned off, or another role).
  select lr.email, lr.name, u.role::text, 'member', false, false,
         case when u.id is null then 'no_login' when u.status <> 'ACTIVE' then 'inactive' else 'other_role' end
    from {A}.lead_routing lr
    left join {A}."user" u on lower(u.email) = lr.email
   where not exists (select 1 from eligible e where e.email = lr.email)
$fn$
"""
    )
    # A security-definer function is executable by PUBLIC by default; it lists names and
    # e-mails, so only the app itself and the lead e-mail functions may call it.
    op.execute(f"revoke all on function {A}.lead_team() from public")
    op.execute(
        f"""
do $$
declare r text;
begin
  foreach r in array array['service_role', 'postgres'] loop
    if exists (select 1 from pg_roles where rolname = r) and r <> current_user then
      execute format('grant usage on schema %I to %I', '{A}', r);
      execute format('grant execute on function %I.lead_team() to %I', '{A}', r);
    end if;
  end loop;
end $$
"""
    )


def downgrade() -> None:
    A = qualified(S)
    op.execute(f"drop function if exists {A}.lead_team()")
    op.drop_table("lead_routing", schema=S)
