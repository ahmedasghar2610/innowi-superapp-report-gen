// Shared helpers for the partner-lead routing functions.
// Email goes through Resend (Innowi's email provider). Teams via a Workflows webhook URL
// stored in public.partner_settings.teams_webhook_url.
//
// 2026-10-19: the partner portal is being retired. The team (who can be given leads, who
// gets the new-lead e-mails) now comes from the Innowi Super App's people, through
// public.superapp_lead_team(), and every link in the e-mails opens the Super App.
import { createClient } from 'npm:@supabase/supabase-js@2'

// Where the e-mail links go: the Super App web. Override with the SUPERAPP_WEB_URL secret.
export const APP = (Deno.env.get('SUPERAPP_WEB_URL') || 'https://superapp-web-test.vercel.app').replace(/\/+$/, '')
// Kept for the functions that import it by this name.
export const SITE = APP
export const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
})

const ALLOWED_ORIGINS = [APP, 'https://partners.innowi.com', 'http://localhost:4400', 'http://localhost:3000', 'http://localhost:3001']
export function cors(req: Request): Record<string, string> {
  const o = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
export const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } })

export interface Settings {
  notify_enabled: boolean
  from_address: string
  reply_to: string | null
  cc_emails: string[]
  reminder_hours: number
  teams_webhook_url: string | null
}
export async function getSettings(): Promise<Settings> {
  const { data } = await admin.from('partner_settings').select('*').eq('id', 1).single()
  return data as Settings
}

// status: active | invited (can take leads) — or no_login | inactive | other_role (listed for
// their name only; assignable and receives_new_leads are always false for them).
export interface Member { email: string; name: string | null; role: string; receives_new_leads: boolean; assignable: boolean; status: string }
export async function getTeam(): Promise<Member[]> {
  const { data, error } = await admin.rpc('superapp_lead_team')
  if (error) {
    console.error('superapp_lead_team failed', error.message)
    return []
  }
  return ((data ?? []) as Member[]).map((m) => ({ ...m, email: String(m.email).toLowerCase() }))
}

// ── Email (Resend) ────────────────────────────────────────────────────────
export async function sendEmail(s: Settings, msg: { to: string[]; cc?: string[]; subject: string; html: string; text?: string }) {
  const key = Deno.env.get('RESEND_API_KEY')
  if (!key) return { ok: false, error: 'RESEND_API_KEY secret is not set' }
  const cc = (msg.cc ?? []).filter((c) => c && !msg.to.includes(c))
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: s.from_address,
      to: msg.to,
      cc: cc.length ? cc : undefined,
      reply_to: s.reply_to || undefined,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    }),
  })
  const body = await res.json().catch(() => ({}))
  return res.ok ? { ok: true, id: body.id } : { ok: false, error: body?.message ?? `HTTP ${res.status}` }
}

// ── Teams (Workflows "post to a channel/chat when a webhook request is received") ──
export async function postTeams(s: Settings, card: { title: string; facts: [string, string][]; text?: string; url?: string; urlLabel?: string }) {
  if (!s.teams_webhook_url) return { ok: false, error: 'no Teams webhook configured' }
  const content = {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    body: [
      { type: 'TextBlock', text: card.title, weight: 'Bolder', size: 'Medium', wrap: true },
      ...(card.text ? [{ type: 'TextBlock', text: card.text, wrap: true, spacing: 'Small' }] : []),
      { type: 'FactSet', facts: card.facts.filter(([, v]) => v).map(([title, value]) => ({ title, value })) },
    ],
    actions: card.url ? [{ type: 'Action.OpenUrl', title: card.urlLabel ?? 'Open', url: card.url }] : [],
  }
  try {
    const res = await fetch(s.teams_webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content }] }),
    })
    return { ok: res.ok, status: res.status }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ── HTML building blocks (inline styles for Outlook) ─────────────────────
export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function button(href: string, label: string, primary = false) {
  const bg = primary ? '#000000' : '#ffffff'
  const fg = primary ? '#ffffff' : '#000000'
  return `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:10px 18px;border-radius:999px;border:1px solid #000;background:${bg};color:${fg};font-weight:700;font-size:14px;text-decoration:none;font-family:Arial,Helvetica,sans-serif">${esc(label)}</a>`
}

