// One-click actions from emails ("Assign to Freddie", "Mark as Won").
// The email links open the Super App page /lead-action?t=TOKEN, a confirm page that calls this
// function (through the Super App API) — so Outlook/Safe Links link-scanners can't trigger
// actions by prefetching.
//   { token, commit: false } → preview what the button will do
//   { token, commit: true }  → do it
import { admin, cors, dashLink, getSettings, getTeam, json, leadFacts, notifyAssignee, postTeams, STATUS_LABEL } from '../_shared/lib.ts'


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'POST only' }, 405)
  const body = await req.json().catch(() => ({}))
  const token = String(body.token ?? '')
  if (!/^[0-9a-f-]{36}$/.test(token)) return json(req, { ok: false, error: 'invalid' }, 400)

  const { data: r, error } = await admin.rpc('partner_apply_token', { p_token: token, p_commit: !!body.commit })
  if (error) return json(req, { ok: false, error: 'server' }, 500)
  if (!r?.ok) return json(req, r)

  const out = {
    ok: true,
    action: r.action,
    value: r.value,
    value_label: r.action === 'assign' ? r.value_name : STATUS_LABEL[r.value] ?? r.value,
    lead: { full_name: r.lead.full_name, company: r.lead.company },
    already: r.already,
    committed: !!r.committed,
  }
  if (!r.committed || r.already) return json(req, out)

  // Side effects after a successful change (e-mail + Teams), unless notifications are off.
  const s = await getSettings()
  if (!s.notify_enabled) return json(req, out)
  const team = await getTeam()
  const name = (email: string) => team.find((m) => m.email === email)?.name || email
  const { data: lead } = await admin.from('partner_leads').select('*').eq('id', r.lead.id).single()

  if (r.action === 'assign') {
    await notifyAssignee(s, team, lead, r.value as string, r.recipient)
  } else {
    await postTeams(s, {
      title: `${r.value === 'won' ? '🏆' : r.value === 'lost' ? '✖️' : '📈'} ${lead.full_name} → ${STATUS_LABEL[r.value] ?? r.value}`,
      text: `updated by ${name(r.recipient)}`,
      facts: leadFacts(lead),
      url: dashLink(lead.id),
      urlLabel: 'Open lead',
    })
  }
  return json(req, out)
})
