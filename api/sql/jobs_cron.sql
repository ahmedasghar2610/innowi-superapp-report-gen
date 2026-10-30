-- Scheduled work for the Super App API on Vercel (see app/modules/jobs/router.py).
-- On a serverless host nothing runs between requests, so Supabase pg_cron +
-- pg_net call POST /api/v1/jobs/{job} instead of the API looping in-process.
--
-- Run ONCE in the Supabase SQL editor (project innowi-site-manager) after the
-- API with /api/v1/jobs is live. The token is the scheduler secret already in
-- Vault for the Salesforce sync (superapp_salesforce_sync_token); the API
-- accepts it for these jobs too (JOBS_CRON_TOKEN unset = SALESFORCE_SYNC_TOKEN).
-- Each call does one job inside its own time budget (JOBS_TIME_BUDGET_S, 600 s
-- by default), so the HTTP timeout is set above that.
--
-- Undo: select cron.unschedule('<jobname>');

select cron.schedule('superapp-ops-sla', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://superapp-api-test.vercel.app/api/v1/jobs/ops-sla',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Sync-Token',(select decrypted_secret from vault.decrypted_secrets where name='superapp_salesforce_sync_token')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$$);

-- Ops CRM daily digest to the Teams alerts channel: hourly; the API posts once
-- a day, on the first run after OPS_DIGEST_HOUR (needs OPS_TEAMS_FLOW_URL/SECRET).
select cron.schedule('superapp-ops-digest', '5 * * * *', $$
  select net.http_post(
    url := 'https://superapp-api-test.vercel.app/api/v1/jobs/ops-digest',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Sync-Token',(select decrypted_secret from vault.decrypted_secrets where name='superapp_salesforce_sync_token')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
$$);

-- Daily syncs: the API decides when each is due (its *_AUTO_SYNC_HOUR in
-- *_TIMEZONE), or resumes a run that stopped at the time limit. Hourly ticks,
-- staggered so they never overlap.
select cron.schedule('superapp-gbp-sync', '7 * * * *', $$
  select net.http_post(
    url := 'https://superapp-api-test.vercel.app/api/v1/jobs/gbp',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Sync-Token',(select decrypted_secret from vault.decrypted_secrets where name='superapp_salesforce_sync_token')),
    body := '{}'::jsonb, timeout_milliseconds := 790000)
$$);

select cron.schedule('superapp-ads-sync', '27 * * * *', $$
  select net.http_post(
    url := 'https://superapp-api-test.vercel.app/api/v1/jobs/ads',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Sync-Token',(select decrypted_secret from vault.decrypted_secrets where name='superapp_salesforce_sync_token')),
    body := '{}'::jsonb, timeout_milliseconds := 790000)
$$);

select cron.schedule('superapp-seo-sync', '47 * * * *', $$
  select net.http_post(
    url := 'https://superapp-api-test.vercel.app/api/v1/jobs/seo',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Sync-Token',(select decrypted_secret from vault.decrypted_secrets where name='superapp_salesforce_sync_token')),
    body := '{}'::jsonb, timeout_milliseconds := 790000)
$$);

-- SEO Blog Impact (added 2026-10-22). Ticks every 15 minutes; the API starts a
-- refresh only when one of the times saved on SEO → Blog Impact has passed
-- since the last run (or the last run stopped at the time limit). Change the
-- times on that tab, not here. Offset from the other jobs (:03, :18, :33, :48).
select cron.schedule('superapp-seo-blogs', '3,18,33,48 * * * *', $$
  select net.http_post(
    url := 'https://superapp-api-test.vercel.app/api/v1/jobs/seo-blogs',
    headers := jsonb_build_object('Content-Type','application/json',
      'X-Sync-Token',(select decrypted_secret from vault.decrypted_secrets where name='superapp_salesforce_sync_token')),
    body := '{}'::jsonb, timeout_milliseconds := 790000)
$$);
