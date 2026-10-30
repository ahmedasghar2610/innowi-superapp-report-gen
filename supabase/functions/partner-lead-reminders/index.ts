// Runs every 30 minutes (pg_cron).
// 1) Catch-up: announce any lead the instant trigger missed (e.g. email was briefly down).
// 2) Reminder: one reminder per lead still unassigned after `reminder_hours`.
import { admin, cors, dashLink, getSettings, getTeam, json, leadFacts, postTeams, sendAssignEmail } from '../_shared/lib.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  const s = await getSettings()
  if (!s.notify_enabled) return json(req, { skipped: 'disabled' })
  const team = await getTeam()
  const results: unknown[] = []

  // 1) catch-up (older than 5 min so we don't race the trigger)
  const fiveMin = new Date(Date.now() - 5 * 60_000).toISOString()
  const { data: missed } = await admin
    .from('partner_leads').select('*')
    .is('notified_at', null).neq('status', 'spam').lt('created_at', fiveMin)
    .order('created_at').limit(10)
  // Email and Teams are tracked separately (notified_at / teams_notified_at), so if email is
  // down the Teams card still goes out once, and the email follows once email works again.
  for (const lead of missed ?? []) {
    const mail = await sendAssignEmail(s, team, lead, 'new')
    const now = new Date().toISOString()
    let teams: { ok: boolean } = { ok: !!lead.teams_notified_at }
    if (!lead.teams_notified_at) {
      teams = await postTeams(s, { title: `🆕 New partner lead: ${lead.full_name}`, facts: leadFacts(lead), url: dashLink(lead.id), urlLabel: 'Open lead' })
    }
    const patch: Record<string, string> = {}
    if (mail.ok) patch.notified_at = now
    if (teams.ok && !lead.teams_notified_at) patch.teams_notified_at = now
    if (Object.keys(patch).length) {
      await admin.from('partner_leads').update(patch).eq('id', lead.id)
      await admin.from('partner_lead_events').insert({ lead_id: lead.id, type: 'notified', detail: { catch_up: true, email: mail.ok, teams: !!patch.teams_notified_at } })
    }
    results.push({ catch_up: lead.id, mail, teams })
  }

  // 2) reminders — once per lead, for leads that reached someone by email OR Teams
  const cutoff = new Date(Date.now() - s.reminder_hours * 3600_000).toISOString()
  const { data: stale } = await admin
    .from('partner_leads').select('*')
    .eq('status', 'new').is('assigned_to', null).is('reminder_sent_at', null)
    .or('notified_at.not.is.null,teams_notified_at.not.is.null').lt('created_at', cutoff)
    .order('created_at').limit(20)
  for (const lead of stale ?? []) {
    const mail = await sendAssignEmail(s, team, lead, 'reminder')
    const teams = await postTeams(s, { title: `⏰ Still unassigned after ${s.reminder_hours}h: ${lead.full_name}`, facts: leadFacts(lead), url: dashLink(lead.id), urlLabel: 'Open lead' })
    if (mail.ok || teams.ok) {
      await admin.from('partner_leads').update({ reminder_sent_at: new Date().toISOString() }).eq('id', lead.id)
      await admin.from('partner_lead_events').insert({ lead_id: lead.id, type: 'reminder', detail: { hours: s.reminder_hours, email: mail.ok, teams: teams.ok } })
    }
    results.push({ reminder: lead.id, mail, teams })
  }
  return json(req, { ok: true, results })
})