export const dashboardLink = () => `${APP}/partners`

export function shell(title: string, inner: string) {
  return `<!doctype html><html><body style="margin:0;background:#F9FAFB;font-family:Arial,Helvetica,sans-serif;color:#000">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #E5E7EB;border-radius:16px">
<tr><td style="padding:24px 28px 8px"><img src="${APP}/brand/innowi-wordmark.png" alt="Innowi" height="20" style="height:20px"></td></tr>
<tr><td style="padding:8px 28px 28px">
<h1 style="font-size:20px;line-height:1.3;margin:8px 0 16px">${esc(title)}</h1>
${inner}
</td></tr></table>
<p style="font-size:12px;color:#7A7A7A;margin:16px 0 0">Innowi Partner Program · <a href="${dashboardLink()}" style="color:#7A7A7A">Partner leads in the Super App</a></p>
</td></tr></table></body></html>`
}

// deno-lint-ignore no-explicit-any
export function leadTable(l: any) {
  const rows: [string, unknown][] = [
    ['Name', [l.full_name, l.title].filter(Boolean).join(' — ')],
    ['Company', l.company],
    ['Email', l.email],
    ['Phone', l.phone],
    ['Partner type', l.partner_type],
    ['Territory', l.region],
    ['Portfolio', [l.portfolio_size && `${l.portfolio_size} merchants`, l.restaurant_share && `${l.restaurant_share} restaurants`].filter(Boolean).join(' · ')],
    ['Processors', l.processors],
    ['Interests', (l.interests ?? []).join(', ')],
    ['Timeline', l.timeline],
    ['Wants a call', l.wants_call ? 'Yes' : 'No'],
    ['Heard about us', l.heard_about],
    ['Message', l.message],
  ]
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:12px;font-size:14px">
${rows
  .filter(([, v]) => v)
  .map(
    ([k, v]) =>
      `<tr><td style="padding:8px 12px;color:#7A7A7A;width:130px;vertical-align:top;border-bottom:1px solid #F3F4F6">${esc(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #F3F4F6;white-space:pre-wrap">${esc(v)}</td></tr>`,
  )
  .join('')}
</table>`
}

// deno-lint-ignore no-explicit-any
export function leadFacts(l: any): [string, string][] {
  return [
    ['Company', l.company ?? ''],
    ['Type', l.partner_type ?? ''],
    ['Territory', l.region ?? ''],
    ['Portfolio', l.portfolio_size ?? ''],
    ['Wants a call', l.wants_call ? 'Yes' : 'No'],
  ]
}

export const dashLink = (leadId: string) => `${APP}/partners?lead=${encodeURIComponent(leadId)}`
export const actionLink = (token: string) => `${APP}/lead-action?t=${encodeURIComponent(token)}`

export async function createTokens(rows: { lead_id: string; action: 'assign' | 'status'; value: string; recipient_email: string }[]) {
  if (!rows.length) return [] as { token: string; value: string }[]
  const { data, error } = await admin.from('partner_lead_tokens').insert(rows).select('token,value')
  if (error) throw error
  return data as { token: string; value: string }[]
}

// Email to the people who receive new leads, with one "Assign to …" button per assignable teammate.
// deno-lint-ignore no-explicit-any
export async function sendAssignEmail(s: Settings, team: Member[], lead: any, kind: 'new' | 'reminder') {
  const dispatchers = team.filter((m) => m.receives_new_leads)
  if (!dispatchers.length) return { ok: false, error: 'nobody is set to receive new leads' }
  const assignees = team.filter((m) => m.assignable)
  const tokens = await createTokens(
    assignees.map((a) => ({ lead_id: lead.id, action: 'assign' as const, value: a.email, recipient_email: dispatchers[0].email })),
  )
  const byEmail = new Map(tokens.map((t) => [t.value, t.token]))
  const buttons = assignees.map((a) => button(actionLink(byEmail.get(a.email)!), a.name || a.email)).join('')
  const intro =
    kind === 'new'
      ? `<p style="font-size:15px;line-height:1.5;margin:0 0 16px">A new partner application just came in. Choose who should follow up — one click, no login.</p>`
      : `<p style="font-size:15px;line-height:1.5;margin:0 0 16px"><strong>Reminder:</strong> this partner lead has been waiting ${s.reminder_hours}+ hours without an owner. Choose who should follow up.</p>`
  const html = shell(
    kind === 'new' ? `New partner lead: ${lead.full_name}${lead.company ? ` (${lead.company})` : ''}` : `Still unassigned: ${lead.full_name}`,
    `${intro}<p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#7A7A7A">ASSIGN TO</p><div style="margin:0 0 20px">${buttons || '<span style="font-size:14px;color:#7A7A7A">Nobody can be given leads yet — open the lead in the Super App.</span>'}</div>${leadTable(lead)}<div style="margin-top:20px">${button(dashLink(lead.id), 'Open in the Super App', true)}</div>`,
  )
  const subject =
    kind === 'new'
      ? `New partner lead: ${lead.full_name}${lead.company ? ` (${lead.company})` : ''} — assign it`
      : `Reminder: unassigned partner lead — ${lead.full_name}${lead.company ? ` (${lead.company})` : ''}`
  return sendEmail(s, { to: dispatchers.map((d) => d.email), cc: s.cc_emails, subject, html })
}

