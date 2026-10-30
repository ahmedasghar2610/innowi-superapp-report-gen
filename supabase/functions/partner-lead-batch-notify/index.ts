// Business-card batch → ONE notification for the whole batch.
// Called by the card agent (card_reader.py push) right after it inserts a batch of leads with
// source_cta='business-card-scan' and utm_content=<batch_id>. Decides the format itself:
//   1 lead  → the normal single-lead email with one-click assign buttons (sendAssignEmail)
//   2+ leads → one digest email listing every lead, plus one Teams card
// Idempotent: only leads with notified_at IS NULL are announced; partner-lead-notify skips card
// leads so they are never announced twice. Safety net: if this call never happens, the 30-minute
// catch-up in partner-lead-reminders announces them one by one, as before.
import { admin, button, cors, dashboardLink, dashLink, esc, getSettings, getTeam, json, postTeams, sendAssignEmail, sendEmail, shell } from '../_shared/lib.ts'

const BATCH_RE = /^cards-\d{8}-[0-9a-f]{6,16}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'POST only' }, 405)
  const body = await req.json().catch(() => ({}))
  const batchId = String(body.batch_id ?? '')
  if (!BATCH_RE.test(batchId)) return json(req, { error: 'batch_id required (cards-YYYYMMDD-hex)' }, 400)

  const s = await getSettings()
  if (!s.notify_enabled) return json(req, { skipped: 'notifications disabled' })

  const { data: leads } = await admin
    .from('partner_leads').select('*')
    .eq('utm_content', batchId).eq('source_cta', 'business-card-scan')
    .is('notified_at', null).neq('status', 'spam')
    .order('created_at')
  if (!leads?.length) return json(req, { batch_id: batchId, leads: 0, skipped: 'nothing to announce (already notified or unknown batch)' })

  const team = await getTeam()
  const dispatchers = team.filter((m) => m.receives_new_leads)
  const n = leads.length
  const events = [...new Set(leads.map((l) => l.heard_about).filter(Boolean))]
  const eventLabel = events.length ? events.join(', ') : 'business cards'

  let mail: { ok: boolean; id?: string; error?: string }
  let teams: { ok: boolean; status?: number; error?: string }

  if (n === 1) {
    // One card: same email the team already knows, with assign buttons.
    const lead = leads[0]
    mail = await sendAssignEmail(s, team, lead, 'new')
    teams = await postTeams(s, {
      title: `🆕 New partner lead (business card, ${eventLabel}): ${lead.full_name}`,
      text: mail.ok ? `Emailed to ${dispatchers.map((m) => m.name || m.email).join(', ')} to assign.` : 'Open the lead to assign it in the Super App.',
      facts: [['Company', lead.company ?? ''], ['Type', lead.partner_type ?? ''], ['Email', lead.email ?? ''], ['Phone', lead.phone ?? '']],
      url: dashLink(lead.id),
      urlLabel: 'Open lead',
    })
  } else {
    // Several cards: one digest.
    if (!dispatchers.length) {
      mail = { ok: false, error: 'nobody is set to receive new leads' }
    } else {
      const rows = leads
        .map(
          (l) => `<tr>
<td style="padding:10px 12px;border-bottom:1px solid #F3F4F6;vertical-align:top"><strong>${esc(l.full_name)}</strong>${l.title ? `<br><span style="color:#7A7A7A">${esc(l.title)}</span>` : ''}</td>
<td style="padding:10px 12px;border-bottom:1px solid #F3F4F6;vertical-align:top">${esc(l.company ?? '')}${l.partner_type ? `<br><span style="color:#7A7A7A">${esc(l.partner_type)}</span>` : ''}</td>
<td style="padding:10px 12px;border-bottom:1px solid #F3F4F6;vertical-align:top;white-space:nowrap">${esc(l.email ?? '')}${l.phone ? `<br>${esc(l.phone)}` : ''}</td>
<td style="padding:10px 12px;border-bottom:1px solid #F3F4F6;vertical-align:top"><a href="${esc(dashLink(l.id))}" style="color:#000;font-weight:700">Open</a></td>
</tr>`,
        )
        .join('')
      const html = shell(
        `${n} new partner leads from ${eventLabel} business cards`,
        `<p style="font-size:15px;line-height:1.5;margin:0 0 16px">${n} business cards were scanned and added as partner leads. Open each one in the Super App to assign an owner.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:12px;font-size:14px">
<tr style="color:#7A7A7A;font-size:12px"><td style="padding:8px 12px">NAME</td><td style="padding:8px 12px">COMPANY</td><td style="padding:8px 12px">CONTACT</td><td style="padding:8px 12px"></td></tr>
${rows}
</table>
<div style="margin-top:20px">${button(dashboardLink(), 'Open partner leads', true)}</div>`,
      )
      mail = await sendEmail(s, {
        to: dispatchers.map((d) => d.email),
        cc: s.cc_emails,
        subject: `${n} new partner leads from ${eventLabel} business cards — assign them`,
        html,
      })
    }
    teams = await postTeams(s, {
      title: `🆕 ${n} new partner leads from ${eventLabel} business cards`,
      text: mail.ok ? `Digest emailed to ${dispatchers.map((m) => m.name || m.email).join(', ')}.` : 'Open the Super App to assign them.',
      facts: leads.slice(0, 12).map((l) => [l.full_name, [l.company, l.partner_type].filter(Boolean).join(' · ')] as [string, string]),
      url: dashboardLink(),
      urlLabel: 'Open partner leads',
    })
  }

  const now = new Date().toISOString()
  const patch: Record<string, string> = {}
  if (mail.ok) patch.notified_at = now
  if (teams.ok) patch.teams_notified_at = now
  const ids = leads.map((l) => l.id)
  if (Object.keys(patch).length) await admin.from('partner_leads').update(patch).in('id', ids)
  if (mail.ok || teams.ok) {
    await admin.from('partner_lead_events').insert(
      ids.map((id) => ({
        lead_id: id, actor_email: null, type: 'notified',
        detail: { batch_id: batchId, batch_size: n, email: mail.ok, to: mail.ok ? dispatchers.map((m) => m.email) : [], teams: teams.ok },
      })),
    )
  }
  return json(req, { batch_id: batchId, leads: n, mode: n === 1 ? 'single' : 'digest', email: mail, teams })
})
