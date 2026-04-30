import { useState, useCallback } from 'react'
import { useStore } from '../store'
import { useDialog } from '../hooks/useDialog'
import { uid } from '../utils'
import type { Application, FilterView, EmailRecord, MailProvider } from '../types'
import { STATUSES } from '../types'

function isConnected(mail: { token: string; expires_at: number }) {
  return !!(mail.token && mail.expires_at > Date.now() + 30_000)
}

function ProviderIcon({ provider, synced }: { provider: MailProvider; synced: boolean }) {
  return provider === 'gmail'
    ? <span className={`provider-icon gmail-icon ${synced ? '' : 'provider-icon-dim'}`} title={synced ? 'Synced via Gmail' : 'Will use Gmail'}>G</span>
    : <span className={`provider-icon outlook-icon ${synced ? '' : 'provider-icon-dim'}`} title={synced ? 'Synced via Outlook' : 'Will use Outlook'}>O</span>
}

const AI_SYSTEM_PROMPT = `You are analyzing email threads related to a job application. Based on the emails provided, determine the current hiring stage and write a short comment (1-2 sentences).

Respond with ONLY valid JSON in this exact format:
{"status":"draft|applied|replied|interview|offer|rejected|ghosted","comment":"your comment here"}`

// ── helpers ──────────────────────────────────────────────────────────────────