export const STATUS_LABEL: Record<string, string> = { contacted: 'Contacted', qualified: 'Qualified', proposal: 'Proposal sent', won: 'Won', lost: 'Lost' }

// The new owner of a lead gets the details plus one-click status buttons, and Teams gets a card.
// Used by the e-mail "Assign to …" buttons (partner-lead-action) and by assignments made in the
// Innowi Super App (partner-lead-assigned). Records an `assignee_notified` event so the same
// assignment is never announced twice.
// deno-lint-ignore no-explicit-any
export async function notifyAssignee(s: Settings, team: Member[], lead: any, assignee: string, assignedBy: string | null) {
  const name = (email: string) => team.find((m) => m.email === email)?.name || email
  const statuses = ['contacted', 'qualified', 'won', 'lost']
  const toks = await createTokens(statuses.map((v) => ({ lead_id: lead.id, action: 'status' as const, value: v, recipient_email: assignee })))
  const btns = toks.map((t) => button(actionLink(t.token), STATUS_LABEL[t.value])).join('')
  const by = assignedBy ? name(assignedBy) : 'The Innowi team'
  const cc = assignedBy && assignedBy !== assignee && /@/.test(assignedBy) ? [assignedBy] : []
  const mail = await sendEmail(s, {
    to: [assignee],
    cc,
    subject: `Partner lead assigned to you: ${lead.full_name}${lead.company ? ` (${lead.company})` : ''}`,
    html: shell(
      `${by} assigned you a partner lead`,
      `<p style="font-size:15px;line-height:1.5;margin:0 0 16px">Please reach out to <strong>${esc(lead.full_name)}</strong>${lead.wants_call ? ' — they asked for a discovery call' : ''}. Update the status with one click as you go.</p>
       <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#7A7A7A">UPDATE STATUS</p><div style="margin:0 0 20px">${btns}</div>
       ${leadTable(lead)}<div style="margin-top:20px">${button(`mailto:${lead.email}?subject=${encodeURIComponent('Innowi partner program')}`, `Email ${String(lead.full_name).split(' ')[0]}`, true)} ${button(dashLink(lead.id), 'Open in the Super App')}</div>`,
    ),
  })
  const teams = await postTeams(s, {
    title: `👤 ${lead.full_name} assigned to ${name(assignee)}`,
    text: `by ${by}`,
    facts: leadFacts(lead),
    url: dashLink(lead.id),
    urlLabel: 'Open lead',
  })
  await admin.from('partner_lead_events').insert({ lead_id: lead.id, actor_email: null, type: 'assignee_notified', detail: { to: assignee, email: mail.ok, teams: teams.ok } })
  return { mail, teams }
}
