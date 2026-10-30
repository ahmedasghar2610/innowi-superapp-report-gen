// New partner lead → email the lead's dispatcher(s) (whoever has "New-lead e-mails" on in the
// Super App) with one-click assign buttons, CC the configured addresses, and post a card to Teams.
// Called by a database trigger (pg_net) right after a lead is inserted, and as a catch-up
// from partner-lead-reminders. Idempotent: a lead is only announced once (notified_at).
// Business-card leads (source_cta='business-card-scan') are NOT announced here: the card agent
// announces each batch once via partner-lead-batch-notify (one email per batch instead of one
// per lead). notified_at stays null so the reminders catch-up still covers them if that call fails.
// (The portal-only { test: true } mode was removed with the portal: it needed a portal login.)
import { admin, cors, dashLink, getSettings, getTeam, json, leadFacts, postTeams, sendAssignEmail } from '../_shared/lib.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'POST only' }, 405)
  const body = await req.json().catch(() => ({}))
  const s = await getSettings()

  const leadId = String(body.lead_id ?? '')
  if (!/^[0-9a-f-]{36}$/.test(leadId)) return json(req, { error: 'lead_id required' }, 400)
  if (!s.notify_enabled) return json(req, { skipped: 'notifications disabled' })

  const { data: lead } = await admin.from('partner_leads').select('*').eq('id', leadId).maybeSingle()
  if (!lead) return json(req, { error: 'not found' }, 404)
  if (lead.notified_at || lead.teams_notified_at) return json(req, { skipped: 'already notified' })
  if (lead.status === 'spam') return json(req, { skipped: 'spam' })
  if (lead.source_cta === 'business-card-scan') return json(req, { skipped: 'business-card lead; announced per batch by partner-lead-batch-notify' })

  const team = await getTeam()
  const mail = await sendAssignEmail(s, team, lead, 'new')
  const teams = await postTeams(s, {
    title: `🆕 New partner lead: ${lead.full_name}`,
    text: mail.ok
      ? `Emailed to ${team.filter((m) => m.receives_new_leads).map((m) => m.name || m.email).join(', ')} to assign.`
      : 'Open the lead to assign it in the Super App.',
    facts: leadFacts(lead),
    url: dashLink(lead.id),
    urlLabel: 'Open lead',
  })

  const now = new Date().toISOString()
  const patch: Record<string, string> = {}
  if (mail.ok) patch.notified_at = now
  if (teams.ok) patch.teams_notified_at = now
  if (Object.keys(patch).length) await admin.from('partner_leads').update(patch).eq('id', leadId)
  if (mail.ok || teams.ok) {
    await admin.from('partner_lead_events').insert({ lead_id: leadId, actor_email: null, type: 'notified', detail: { email: mail.ok, to: mail.ok ? team.filter((m) => m.receives_new_leads).map((m) => m.email) : [], teams: teams.ok } })
  }
  return json(req, { email: mail, teams })
})
