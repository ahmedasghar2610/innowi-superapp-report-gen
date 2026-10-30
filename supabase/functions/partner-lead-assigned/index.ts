// A lead was assigned somewhere other than the e-mail buttons (the Innowi Super App) →
// tell the new owner (e-mail with one-click status buttons) and post to Teams.
//   POST { lead_id }
// Safe to call without a login: it only acts on an assignment that really happened (the
// `assigned` history row written by the partner_leads_touch trigger) in the last 15 minutes,
// only notifies the person the lead is assigned to right now, and only once per assignment.
import { admin, cors, getSettings, getTeam, json, notifyAssignee } from '../_shared/lib.ts'

const WINDOW_MS = 15 * 60_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'POST only' }, 405)
  const body = await req.json().catch(() => ({}))
  const leadId = String(body.lead_id ?? '')
  if (!/^[0-9a-f-]{36}$/.test(leadId)) return json(req, { error: 'lead_id required' }, 400)

  const s = await getSettings()
  if (!s.notify_enabled) return json(req, { skipped: 'notifications disabled' })

  const { data: lead } = await admin.from('partner_leads').select('*').eq('id', leadId).maybeSingle()
  if (!lead) return json(req, { error: 'not found' }, 404)
  if (!lead.assigned_to) return json(req, { skipped: 'not assigned' })

  const { data: events } = await admin
    .from('partner_lead_events')
    .select('type, detail, actor_email, created_at')
    .eq('lead_id', leadId)
    .in('type', ['assigned', 'assignee_notified'])
    .order('created_at', { ascending: false })
    .limit(20)
  const list = events ?? []
  const assigned = list.find((e) => e.type === 'assigned' && e.detail?.to === lead.assigned_to)
  if (!assigned) return json(req, { skipped: 'no matching assignment' })
  if (Date.now() - new Date(assigned.created_at).getTime() > WINDOW_MS) return json(req, { skipped: 'assignment too old' })
  const done = list.some(
    (e) => e.type === 'assignee_notified' && e.detail?.to === lead.assigned_to && new Date(e.created_at) >= new Date(assigned.created_at),
  )
  if (done) return json(req, { skipped: 'already notified' })

  const team = await getTeam()
  const result = await notifyAssignee(s, team, lead, lead.assigned_to, assigned.actor_email ?? null)
  return json(req, { ok: true, email: result.mail, teams: result.teams })
})
