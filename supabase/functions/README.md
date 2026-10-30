# Partner-lead Supabase functions

Source of the functions deployed to the shared Supabase project (bkwnugmcgypbochzyckx).
They were written for the partner portal; since 2026-10-19 they read the team from the
Super App (`public.superapp_lead_team()`, see `api/sql/partner_team_superapp.sql`) and every
link opens the Super App (`/partners?lead=…`, `/lead-action?t=…`).

Each function bundles its own copy of `_shared/lib.ts`, so a change there means redeploying
every function. Deploy only with approval: they send real e-mails and Teams posts.

Optional secret: `SUPERAPP_WEB_URL` (default `https://superapp-web-test.vercel.app`).