function matchesView(app: Application, view: FilterView) {
  if (app.view_id === view.id) return true
  const roleKw = (view.role_keywords || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const companyKw = (view.company_keywords || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const statuses = view.statuses || []
  if (!roleKw.length && !companyKw.length && !statuses.length) return false
  const role = (app.role || '').toLowerCase()
  const company = (app.company || '').toLowerCase()
  if (roleKw.length && !roleKw.some(k => role.includes(k))) return false
  if (companyKw.length && !companyKw.some(k => company.includes(k))) return false
  if (statuses.length && !statuses.includes(app.status)) return false
  return true
}

function classifyMessage(subject: string, snippet: string, direction: string) {
  const text = `${subject} ${snippet}`.toLowerCase()
  if (/\b(offer|pleased to offer|employment agreement|job offer)\b/.test(text)) return 'offer'
  if (/\b(unfortunately|not moving forward|not proceeding|regret to inform|other candidates|decided not to)\b/.test(text)) return 'rejection'
  if (/\b(interview|schedule a|availability|calendly|phone screen|chat with|meet with|zoom|google meet)\b/.test(text)) return 'interview'
  return direction === 'outgoing' ? 'outgoing' : 'incoming'
}

function suggestStatus(emails: EmailRecord[]) {
  if (!emails.length) return null
  const kinds = emails.map(e => e.classification)
  if (kinds.includes('offer')) return 'offer'
  if (kinds.includes('rejection')) return 'rejected'
  if (kinds.includes('interview')) return 'interview'
  if (emails.some(e => e.direction === 'incoming')) return 'replied'
  return null
}

async function fetchEmailsForApp(
  app: Application,
  provider: MailProvider,
  token: string,
  gmailEmail: string,
  outlookEmail: string,
): Promise<EmailRecord[]> {
  const messages: EmailRecord[] = []
  const seenIds = new Set<string>()
  const threadIds = app.thread_ids || []
  if (provider === 'gmail') {
    for (const threadId of threadIds) {
      const tr = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!tr.ok) continue
      const thread = await tr.json() as { messages?: { id: string; threadId: string; internalDate: string; snippet: string; labelIds?: string[]; payload?: { headers?: { name: string; value: string }[] } }[] }
      for (const msg of thread.messages || []) {
        if (seenIds.has(msg.id)) continue; seenIds.add(msg.id)
        const h: Record<string, string> = {}
        ;(msg.payload?.headers || []).forEach(x => { h[x.name.toLowerCase()] = x.value })
        const from = h['from'] || ''
        const direction: 'outgoing' | 'incoming' =
          (msg.labelIds || []).includes('SENT') || (gmailEmail && from.toLowerCase().includes(gmailEmail.toLowerCase()))
            ? 'outgoing' : 'incoming'
        messages.push({ id: msg.id, threadId: msg.threadId, date: parseInt(msg.internalDate, 10) || 0, from, to: h['to'] || '', subject: h['subject'] || '(no subject)', snippet: msg.snippet || '', direction, classification: classifyMessage(h['subject'] || '', msg.snippet || '', direction) })
      }
    }
  } else {
    for (const conversationId of threadIds) {
      const params = new URLSearchParams({ '$filter': `conversationId eq '${conversationId}'`, '$select': 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,conversationId', '$orderby': 'receivedDateTime asc' })
      const r = await fetch(`https://graph.microsoft.com/v1.0/me/messages?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) continue
      const data = await r.json() as { value?: { id: string; subject: string; from: { emailAddress: { address: string } }; toRecipients: { emailAddress: { address: string } }[]; receivedDateTime: string; bodyPreview: string; conversationId: string }[] }
      for (const m of data.value || []) {
        if (seenIds.has(m.id)) continue; seenIds.add(m.id)
        const from = m.from?.emailAddress?.address || ''
        const direction = !outlookEmail ? 'unknown' as const : from.toLowerCase() === outlookEmail.toLowerCase() ? 'outgoing' as const : 'incoming' as const
        messages.push({ id: m.id, threadId: m.conversationId, date: new Date(m.receivedDateTime).getTime(), from, to: m.toRecipients?.[0]?.emailAddress?.address || '', subject: m.subject || '(no subject)', snippet: m.bodyPreview || '', direction, classification: classifyMessage(m.subject || '', m.bodyPreview || '', direction) })
      }
    }
  }
  messages.sort((a, b) => a.date - b.date)
  return messages
}

// ── AppDialog ────────────────────────────────────────────────────────────────

interface AppDialogProps {
  open: boolean
  initial: Partial<Application> | null
  views: FilterView[]
  onClose: () => void
  onSave: (data: Record<string, string>) => void
}

function AppDialog({ open, initial, views, onClose, onSave }: AppDialogProps) {
  const ref = useDialog(open, onClose)
  const isEdit = !!initial?.id

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    onSave(data)
  }

  return (
    <dialog ref={ref}>
      <form onSubmit={handleSubmit}>
        <h3>{isEdit ? 'Edit application' : 'New application'}</h3>
        <input type="hidden" name="id" defaultValue={initial?.id ?? ''} key={initial?.id} />
        <input type="hidden" name="source_job_id" defaultValue={initial?.source_job_id ?? ''} />
        <label>Company<input name="company" required defaultValue={initial?.company ?? ''} key={`co-${initial?.id}`} /></label>
        <label>Role<input name="role" required defaultValue={initial?.role ?? ''} key={`ro-${initial?.id}`} /></label>
        <label>Status
          <select name="status" defaultValue={initial?.status ?? 'draft'} key={`st-${initial?.id}`}>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        {views.length > 0 && (
          <label>Intention
            <select name="view_id" defaultValue={initial?.view_id ?? ''} key={`vi-${initial?.id}`} style={{ width: 'auto' }}>
              <option value="">— None —</option>
              {views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
        )}
        <label>Date applied<input type="date" name="applied_at" defaultValue={initial?.applied_at ?? new Date().toISOString().slice(0, 10)} key={`ap-${initial?.id}`} /></label>
        <label>Last contact<input type="date" name="last_contact_at" defaultValue={initial?.last_contact_at ?? ''} key={`lc-${initial?.id}`} /></label>
        <label>Contact name<input name="contact_name" defaultValue={initial?.contact_name ?? ''} key={`cn-${initial?.id}`} /></label>
        <label>Contact email<input type="email" name="contact_email" defaultValue={initial?.contact_email ?? ''} key={`ce-${initial?.id}`} /></label>
        <label>Job link<input type="url" name="link" placeholder="https://…" defaultValue={initial?.link ?? ''} key={`li-${initial?.id}`} /></label>
        <label>Notes<textarea name="notes" rows={4} defaultValue={initial?.notes ?? ''} key={`no-${initial?.id}`} /></label>
        <menu>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </menu>
      </form>
    </dialog>
  )
}

// ── ViewDialog ───────────────────────────────────────────────────────────────

interface ViewDialogProps {
  open: boolean
  initial: FilterView | null
  onClose: () => void
  onSave: (v: FilterView) => void
  onDelete: (id: string) => void
}

function ViewDialog({ open, initial, onClose, onSave, onDelete }: ViewDialogProps) {
  const ref = useDialog(open, onClose)
  const isEdit = !!initial

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const statuses = Array.from(form.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')).map(i => i.value)
    onSave({
      id: (form.elements.namedItem('id') as HTMLInputElement).value || uid('view'),
      name: (form.elements.namedItem('name') as HTMLInputElement).value.trim(),
      role_keywords: (form.elements.namedItem('role_keywords') as HTMLInputElement).value.trim(),
      company_keywords: (form.elements.namedItem('company_keywords') as HTMLInputElement).value.trim(),
      statuses,
    })
  }

  const picked = new Set(initial?.statuses ?? [])

  return (
    <dialog ref={ref}>
      <form onSubmit={handleSubmit}>
        <h3>{isEdit ? 'Edit intention' : 'New intention'}</h3>
        <input type="hidden" name="id" defaultValue={initial?.id ?? ''} key={initial?.id} />
        <label>Name<input name="name" required placeholder="Summer jobs" defaultValue={initial?.name ?? ''} key={`vn-${initial?.id}`} /></label>
        <label>Role keywords <span className="text-lo font-normal text-xs">(comma-separated, auto-matches applications)</span>
          <input name="role_keywords" placeholder="summer, intern" defaultValue={initial?.role_keywords ?? ''} key={`rk-${initial?.id}`} />
        </label>
        <label>Company keywords <span className="text-lo font-normal text-xs">(comma-separated)</span>
          <input name="company_keywords" placeholder="spotify, klarna" defaultValue={initial?.company_keywords ?? ''} key={`ck-${initial?.id}`} />
        </label>
        <label>Statuses <span className="text-lo font-normal text-xs">(leave all unchecked for any)</span>
          <div className="flex flex-col gap-1 bg-canvas border border-edge rounded-lg p-2 max-h-[120px] overflow-y-auto">
            {STATUSES.map(s => (
              <label key={s.value} className="flex-row items-center gap-1.5 text-hi">
                <input type="checkbox" value={s.value} defaultChecked={picked.has(s.value)} style={{ width: 'auto' }} />
                {s.label}
              </label>
            ))}
          </div>
        </label>
        <menu>
          {isEdit && <button type="button" className="ghost" onClick={() => onDelete(initial!.id)}>Delete intention</button>}
          <div style={{ flex: 1 }} />
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </menu>
      </form>
    </dialog>
  )
}

// ── ComposeDialog ─────────────────────────────────────────────────────────────

interface ComposeDialogProps {
  open: boolean
  app: Application | null
  onClose: () => void
  onSent: (appId: string, provider: MailProvider, threadId?: string) => void
}

function ComposeDialog({ open, app, onClose, onSent }: ComposeDialogProps) {
  const { state, toast } = useStore()
  const ref = useDialog(open, onClose)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [provider, setProvider] = useState<MailProvider>(app?.sync_provider ?? 'gmail')

  const gmailOk   = isConnected(state.mail.gmail)
  const outlookOk = isConnected(state.mail.outlook)
  const mailState = provider === 'gmail' ? state.mail.gmail : state.mail.outlook
  const connected = provider === 'gmail' ? gmailOk : outlookOk

  function selectedFileNames() {
    return selectedFiles.map(id => state.files.find(f => f.id === id)?.filename).filter(Boolean) as string[]
  }

  function applyTemplate(tplId: string) {
    const tpl = state.templates.find(t => t.id === tplId)
    if (!tpl) { setSubject(''); setBody(''); return }
    const filesText = selectedFileNames().join(', ') || '(none)'
    const vars: Record<string, string> = {
      company: app?.company ?? '', role: app?.role ?? '',
      contact_name: app?.contact_name || 'there',
      my_name: state.settings.name ?? '', files: filesText,
    }
    const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`)
    setSubject(fill(tpl.subject))
    setBody(fill(tpl.body))
  }

  async function sendViaAPI() {
    const to = app?.contact_email ?? ''
    if (!to) { toast('No contact email set', 'error'); return }
    if (!connected) { toast(`Connect ${provider === 'outlook' ? 'Outlook' : 'Gmail'} in Data settings first`, 'error'); return }
    setSending(true)
    try {
      const token = mailState.token
      if (provider === 'gmail') {
        const from = mailState.user_email ? `${state.settings.name} <${mailState.user_email}>` : mailState.user_email
        const raw = [
          `From: ${from}`, `To: ${to}`, `Subject: ${subject}`,
          'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', body,
        ].join('\r\n')
        const bytes = new TextEncoder().encode(raw)
        let bin = ''
        bytes.forEach(b => { bin += String.fromCharCode(b) })
        const encoded = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: encoded }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
          throw new Error(err.error?.message || `Gmail ${res.status}`)
        }
        const sent = await res.json() as { threadId?: string }
        if (app && sent.threadId) onSent(app.id, provider, sent.threadId)
        else if (app) onSent(app.id, provider)
      } else {
        const draftRes = await fetch('https://graph.microsoft.com/v1.0/me/messages', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject,
            body: { contentType: 'Text', content: body },
            toRecipients: [{ emailAddress: { address: to } }],
          }),
        })
        if (!draftRes.ok) {
          const err = await draftRes.json().catch(() => ({})) as { error?: { message?: string } }
          throw new Error(err.error?.message || `Graph ${draftRes.status}`)
        }
        const draft = await draftRes.json() as { id?: string; conversationId?: string }
        if (draft.id) {
          const sendRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` },
          })
          if (!sendRes.ok && sendRes.status !== 202) {
            const err = await sendRes.json().catch(() => ({})) as { error?: { message?: string } }
            throw new Error(err.error?.message || `Graph ${sendRes.status}`)
          }
        }
        if (app) onSent(app.id, provider, draft.conversationId)
      }
      onClose()
      toast(`Sent via ${provider === 'outlook' ? 'Outlook' : 'Gmail'}`, 'success')
    } catch (e) {
      toast(`Send failed: ${(e as Error).message}`, 'error')
    } finally {
      setSending(false)
    }
  }

  async function copyBody() {
    try { await navigator.clipboard.writeText(body); toast('Body copied', 'success') }
    catch { toast('Copy failed', 'error') }
  }

  return (
    <dialog ref={ref}>
      <form onSubmit={e => { e.preventDefault(); sendViaAPI() }}>
        <h3>Compose email</h3>
        {!connected && (
          <div className="text-lo text-[13px] m-0 mb-4" style={{ marginBottom: 8, color: 'var(--warning, #f59e0b)' }}>
            No email account connected — go to Data to connect Gmail or Outlook first.
          </div>
        )}
        <label>Template
          <select onChange={e => applyTemplate(e.target.value)}>
            <option value="">— blank —</option>
            {state.templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>Files to reference
          <div className="flex flex-col gap-1 bg-canvas border border-edge rounded-lg p-2 max-h-[120px] overflow-y-auto">
            {state.files.length === 0
              ? <span className="text-lo font-normal text-xs">No files registered. Add them in the Files tab.</span>
              : state.files.map(f => (
                <label key={f.id} className="flex-row items-center gap-1.5 text-hi">
                  <input type="checkbox" checked={selectedFiles.includes(f.id)} style={{ width: 'auto' }}
                    onChange={e => setSelectedFiles(prev => e.target.checked ? [...prev, f.id] : prev.filter(x => x !== f.id))} />
                  {f.label} <span className="text-lo font-normal text-xs">({f.filename})</span>
                </label>
              ))}
          </div>
        </label>
        {(gmailOk || outlookOk) && (
          <label>Send via
            <select value={provider} style={{ width: 'auto' }} onChange={e => setProvider(e.target.value as MailProvider)}>
              {gmailOk   && <option value="gmail">Gmail ({state.mail.gmail.user_email})</option>}
              {outlookOk && <option value="outlook">Outlook ({state.mail.outlook.user_email})</option>}
            </select>
          </label>
        )}
        <label>From<input readOnly value={mailState.user_email || (connected ? '…' : 'Not connected')} /></label>
        <label>To<input type="email" value={app?.contact_email ?? ''} readOnly /></label>
        <label>Subject<input required value={subject} onChange={e => setSubject(e.target.value)} /></label>
        <label>Body<textarea rows={12} required value={body} onChange={e => setBody(e.target.value)} /></label>
        <menu>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="ghost" onClick={copyBody}>Copy body</button>
          <button type="submit" className="primary" disabled={sending || !connected}>
            {sending ? 'Sending…' : `Send via ${provider === 'outlook' ? 'Outlook' : 'Gmail'}`}
          </button>
        </menu>
      </form>
    </dialog>
  )
}

// ── EmailsDialog ──────────────────────────────────────────────────────────────

interface EmailsDialogProps {
  open: boolean
  app: Application | null
  onClose: () => void
}

function EmailsDialog({ open, app, onClose }: EmailsDialogProps) {
  const { state, update, toast } = useStore()
  const ref = useDialog(open, onClose)
  const [syncing, setSyncing] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiResult, setAiResult] = useState<{ status: string; comment: string } | null>(null)

  const emails: EmailRecord[] = app ? (state.emails[app.id] || []) : []
  const suggested = suggestStatus(emails)

  const provider: MailProvider = app?.sync_provider ?? state.settings.active_mail_provider
  const mailState = provider === 'gmail' ? state.mail.gmail : state.mail.outlook

  async function syncEmails() {
    if (!app) return
    const threadIds = app.thread_ids || []
    if (!threadIds.length) { toast('No threads to sync — send an email via Compose first to start tracking this conversation', 'error'); return }
    if (!isConnected(mailState)) { toast(`Connect ${provider === 'outlook' ? 'Outlook' : 'Gmail'} in Data settings first`, 'error'); return }
    setSyncing(true)
    try {
      const messages = await fetchEmailsForApp(app, provider, mailState.token, state.mail.gmail.user_email, state.mail.outlook.user_email)
      update(s => {
        s.emails[app.id] = messages
        const a = s.applications.find(x => x.id === app.id)
        if (a) a.sync_provider = provider
      })
      toast(messages.length
        ? `Synced ${messages.length} email${messages.length !== 1 ? 's' : ''} across ${threadIds.length} thread${threadIds.length !== 1 ? 's' : ''}`
        : 'No replies yet in your tracked threads', messages.length ? 'success' : undefined)
    } catch (e) { toast((e as Error).message, 'error') }
    finally { setSyncing(false) }
  }

  async function analyzeWithAI() {
    if (!emails.length) { toast('Sync emails first', 'error'); return }
    if (!state.settings.openrouter_key) { toast('Add an OpenRouter API key in Data settings', 'error'); return }
    if (!state.settings.openrouter_model) { toast('Pick a model in Data settings', 'error'); return }
    setAnalyzing(true)
    try {
      const emailText = emails.map(e => `[${new Date(e.date).toLocaleDateString()}] ${e.direction === 'outgoing' ? 'Sent' : 'Received'} — ${e.subject}\n${e.snippet}`).join('\n\n')
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${state.settings.openrouter_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: state.settings.openrouter_model,
          messages: [
            { role: 'system', content: AI_SYSTEM_PROMPT },
            { role: 'user', content: `Application: ${app?.role} at ${app?.company}\n\nEmails:\n${emailText}` },
          ],
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
        throw new Error(err.error?.message || `OpenRouter ${res.status}`)
      }
      const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
      if (data.error?.message) throw new Error(data.error.message)
      const raw = data.choices?.[0]?.message?.content || ''
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}') as { status?: string; comment?: string }
      if (!parsed.status) throw new Error(`unexpected AI response: ${raw.slice(0, 120)}`)
      setAiResult({ status: parsed.status, comment: parsed.comment || '' })
    } catch (e) { toast(`AI error: ${(e as Error).message}`, 'error') }
    finally { setAnalyzing(false) }
  }

  function applyStatus(status: string) {
    if (!app) return
    update(s => {
      const a = s.applications.find(x => x.id === app.id)
      if (!a) return
      a.status = status as Application['status']
      const last = emails[emails.length - 1]
      if (last) a.last_contact_at = new Date(last.date).toISOString().slice(0, 10)
    })
    const label = STATUSES.find(s => s.value === status)?.label ?? status
    toast(`Status → ${label}`, 'success')
    setAiResult(null)
    onClose()
  }

  const providerLabel = provider === 'outlook' ? 'Outlook' : 'Gmail'

  return (
    <dialog ref={ref} style={{ maxWidth: '720px' }}>
      <div className="p-5 flex flex-col gap-3 min-w-[560px] max-w-[720px]">
        <div className="flex justify-between items-center gap-3">
          <h3 className="m-0 text-base font-semibold">{app ? `${app.company} — ${app.role}` : 'Email history'}</h3>
          <div className="flex gap-1.5">
            <button className="primary" onClick={syncEmails} disabled={syncing}>
              {syncing ? 'Syncing…' : `Sync from ${providerLabel}`}
            </button>
            {emails.length > 0 && (
              <button onClick={analyzeWithAI} disabled={analyzing}>
                {analyzing ? 'Analyzing…' : '✦ AI analyze'}
              </button>
            )}
            <button className="ghost" onClick={onClose}>Close</button>
          </div>
        </div>
        <div className="text-lo text-xs">
          {(app?.thread_ids?.length ?? 0) > 0
            ? `Tracking ${app!.thread_ids.length} thread${app!.thread_ids.length !== 1 ? 's' : ''} via ${providerLabel}`
            : 'No threads tracked yet — send an email via Compose to start tracking replies.'}
        </div>
        {aiResult && (
          <div className="suggestion">
            <div>
              <strong>AI:</strong> {aiResult.comment}
              {' · '}Suggested status: <strong>{STATUSES.find(s => s.value === aiResult.status)?.label ?? aiResult.status}</strong>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => applyStatus(aiResult.status)}>Apply</button>
              <button className="ghost" onClick={() => setAiResult(null)}>Dismiss</button>
            </div>
          </div>
        )}
        {!aiResult && suggested && suggested !== app?.status && (
          <div className="suggestion">
            <span>Email activity suggests status: <strong>{STATUSES.find(s => s.value === suggested)?.label}</strong></span>
            <button onClick={() => applyStatus(suggested)}>Apply</button>
          </div>
        )}
        <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto">
          {emails.length === 0
            ? <p className="text-center text-lo p-10 bg-surface rounded-lg border border-dashed border-edge">No emails synced yet.</p>
            : emails.map((e, i) => {
              const isOut = e.direction === 'outgoing'
              return (
                <div key={e.id} className={`email-item ${e.direction} ${e.classification}`}>
                  <div className="flex justify-between items-center gap-2 text-xs text-lo mb-1.5">
                    <span className="flex items-center gap-[5px] text-xs font-medium">
                      {isOut
                        ? <><span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[11px] font-bold shrink-0 bg-hi/10 text-lo">↑</span> You → {e.to}</>
                        : <><span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[11px] font-bold shrink-0 bg-warn/25 text-warn">↓</span> {e.from}</>}
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      {e.classification !== 'outgoing' && e.classification !== 'incoming' && (
                        <span className="inline-block px-2 py-[2px] rounded-full text-[11px] bg-raised text-lo">{e.classification}</span>
                      )}
                      <span>{new Date(e.date).toLocaleString()}</span>
                    </span>
                  </div>
                  <div className="font-semibold text-hi text-[13px] mb-1">{e.subject}</div>
                  <div className="text-xs text-lo leading-relaxed">{e.snippet.replace(/&#39;/g, "'").replace(/&amp;/g, '&')}</div>
                  {i < emails.length - 1 && <div className="absolute left-5 bottom-[-10px] w-[2px] h-[10px] bg-edge" />}
                </div>
              )
            })
          }
        </div>
      </div>
    </dialog>
  )
}

// ── Applications (main) ───────────────────────────────────────────────────────

export default function Applications() {
  const { state, update, toast } = useStore()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [sortCol, setSortCol] = useState<'company' | 'role' | 'status' | 'applied_at' | 'last_contact_at' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [multiSelect, setMultiSelect] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkSyncing, setBulkSyncing] = useState(false)

  function exitMultiSelect() { setMultiSelect(false); setSelected(new Set()) }

  const [appOpen, setAppOpen] = useState(false)
  const [editingApp, setEditingApp] = useState<Partial<Application> | null>(null)

  const [viewOpen, setViewOpen] = useState(false)
  const [editingView, setEditingView] = useState<FilterView | null>(null)

  const [composeOpen, setComposeOpen] = useState(false)
  const [composeApp, setComposeApp] = useState<Application | null>(null)

  const [emailsOpen, setEmailsOpen] = useState(false)
  const [emailsApp, setEmailsApp] = useState<Application | null>(null)

  function openAppDialog(initial: Partial<Application> | null = null) {
    const base = initial ?? {}
    if (!initial && state.active_view_id && !base.view_id) {
      setEditingApp({ ...base, view_id: state.active_view_id })
    } else {
      setEditingApp(initial)
    }
    setAppOpen(true)
  }

  const closeApp = useCallback(() => setAppOpen(false), [])

  function toggleSort(col: typeof sortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function toggleSelectAll(ids: string[]) {
    setSelected(prev => {
      const allSelected = ids.length > 0 && ids.every(id => prev.has(id))
      if (allSelected) {
        const n = new Set(prev); ids.forEach(id => n.delete(id)); return n
      }
      const n = new Set(prev); ids.forEach(id => n.add(id)); return n
    })
  }

  function bulkDelete() {
    const n = selected.size
    if (!confirm(`Delete ${n} application${n !== 1 ? 's' : ''}?`)) return
    update(s => { s.applications = s.applications.filter(a => !selected.has(a.id)) })
    exitMultiSelect()
    toast(`Deleted ${n} application${n !== 1 ? 's' : ''}`)
  }

  async function bulkSync() {
    const toSync = state.applications.filter(a => selected.has(a.id) && (a.thread_ids || []).length > 0)
    if (!toSync.length) { toast('No selected applications have tracked email threads', 'error'); return }
    setBulkSyncing(true)
    let done = 0
    try {
      await Promise.all(toSync.map(async app => {
        const prov: MailProvider = app.sync_provider ?? state.settings.active_mail_provider
        const ms = prov === 'gmail' ? state.mail.gmail : state.mail.outlook
        if (!isConnected(ms)) return
        const messages = await fetchEmailsForApp(app, prov, ms.token, state.mail.gmail.user_email, state.mail.outlook.user_email)
        update(s => {
          s.emails[app.id] = messages
          const a = s.applications.find(x => x.id === app.id)
          if (a) a.sync_provider = prov
        })
        done++
      }))
      toast(`Synced emails for ${done} application${done !== 1 ? 's' : ''}`, 'success')
      exitMultiSelect()
    } catch (e) { toast((e as Error).message, 'error') }
    finally { setBulkSyncing(false) }
  }

  function saveApp(data: Record<string, string>) {
    if ('view_id' in data && !data.view_id) delete data.view_id
    update(s => {
      if (data.id) {
        const idx = s.applications.findIndex(a => a.id === data.id)
        if (idx >= 0) {
          const updated = { ...s.applications[idx], ...data } as Application
          if (!data.view_id) delete updated.view_id
          s.applications[idx] = updated
        }
      } else {
        const newApp = { ...data, id: uid('app'), thread_ids: [] as string[], created_at: new Date().toISOString() } as unknown as Application
        s.applications.unshift(newApp)
        const jobId = data.source_job_id
        if (jobId && !s.imported_job_ids.includes(jobId)) s.imported_job_ids.push(jobId)
      }
    })
    setAppOpen(false)
    toast('Application saved', 'success')
  }

  function deleteApp(id: string) {
    const app = state.applications.find(a => a.id === id)
    if (!app || !confirm(`Delete ${app.company} — ${app.role}?`)) return
    update(s => { s.applications = s.applications.filter(a => a.id !== id) })
    toast('Deleted')
  }

  function saveView(v: FilterView) {
    update(s => {
      const idx = s.filter_views.findIndex(x => x.id === v.id)
      if (idx >= 0) s.filter_views[idx] = v
      else s.filter_views.push(v)
      s.active_view_id = v.id
    })
    setViewOpen(false)
    toast('Intention saved', 'success')
  }

  function deleteView(id: string) {
    const view = state.filter_views.find(v => v.id === id)
    if (!view || !confirm(`Delete intention "${view.name}"?`)) return
    update(s => {
      s.filter_views = s.filter_views.filter(v => v.id !== id)
      if (s.active_view_id === id) s.active_view_id = null
    })
    setViewOpen(false)
    toast('Intention deleted')
  }

  function setAppIntention(appId: string, viewId: string) {
    update(s => {
      const a = s.applications.find(x => x.id === appId)
      if (!a) return
      if (viewId) a.view_id = viewId
      else delete a.view_id
    })
  }

  function setActiveView(id: string | null) {
    update(s => { s.active_view_id = s.active_view_id === id ? null : id })
  }

  function onSent(appId: string, provider: MailProvider, threadId?: string) {
    update(s => {
      const a = s.applications.find(x => x.id === appId)
      if (!a) return
      a.last_contact_at = new Date().toISOString().slice(0, 10)
      if (a.status === 'draft') a.status = 'applied'
      if (!a.applied_at) a.applied_at = a.last_contact_at
      a.sync_provider = provider
      if (threadId && !a.thread_ids.includes(threadId)) a.thread_ids.push(threadId)
    })
  }

  const activeView = state.filter_views.find(v => v.id === state.active_view_id)
  let rows = activeView ? state.applications.filter(a => matchesView(a, activeView)) : state.applications
  if (search) rows = rows.filter(a => (a.company || '').toLowerCase().includes(search.toLowerCase()) || (a.role || '').toLowerCase().includes(search.toLowerCase()))
  if (statusFilter) rows = rows.filter(a => a.status === statusFilter)
  if (sortCol) {
    const STATUS_ORDER = STATUSES.map(s => s.value)
    rows = [...rows].sort((a, b) => {
      let av: string, bv: string
      if (sortCol === 'status') {
        av = String(STATUS_ORDER.indexOf(a.status))
        bv = String(STATUS_ORDER.indexOf(b.status))
      } else {
        av = (a[sortCol] || '').toLowerCase()
        bv = (b[sortCol] || '').toLowerCase()
      }
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
  }

  const counts: Record<string, number> = {}
  const scoped = activeView ? state.applications.filter(a => matchesView(a, activeView)) : state.applications
  scoped.forEach(a => { counts[a.status] = (counts[a.status] || 0) + 1 })

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <h2 className="m-0 text-base font-semibold">Applications</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <input type="search" placeholder="Search company or role…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button className="primary" onClick={() => openAppDialog()}>+ New</button>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-3 pb-3 border-b border-edge">
        <button className={`view-chip ${!state.active_view_id ? 'active' : ''}`} onClick={() => setActiveView(null)}>
          All <span className="view-count">{state.applications.length}</span>
        </button>
        {state.filter_views.map(v => (
          <span key={v.id} className={`view-chip ${state.active_view_id === v.id ? 'active' : ''}`} onClick={() => setActiveView(v.id)}>
            <span className="view-label">{v.name}</span>
            <span className="view-count">{state.applications.filter(a => matchesView(a, v)).length}</span>
            <button className="view-edit" onClick={e => { e.stopPropagation(); setEditingView(v); setViewOpen(true) }}>✎</button>
          </span>
        ))}
        <button className="view-chip add-view" onClick={() => { setEditingView(null); setViewOpen(true) }}>+ New intention</button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <span className="bg-surface border border-edge px-3 py-[6px] rounded-lg text-[13px]">Total<strong className="text-primary ml-1.5">{scoped.length}</strong></span>
        {STATUSES.map(s => <span key={s.value} className="bg-surface border border-edge px-3 py-[6px] rounded-lg text-[13px]">{s.label}<strong className="text-primary ml-1.5">{counts[s.value] || 0}</strong></span>)}
      </div>

      <div className="flex items-center justify-end gap-2 mb-1.5 min-h-[30px]">
        {!multiSelect
          ? <button className="ghost text-xs px-[10px] py-1 opacity-45 hover:opacity-100" onClick={() => setMultiSelect(true)}>☑ Select</button>
          : <>
              <span className="bulk-count text-[13px]">{selected.size > 0 ? `${selected.size} selected` : 'Select rows…'}</span>
              <button className="ghost text-xs px-[10px] py-1" disabled={rows.length === 0} onClick={() => toggleSelectAll(rows.map(r => r.id))}>
                {rows.length > 0 && rows.every(r => selected.has(r.id)) ? 'Deselect all' : 'Select all'}
              </button>
              <button className="text-xs px-[10px] py-1" onClick={bulkSync} disabled={bulkSyncing || selected.size === 0}>
                {bulkSyncing ? 'Syncing…' : `Sync${selected.size > 0 ? ` (${selected.size})` : ''}`}
              </button>
              <button className="danger text-xs px-[10px] py-1" disabled={selected.size === 0} onClick={bulkDelete}>
                {`Delete${selected.size > 0 ? ` (${selected.size})` : ''}`}
              </button>
              <button className="ghost text-xs px-[10px] py-1" onClick={exitMultiSelect}>Cancel</button>
            </>
        }
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-lo p-10 bg-surface rounded-lg border border-dashed border-edge" dangerouslySetInnerHTML={{ __html: state.applications.length === 0 ? 'No applications yet. Click <strong>+ New</strong> to add one.' : 'No applications match your filter.' }} />
      ) : (
        <table className="w-full border-collapse bg-surface rounded-lg overflow-hidden">
          <thead>
            <tr>
              {multiSelect && <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo" style={{ width: 32 }} />}
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo" style={{ width: 28 }}></th>
              {(['company', 'role', 'status', 'applied_at', 'last_contact_at'] as const).map(col => {
                const labels: Record<string, string> = { company: 'Company', role: 'Role', status: 'Status', applied_at: 'Applied', last_contact_at: 'Last contact' }
                const active = sortCol === col
                return (
                  <th key={col} className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo cursor-pointer select-none whitespace-nowrap" onClick={() => toggleSort(col)}>
                    {labels[col]}
                    <span className={`text-[11px] ${active ? (sortDir === 'asc' ? 'text-primary opacity-100' : 'text-primary opacity-100') : 'opacity-30'}`}>
                      {active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}
                    </span>
                  </th>
                )
              })}
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">Contact</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => {
              const statusMeta = STATUSES.find(s => s.value === a.status) ?? STATUSES[0]
              const emailCount = (state.emails[a.id] || []).length
              return (
                <tr key={a.id} className={`hover:[&>td]:bg-raised transition-colors ${selected.has(a.id) ? 'row-selected' : ''}`}>
                  {multiSelect && (
                    <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm text-center px-1">
                      <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggleSelect(a.id)} />
                    </td>
                  )}
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm text-center px-1">
                    <ProviderIcon
                      provider={a.sync_provider ?? state.settings.active_mail_provider}
                      synced={!!a.sync_provider}
                    />
                  </td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">
                    {a.company}
                    {state.filter_views.length > 0 && (
                      <select
                        className={`intention-select${a.view_id ? ' has-value' : ''}`}
                        value={a.view_id ?? ''}
                        onChange={e => setAppIntention(a.id, e.target.value)}
                        onClick={e => e.stopPropagation()}
                      >
                        <option value="">No intention</option>
                        {state.filter_views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{a.role}</td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm"><span className={`status-badge status-${a.status}`}>{statusMeta.label}</span></td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{a.applied_at || '—'}</td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{a.last_contact_at || '—'}</td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{a.contact_email ? <a href={`mailto:${a.contact_email}`}>{a.contact_email}</a> : '—'}</td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">
                    <div className="flex gap-1 items-center">
                      <button className="px-2 py-1 text-xs whitespace-nowrap" onClick={() => { setComposeApp(a); setComposeOpen(true) }}>Compose</button>
                      <button className="emails-btn px-2 py-1 text-xs whitespace-nowrap" onClick={() => { setEmailsApp(a); setEmailsOpen(true) }}>
                        Emails{emailCount ? ` (${emailCount})` : ''}
                      </button>
                      <button className="px-2 py-1 text-xs whitespace-nowrap" onClick={() => openAppDialog(a)}>Edit</button>
                      <button className="px-2 py-1 text-xs whitespace-nowrap" onClick={() => deleteApp(a.id)}>Delete</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <AppDialog open={appOpen} initial={editingApp} views={state.filter_views} onClose={closeApp} onSave={saveApp} />
      <ViewDialog open={viewOpen} initial={editingView} onClose={useCallback(() => setViewOpen(false), [])} onSave={saveView} onDelete={deleteView} />
      <ComposeDialog open={composeOpen} app={composeApp} onClose={useCallback(() => setComposeOpen(false), [])} onSent={onSent} />
      <EmailsDialog open={emailsOpen} app={emailsApp} onClose={useCallback(() => setEmailsOpen(false), [])} />
    </div>
  )
}
