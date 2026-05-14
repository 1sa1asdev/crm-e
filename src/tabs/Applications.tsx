import { useState, useCallback, useEffect } from 'react'
import { useStore } from '../store'
import { useLang } from '../hooks/useLang'
import { useDialog } from '../hooks/useDialog'
import { uid } from '../utils'
import { ensureToken } from '../auth'
import { linkVar } from './Templates'
import type { Application, FilterView, EmailRecord, MailProvider, FileRecord } from '../types'
import { STATUSES } from '../types'

const ATTACHABLE_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'text/plain',
])

function buildGmailRaw(from: string, to: string, subject: string, body: string, files: FileRecord[], inReplyTo?: string): string {
  const boundary = `crme_${Math.random().toString(36).slice(2)}`
  const chunkB64 = (b64: string) => b64.match(/.{1,76}/g)?.join('\r\n') ?? b64

  const lines: string[] = [
    `From: ${from}`, `To: ${to}`, `Subject: ${subject}`,
    'MIME-Version: 1.0',
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
  ]

  if (files.length === 0) {
    lines.push('Content-Type: text/plain; charset=utf-8', '', body)
  } else {
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, '',
      `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', '', body)
    for (const f of files) {
      const b64 = f.data_url.split(',')[1] ?? ''
      lines.push(
        `--${boundary}`,
        `Content-Type: ${f.type}; name="${f.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${f.filename}"`,
        '', chunkB64(b64),
      )
    }
    lines.push(`--${boundary}--`)
  }

  const raw = lines.join('\r\n')
  let bin = ''
  new TextEncoder().encode(raw).forEach(b => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

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

const AI_DRAFT_SYSTEM_PROMPT = `You are an expert job application email writer. Write a concise, professional email on behalf of the job applicant.

Respond with ONLY valid JSON in this exact format:
{"subject":"the email subject line","body":"the full plain-text email body"}

Guidelines:
- Write naturally — confident but not stiff
- Keep the body under 200 words
- Use the actual names provided, not generic placeholders
- Tailor the tone to the application stage described
- Do not add a sign-off line — the sender will add their signature separately
- Do not wrap the JSON in markdown code fences`

const AI_DEADLINE_PROMPT = `Extract the application deadline date from the text. Return ONLY a date string in YYYY-MM-DD format. If no deadline is mentioned, return null. Do not include any other text or explanation.`

// ── deadline extraction ───────────────────────────────────────────────────────

const SV_MONTHS: Record<string, string> = {
  januari: '01', februari: '02', mars: '03', april: '04',
  maj: '05', juni: '06', juli: '07', augusti: '08',
  september: '09', oktober: '10', november: '11', december: '12',
}
const EN_MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
}

function extractDeadlineFromText(text: string): string | null {
  if (!text) return null
  const t = text.toLowerCase()

  // ISO: 2026-05-31
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) return iso[0]

  // Swedish: "31 maj 2026" / "den 31 maj 2026"
  const svRe = /\b(\d{1,2})\s+(januari|februari|mars|april|maj|juni|juli|augusti|september|oktober|november|december),?\s+(\d{4})\b/i
  const sv = t.match(svRe)
  if (sv) return `${sv[3]}-${SV_MONTHS[sv[2]]}-${sv[1].padStart(2, '0')}`

  // English: "May 31, 2026" / "31st May 2026"
  const enRe1 = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i
  const en1 = t.match(enRe1)
  if (en1) return `${en1[3]}-${EN_MONTHS[en1[1].toLowerCase()]}-${en1[2].padStart(2, '0')}`

  const enRe2 = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december),?\s+(\d{4})\b/i
  const en2 = t.match(enRe2)
  if (en2) return `${en2[3]}-${EN_MONTHS[en2[2].toLowerCase()]}-${en2[1].padStart(2, '0')}`

  // Numeric: DD/MM/YYYY or DD.MM.YYYY
  const numRe = /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/
  const num = text.match(numRe)
  if (num) {
    const [, d, m, y] = num
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  return null
}

// ── helpers ───────────────────────────────────────────────────────────────────

function matchesView(app: Application, view: FilterView) {
  return app.view_id === view.id
}

function classifyMessage(subject: string, snippet: string, direction: string) {
  const text = `${subject} ${snippet}`.toLowerCase()
  if (/\b(offer|pleased to offer|employment agreement|job offer)\b/.test(text)) return 'offer'
  if (/\b(unfortunately|not moving forward|not proceeding|regret to inform|other candidates|decided not to|not go forward|not be moving|not been selected|position has been filled|gone with another|chosen another candidate)\b/.test(text)
    || /tyvärr|inte gå vidare|valt att inte|inte kommer att gå vidare|tackar nej|ej gå vidare|vi har valt|inte möjligt att|gå vidare med din/.test(text)) return 'rejection'
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

interface GmailPayload {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPayload[]
  headers?: { name: string; value: string }[]
}

function decodeBase64Utf8(b64url: string): string {
  try {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder('utf-8').decode(bytes)
  } catch { return '' }
}

function extractGmailBody(payload: GmailPayload): string {
  if (payload.body?.data) return decodeBase64Utf8(payload.body.data)
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain') { const t = extractGmailBody(part); if (t) return t }
    }
    for (const part of payload.parts) {
      const t = extractGmailBody(part); if (t) return t
    }
  }
  return ''
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
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}?format=full`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!tr.ok) continue
      const thread = await tr.json() as { messages?: { id: string; threadId: string; internalDate: string; snippet: string; labelIds?: string[]; payload?: GmailPayload }[] }
      for (const msg of thread.messages || []) {
        if (seenIds.has(msg.id)) continue; seenIds.add(msg.id)
        const h: Record<string, string> = {}
        ;(msg.payload?.headers || []).forEach(x => { h[x.name.toLowerCase()] = x.value })
        const from = h['from'] || ''
        const body = msg.payload ? extractGmailBody(msg.payload) : ''
        const direction: 'outgoing' | 'incoming' =
          (msg.labelIds || []).includes('SENT') || (gmailEmail && from.toLowerCase().includes(gmailEmail.toLowerCase()))
            ? 'outgoing' : 'incoming'
        const fullText = body || msg.snippet || ''
        messages.push({ id: msg.id, threadId: msg.threadId, messageId: h['message-id'] || undefined, date: parseInt(msg.internalDate, 10) || 0, from, to: h['to'] || '', subject: h['subject'] || '(no subject)', snippet: msg.snippet || '', body: body || undefined, direction, classification: classifyMessage(h['subject'] || '', fullText, direction) })
      }
    }
  } else {
    for (const conversationId of threadIds) {
      const params = new URLSearchParams({ '$filter': `conversationId eq '${conversationId}'`, '$select': 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,body,conversationId', '$orderby': 'receivedDateTime asc' })
      const r = await fetch(`https://graph.microsoft.com/v1.0/me/messages?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) continue
      const data = await r.json() as { value?: { id: string; subject: string; from: { emailAddress: { address: string } }; toRecipients: { emailAddress: { address: string } }[]; receivedDateTime: string; bodyPreview: string; body?: { content?: string; contentType?: string }; conversationId: string }[] }
      for (const m of data.value || []) {
        if (seenIds.has(m.id)) continue; seenIds.add(m.id)
        const from = m.from?.emailAddress?.address || ''
        const rawBody = m.body?.content || ''
        const body = !rawBody ? '' : m.body?.contentType === 'text'
          ? rawBody
          : new DOMParser().parseFromString(rawBody, 'text/html').body.textContent?.trim() ?? ''
        const direction = !outlookEmail ? 'unknown' as const : from.toLowerCase() === outlookEmail.toLowerCase() ? 'outgoing' as const : 'incoming' as const
        const fullText = body || m.bodyPreview || ''
        messages.push({ id: m.id, threadId: m.conversationId, date: new Date(m.receivedDateTime).getTime(), from, to: m.toRecipients?.[0]?.emailAddress?.address || '', subject: m.subject || '(no subject)', snippet: m.bodyPreview || '', body: body || undefined, direction, classification: classifyMessage(m.subject || '', fullText, direction) })
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
  const { t, statusLabel } = useLang()
  const isEdit = !!initial?.id

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const data = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>
    onSave(data)
  }

  return (
    <dialog ref={ref} style={{ maxWidth: 560, padding: 0, overflow: 'hidden' }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', padding: 0, gap: 0 }}>
        <input type="hidden" name="id" defaultValue={initial?.id ?? ''} key={initial?.id} />
        <input type="hidden" name="source_job_id" defaultValue={initial?.source_job_id ?? ''} />

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <span className="text-sm font-semibold text-hi">{isEdit ? t('appDlg.titleEdit') : t('appDlg.titleNew')}</span>
          <button type="button" className="ghost" style={{ padding: '2px 8px', fontSize: 13 }} onClick={onClose}>✕</button>
        </div>

        {/* Fields */}
        <div className="px-5 py-4 flex flex-col gap-3 overflow-y-auto" style={{ maxHeight: '70vh' }}>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-lo">{t('appDlg.company')}
              <input name="company" required defaultValue={initial?.company ?? ''} key={`co-${initial?.id}`} placeholder={t('appDlg.phCompany')} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-lo">{t('appDlg.role')}
              <input name="role" required defaultValue={initial?.role ?? ''} key={`ro-${initial?.id}`} placeholder={t('appDlg.phRole')} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-lo">{t('appDlg.status')}
              <select name="status" defaultValue={initial?.status ?? 'draft'} key={`st-${initial?.id}`}>
                {STATUSES.map(s => <option key={s.value} value={s.value}>{statusLabel(s.value)}</option>)}
              </select>
            </label>
            {views.length > 0 && (
              <label className="flex flex-col gap-1 text-xs text-lo">{t('appDlg.intent')}
                <select name="view_id" defaultValue={initial?.view_id ?? ''} key={`vi-${initial?.id}`}>
                  <option value="">{t('appDlg.noIntent')}</option>
                  {views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-lo">{t('appDlg.dateApplied')}
              <input type="date" name="applied_at" defaultValue={initial?.applied_at ?? new Date().toISOString().slice(0, 10)} key={`ap-${initial?.id}`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-lo">{t('appDlg.lastContact')}
              <input type="date" name="last_contact_at" defaultValue={initial?.last_contact_at ?? ''} key={`lc-${initial?.id}`} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-lo">{t('appDlg.deadline')}
              <input type="date" name="deadline" defaultValue={initial?.deadline ?? ''} key={`dl-${initial?.id}`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-lo">{t('appDlg.followUp')}
              <input type="date" name="follow_up_at" defaultValue={initial?.follow_up_at ?? ''} key={`fu-${initial?.id}`} />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-lo">{t('appDlg.contactName')}
              <input name="contact_name" defaultValue={initial?.contact_name ?? ''} key={`cn-${initial?.id}`} placeholder={t('appDlg.phContact')} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-lo">{t('appDlg.contactEmail')}
              <input type="email" name="contact_email" defaultValue={initial?.contact_email ?? ''} key={`ce-${initial?.id}`} placeholder={t('appDlg.phEmail')} />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs text-lo">{t('appDlg.jobLink')}
            <input type="url" name="link" placeholder="https://…" defaultValue={initial?.link ?? ''} key={`li-${initial?.id}`} />
          </label>

          <label className="flex flex-col gap-1 text-xs text-lo">{t('appDlg.notes')}
            <textarea name="notes" rows={4} defaultValue={initial?.notes ?? ''} key={`no-${initial?.id}`} placeholder={t('appDlg.phNotes')} />
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-edge bg-raised/30">
          <button type="button" className="ghost" onClick={onClose}>{t('appDlg.cancel')}</button>
          <button type="submit" className="primary">{t('appDlg.save')}</button>
        </div>
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
  const { t } = useLang()
  const isEdit = !!initial

  function val(form: HTMLFormElement, name: string) {
    return ((form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '').trim()
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    onSave({
      id:        val(form, 'id') || uid('view'),
      name:      val(form, 'name'),
      intention: val(form, 'intention') || undefined,
    })
  }

  return (
    <dialog ref={ref}>
      <form onSubmit={handleSubmit}>
        <h3>{isEdit ? t('view.edit') : t('view.new')}</h3>
        <input type="hidden" name="id" defaultValue={initial?.id ?? ''} key={initial?.id} />
        <label>{t('view.name')}<input name="name" required placeholder={t('view.phName')} defaultValue={initial?.name ?? ''} key={`vn-${initial?.id}`} /></label>
        {/* ── Intention ── */}
        <label className="flex flex-col gap-1 text-[13px] text-lo border-t border-edge pt-3 mt-1">
          <span className="text-sm font-medium text-hi">{t('view.intentionQ')}</span>
          <textarea
            name="intention"
            rows={4}
            placeholder={t('view.phIntention')}
            defaultValue={initial?.intention ?? ''}
            key={`int-${initial?.id}`}
            style={{ resize: 'vertical', fontSize: 13 }}
          />
        </label>
        <menu>
          {isEdit && <button type="button" className="ghost" onClick={() => onDelete(initial!.id)}>{t('view.delete')}</button>}
          <div style={{ flex: 1 }} />
          <button type="button" className="ghost" onClick={onClose}>{t('view.cancel')}</button>
          <button type="submit" className="primary">{t('view.save')}</button>
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
  onNavigateSettings: () => void
}

function ComposeDialog({ open, app, onClose, onSent, onNavigateSettings }: ComposeDialogProps) {
  const { state, update, toast } = useStore()
  const { t, statusLabel } = useLang()
  const ref = useDialog(open, onClose)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  // Pick the best initial provider: honour the app's sync_provider if connected,
  // otherwise fall back to the active account, then whichever is actually linked.
  const [provider, setProvider] = useState<MailProvider>(() => {
    const ap = state.settings.active_mail_provider ?? 'gmail'
    if (app?.sync_provider && isConnected(state.mail[app.sync_provider])) return app.sync_provider
    if (isConnected(state.mail[ap])) return ap
    if (isConnected(state.mail.gmail))   return 'gmail'
    if (isConnected(state.mail.outlook)) return 'outlook'
    return app?.sync_provider ?? ap
  })
  const [coverLetterId, setCoverLetterId] = useState('')
  const [coverLetterBody, setCoverLetterBody] = useState('')
  const [pdfAttachment, setPdfAttachment] = useState<FileRecord | null>(null)
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const [aiGenerating, setAiGenerating] = useState(false)

  const gmailOk   = isConnected(state.mail.gmail)
  const outlookOk = isConnected(state.mail.outlook)
  const mailState = provider === 'gmail' ? state.mail.gmail : state.mail.outlook
  const connected = provider === 'gmail' ? gmailOk : outlookOk

  // Auto-correct if the selected provider isn't connected but another one is
  // (handles token expiry or provider switch while the dialog is open)
  useEffect(() => {
    if (!connected) {
      if (provider === 'gmail'   && outlookOk) setProvider('outlook')
      if (provider === 'outlook' && gmailOk)   setProvider('gmail')
    }
  }, [gmailOk, outlookOk])
  const coverLetterTemplates = state.templates.filter(t => (t.type ?? 'email') === 'cover_letter')

  function buildVars(filesText: string): Record<string, string> {
    const linkVars = (state.settings.links ?? []).filter(l => l.label && l.url)
      .reduce((acc, l) => { acc[linkVar(l.label)] = l.url; return acc }, {} as Record<string, string>)
    const s = state.settings
    const fullName = [s.name, s.last_name].filter(Boolean).join(' ')
    const address  = [s.street, s.city, s.postal_code, s.country].filter(Boolean).join(', ')
    // Only include keys whose value is non-empty — otherwise the fill logic
    // leaves the {{placeholder}} visible so the user notices the missing field
    // instead of silently sending an empty space.
    const out: Record<string, string> = {
      company: app?.company ?? '', role: app?.role ?? '',
      contact_name: app?.contact_name || 'there',
      files: filesText,
      ...linkVars,
    }
    if (s.name)      out.my_name      = s.name
    if (s.last_name) out.my_last_name = s.last_name
    if (fullName)    out.my_full_name = fullName
    if (s.email || mailState.user_email) out.my_email = s.email || mailState.user_email
    if (s.phone)     out.my_phone     = s.phone
    if (address)     out.my_address   = address
    if (s.linkedin)  out.my_linkedin  = s.linkedin
    return out
  }

  function selectedFileNames() {
    return selectedFiles.map(id => state.files.find(f => f.id === id)?.filename).filter(Boolean) as string[]
  }

  function applyTemplate(tplId: string) {
    const tpl = state.templates.find(t => t.id === tplId)
    if (!tpl) { setSubject(''); setBody(''); return }
    const vars = buildVars(selectedFileNames().join(', ') || '(none)')
    const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`)
    setSubject(fill(tpl.subject))
    setBody(fill(tpl.body))
  }

  function applyCoverLetter(tplId: string) {
    setCoverLetterId(tplId)
    setPdfAttachment(null)
    if (!tplId) { setCoverLetterBody(''); return }
    const tpl = state.templates.find(t => t.id === tplId)
    if (!tpl) { setCoverLetterBody(''); return }
    const vars = buildVars(selectedFileNames().join(', ') || '(none)')
    const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`)
    setCoverLetterBody(fill(tpl.body))
  }

  async function generateCoverLetterPDF() {
    if (!coverLetterBody) return
    setGeneratingPdf(true)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const margin = 20
      const maxWidth = doc.internal.pageSize.getWidth() - margin * 2
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      const lines = doc.splitTextToSize(coverLetterBody, maxWidth)
      let y = margin + 5
      for (const line of lines) {
        if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin }
        doc.text(line, margin, y)
        y += 6
      }
      const dataUrl = doc.output('datauristring')
      const filename = `cover-letter-${(app?.company || 'application').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`
      setPdfAttachment({ id: 'cl-pdf', label: 'Cover letter', description: '', filename, data_url: dataUrl, size: Math.round((dataUrl.length - 28) * 0.75), type: 'application/pdf', uploaded_at: new Date().toISOString() })
      toast(t('compose.clPdfAttached'), 'success')
    } catch (e) {
      toast(`${t('compose.pdfError')} ${(e as Error).message}`, 'error')
    } finally {
      setGeneratingPdf(false)
    }
  }

  async function generateAIDraft(lang: 'en' | 'sv' = draftLang) {
    if (!state.settings.openrouter_key || !state.settings.openrouter_model) {
      toast(t('compose.aiNoKey'), 'error'); return
    }
    setAiGenerating(true)
    try {
      const s = state.settings
      const fullName = [s.name, s.last_name].filter(Boolean).join(' ') || s.name || 'the applicant'
      const stageMap: Record<string, string> = {
        draft:     'Initial outreach — has not yet applied, writing a speculative or direct application email',
        applied:   'Already applied — writing a polite follow-up to check on the status',
        replied:   'Recruiter has replied — continuing the conversation',
        interview: 'Interview stage — writing a thank-you or scheduling confirmation',
        offer:     'Received an offer — responding to the offer',
        rejected:  'Was rejected — writing a gracious response keeping the door open',
        ghosted:   'Has not heard back in a long time — sending a gentle final follow-up',
      }
      const stage = stageMap[app?.status ?? 'draft'] ?? stageMap.draft
      const intentionView = app?.view_id
        ? state.filter_views.find(v => v.id === app.view_id)
        : undefined
      const profileLines = intentionView?.intention
        ? [`Applicant's intention: ${intentionView.intention}`]
        : []
      const cvFile = state.files.find(f => f.is_cv && f.cv_text)
      const userMsg = [
        `Company: ${app?.company || 'the company'}`,
        `Role: ${app?.role || 'the position'}`,
        `Contact name: ${app?.contact_name || 'the hiring manager'}`,
        `My name: ${fullName}`,
        `Application stage: ${stage}`,
        intentionView?.name
          ? `Job search intention: "${intentionView.name}"`
          : '',
        profileLines.length
          ? `Applicant's stated intention:\n${profileLines.join('\n')}`
          : '',
        cvFile
          ? `Applicant's CV (extract relevant skills and experience from this):\n${cvFile.cv_text!.slice(0, 6000)}`
          : '',
        app?.link    ? `Job listing: ${app.link}` : '',
        app?.notes   ? `Additional context: ${app.notes}` : '',
        `Write the email in ${lang === 'sv' ? 'Swedish' : 'English'}.`,
      ].filter(Boolean).join('\n')

      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.settings.openrouter_key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://crm-e.app',
          'X-Title': 'crm-e',
        },
        body: JSON.stringify({
          model: state.settings.openrouter_model,
          messages: [
            { role: 'system', content: AI_DRAFT_SYSTEM_PROMPT },
            { role: 'user',   content: userMsg },
          ],
        }),
      })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) { toast(t('compose.aiKeyExpired'), 'error'); return }
        const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } | string }
        const errMsg = typeof errBody.error === 'object' ? errBody.error?.message : String(errBody.error ?? `HTTP ${res.status}`)
        throw new Error(errMsg ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as { choices?: { message?: { content?: string } }[] }
      const raw = data.choices?.[0]?.message?.content ?? ''
      // Robustly extract the JSON object — works even if the model adds a
      // preamble, sign-off, or wraps the output in markdown code fences.
      const jsonStr = raw.match(/\{[\s\S]*\}/)?.[0]
      if (!jsonStr) throw new Error(t('compose.aiNoResponse'))
      const parsed = JSON.parse(jsonStr) as { subject?: string; body?: string }
      if (parsed.subject) setSubject(parsed.subject)
      if (parsed.body)    setBody(parsed.body)
      toast(t('compose.aiDrafted'), 'success')
    } catch (e) {
      toast(`${t('compose.aiError')} ${(e as Error).message}`, 'error')
    } finally {
      setAiGenerating(false)
    }
  }

  async function sendViaAPI() {
    const to = app?.contact_email ?? ''
    if (!to) { toast(t('compose.noEmail'), 'error'); return }
    if (!connected) { toast(t('compose.connectFirst', { provider: provider === 'outlook' ? 'Outlook' : 'Gmail' }), 'error'); return }
    const attachedFiles = [
      ...(pdfAttachment ? [pdfAttachment] : []),
      ...selectedFiles.map(id => state.files.find(f => f.id === id)).filter(Boolean) as FileRecord[],
    ]
    setSending(true)
    try {
      const token = await ensureToken(provider, state, update)
      if (!token) { toast(t('compose.sessionExpired'), 'error'); setSending(false); return }
      if (provider === 'gmail') {
        const from = mailState.user_email ? `${state.settings.name} <${mailState.user_email}>` : mailState.user_email
        const encoded = buildGmailRaw(from, to, subject, body, attachedFiles)
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
            ...(attachedFiles.length > 0 ? {
              attachments: attachedFiles.map(f => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: f.filename,
                contentType: f.type,
                contentBytes: f.data_url.split(',')[1] ?? '',
              })),
            } : {}),
          }),
        })
        if (!draftRes.ok) {
          const err = await draftRes.json().catch(() => ({})) as { error?: { message?: string; code?: string } }
          if (draftRes.status === 403) throw new Error(t('compose.outlookPermission'))
          throw new Error(err.error?.message || `Graph ${draftRes.status}`)
        }
        const draft = await draftRes.json() as { id?: string; conversationId?: string }
        if (!draft.id) throw new Error('Graph did not return a message ID')
        const sendRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Length': '0' },
        })
        if (!sendRes.ok && sendRes.status !== 202) {
          const err = await sendRes.json().catch(() => ({})) as { error?: { message?: string } }
          if (sendRes.status === 403) throw new Error(t('compose.outlookPermission'))
          throw new Error(err.error?.message || `Graph send ${sendRes.status}`)
        }
        if (app) onSent(app.id, provider, draft.conversationId)
      }
      onClose()
      toast(t('compose.sent', { provider: provider === 'outlook' ? 'Outlook' : 'Gmail' }), 'success')
    } catch (e) {
      toast(`${t('compose.sendFailed')} ${(e as Error).message}`, 'error')
    } finally {
      setSending(false)
    }
  }

  async function copyBody() {
    try { await navigator.clipboard.writeText(body); toast(t('compose.bodyCopied'), 'success') }
    catch { toast(t('compose.copyFailed'), 'error') }
  }

  const attachableFiles = state.files.filter(f => ATTACHABLE_TYPES.has(f.type))
  const [attachOpen, setAttachOpen] = useState(false)
  const [clOpen, setClOpen] = useState(false)

  const composeAssist = state.settings.compose_assist ?? 'context'
  const isContextMode = composeAssist === 'context' || composeAssist === 'both'
  const isAIMode      = composeAssist === 'ai'      || composeAssist === 'both'
  const [draftLang, setDraftLang] = useState<'en' | 'sv'>('en')

  // ── Context panel (shown in context mode, left of the form) ──────────────
  function CtxRow({ label, value, link }: { label: string; value?: string | null; link?: boolean }) {
    if (!value) return null
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wide font-semibold text-lo/60">{label}</span>
        {link
          ? <a href={value} target="_blank" rel="noopener" className="text-xs text-primary truncate">{value}</a>
          : <span className="text-xs text-hi/90 leading-snug">{value}</span>}
      </div>
    )
  }

  return (
    <dialog ref={ref} style={{ maxWidth: isContextMode ? 920 : 640, width: '100%', height: '90vh', maxHeight: '90vh', padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'row', height: '100%' }}>

      {/* ── Left context panel ── */}
      {isContextMode && app && (
        <div
          className="border-r border-edge bg-raised/30 flex flex-col gap-4 shrink-0 overflow-hidden"
          style={{ width: 260, padding: '20px 18px' }}
        >
          <span className="text-[11px] uppercase tracking-widest font-semibold text-lo/50">{t('compose.ctxTitle')}</span>
          <CtxRow label={t('compose.ctxCompany')} value={app.company} />
          <CtxRow label={t('compose.ctxRole')} value={app.role} />
          <CtxRow label={t('compose.ctxStatus')} value={statusLabel(app.status)} />
          {app.contact_name && (
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-lo/60">{t('compose.ctxContact')}</span>
              <span className="text-xs text-hi/90">{app.contact_name}</span>
              {app.contact_email && <a href={`mailto:${app.contact_email}`} className="text-xs text-primary truncate">{app.contact_email}</a>}
            </div>
          )}
          <CtxRow label={t('compose.ctxApplied')} value={app.applied_at} />
          <CtxRow label={t('compose.ctxDeadline')} value={app.deadline} />
          <CtxRow label={t('compose.ctxFollowUp')} value={app.follow_up_at} />
          <CtxRow label={t('compose.ctxLink')} value={app.link} link />
          {app.notes && (
            <div className="flex flex-col gap-1 min-h-0 flex-1">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-lo/60 shrink-0">{t('compose.ctxNotes')}</span>
              <p className="text-xs text-hi/80 leading-relaxed m-0 whitespace-pre-wrap overflow-y-auto min-h-0 flex-1">{app.notes}</p>
            </div>
          )}
        </div>
      )}

      <form onSubmit={e => { e.preventDefault(); sendViaAPI() }} style={{ display: 'flex', flexDirection: 'column', padding: 0, gap: 0, flex: 1, minWidth: 0, overflow: 'hidden' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-hi">{app?.contact_name || app?.contact_email || t('compose.newMsg')}</span>
            {app && <span className="text-xs text-lo">{app.role} · {app.company}</span>}
          </div>
          <div className="flex items-center gap-2">
            {(gmailOk || outlookOk) && (
              <select value={provider} className="text-xs bg-raised border border-edge rounded-md px-2 py-1 text-lo" style={{ width: 'auto' }} onChange={e => setProvider(e.target.value as MailProvider)}>
                {gmailOk   && <option value="gmail">Gmail</option>}
                {outlookOk && <option value="outlook">Outlook</option>}
              </select>
            )}
            <button type="button" className="ghost" style={{ padding: '2px 8px', fontSize: 13 }} onClick={onClose}>✕</button>
          </div>
        </div>

        {!connected && (
          <div className="px-5 py-2 text-xs bg-warn/10 border-b border-warn/30" style={{ color: 'var(--warning, #f59e0b)' }}>
            {t('compose.noAccountWarn')}{' '}
            <button type="button" onClick={onNavigateSettings}
              className="underline bg-transparent border-none p-0 cursor-pointer text-xs"
              style={{ color: 'inherit' }}>
              {t('compose.openSettings')}
            </button>
          </div>
        )}

        {(() => {
          const missing = Array.from(new Set([...(subject + body).matchAll(/\{\{(my_\w+)\}\}/g)].map(m => m[1])))
          if (missing.length === 0) return null
          return (
            <div className="px-5 py-2 text-xs bg-warn/10 border-b border-warn/30" style={{ color: 'var(--warning, #f59e0b)' }}>
              {t('compose.profileMissing', { fields: missing.join(', ') })}
            </div>
          )
        })()}

        {/* Email header rows */}
        <div className="border-b border-edge">
          <div className="flex items-center gap-3 px-5 py-2 border-b border-edge/50">
            <span className="text-xs text-lo w-10 shrink-0">{t('compose.from')}</span>
            <span className="text-sm text-hi/80">{mailState.user_email || (connected ? '…' : '—')}</span>
          </div>
          <div className="flex items-center gap-3 px-5 py-2 border-b border-edge/50">
            <span className="text-xs text-lo w-10 shrink-0">{t('compose.to')}</span>
            <span className="text-sm text-hi/80">{app?.contact_email || '—'}</span>
          </div>
          <div className="flex items-center gap-3 px-5 py-2">
            <span className="text-xs text-lo w-10 shrink-0">{t('compose.subject')}</span>
            <input
              required
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder={t('compose.subject')}
              className="flex-1 bg-transparent border-none outline-none text-sm text-hi placeholder:text-lo/40 p-0"
              style={{ boxShadow: 'none' }}
            />
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-5 py-2 border-b border-edge bg-raised/30">
          <select className="text-xs bg-transparent border border-edge rounded-md px-2 py-1 text-lo" style={{ width: 'auto' }} onChange={e => applyTemplate(e.target.value)}>
            <option value="">{t('compose.template')}</option>
            {state.templates.filter(tpl => (tpl.type ?? 'email') === 'email').map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
          </select>
          {coverLetterTemplates.length > 0 && (
            <select className="text-xs bg-transparent border border-edge rounded-md px-2 py-1 text-lo" style={{ width: 'auto' }} value={coverLetterId} onChange={e => { applyCoverLetter(e.target.value); if (e.target.value) setClOpen(true) }}>
              <option value="">{t('compose.coverLetter')}</option>
              {coverLetterTemplates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
            </select>
          )}
          {isAIMode && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="ghost flex items-center gap-1 text-xs"
                style={{ padding: '2px 8px' }}
                disabled={aiGenerating || !state.settings.openrouter_key || !state.settings.openrouter_model}
                title={(!state.settings.openrouter_key || !state.settings.openrouter_model) ? t('compose.aiNoKey') : t('compose.aiDraft')}
                onClick={() => generateAIDraft(draftLang)}
              >
                {aiGenerating ? t('compose.aiDrafting') : t('compose.aiDraft')}
              </button>
              <button
                type="button"
                className="text-[11px] font-semibold px-1.5 py-0.5 rounded border border-edge bg-transparent text-lo hover:text-hi hover:border-primary transition-colors cursor-pointer tabular-nums"
                title={draftLang === 'sv' ? 'Switch draft language to English' : 'Byt utkastspråk till svenska'}
                onClick={() => setDraftLang(l => l === 'en' ? 'sv' : 'en')}
              >
                {draftLang === 'sv' ? 'SV' : 'EN'}
              </button>
            </div>
          )}
          <button type="button" className="ghost ml-auto flex items-center gap-1 text-xs" style={{ padding: '2px 8px' }} onClick={() => setAttachOpen(o => !o)}>
            📎 {selectedFiles.length + (pdfAttachment ? 1 : 0) > 0 ? t('compose.attached', { n: selectedFiles.length + (pdfAttachment ? 1 : 0) }) : t('compose.attach')}
          </button>
        </div>

        {/* Attachments panel */}
        {attachOpen && (
          <div className="px-5 py-3 border-b border-edge bg-canvas">
            {attachableFiles.length === 0
              ? <span className="text-xs text-lo">{t('compose.noAttachable')}</span>
              : <div className="flex flex-col gap-1">
                  {attachableFiles.map(f => (
                    <label key={f.id} className="flex-row items-center gap-2 text-xs text-hi cursor-pointer">
                      <input type="checkbox" checked={selectedFiles.includes(f.id)} style={{ width: 'auto' }}
                        onChange={e => setSelectedFiles(prev => e.target.checked ? [...prev, f.id] : prev.filter(x => x !== f.id))} />
                      {f.label} <span className="text-lo">({f.filename})</span>
                    </label>
                  ))}
                </div>
            }
          </div>
        )}

        {/* Cover letter panel */}
        {clOpen && coverLetterBody && (
          <div className="px-5 py-3 border-b border-edge bg-canvas flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-lo">{t('compose.coverLetterLbl')}</span>
              <button type="button" className="ghost" style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => { setClOpen(false); applyCoverLetter('') }}>✕</button>
            </div>
            <textarea className="text-[12px]" rows={5} value={coverLetterBody} onChange={e => { setCoverLetterBody(e.target.value); setPdfAttachment(null) }} />
            <div className="flex items-center gap-2">
              <button type="button" onClick={generateCoverLetterPDF} disabled={generatingPdf} style={{ fontSize: 12 }}>
                {generatingPdf ? t('compose.generating') : pdfAttachment ? t('compose.regeneratePdf') : t('compose.generatePdf')}
              </button>
              {pdfAttachment && <span className="text-xs text-success">✓ {pdfAttachment.filename}</span>}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="px-5 py-4">
          <textarea
            required
            rows={14}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={t('compose.body')}
            className="w-full rounded-lg border border-edge bg-canvas"
            style={{ resize: 'vertical', outline: 'none', boxShadow: 'none', padding: '12px 14px', fontSize: 13, lineHeight: 1.6 }}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-edge bg-raised/30 flex-wrap">
          <button type="button" className="ghost text-xs shrink-0" onClick={copyBody}>{t('compose.copyBody')}</button>
          <div className="flex gap-2 shrink-0">
            <button type="button" className="ghost" onClick={onClose}>{t('compose.cancel')}</button>
            <button type="submit" className="primary" disabled={sending || !connected}>
              {sending ? t('compose.sending') : t('compose.send', { provider: provider === 'outlook' ? 'Outlook' : 'Gmail' })}
            </button>
          </div>
        </div>

      </form>
      </div>
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
  const { t, statusLabel } = useLang()
  const ref = useDialog(open, onClose)
  const [syncing, setSyncing] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [aiResult, setAiResult] = useState<{ status: string; comment: string } | null>(null)
  const [expandedEmails, setExpandedEmails] = useState<Set<string>>(new Set())
  const [replyTarget, setReplyTarget] = useState<EmailRecord | null>(null)
  const [replyBody, setReplyBody] = useState('')
  const [replyTplId, setReplyTplId] = useState('')
  const [replyFiles, setReplyFiles] = useState<string[]>([])
  const [replyCoverLetterId, setReplyCoverLetterId] = useState('')
  const [replyCoverLetterBody, setReplyCoverLetterBody] = useState('')
  const [replyPdfAttachment, setReplyPdfAttachment] = useState<FileRecord | null>(null)
  const [replyGeneratingPdf, setReplyGeneratingPdf] = useState(false)
  const [replySending, setReplySending] = useState(false)
  const [replyAttachOpen, setReplyAttachOpen] = useState(false)

  const emails: EmailRecord[] = app ? (state.emails[app.id] || []) : []
  const suggested = suggestStatus(emails)

  const provider: MailProvider = app?.sync_provider ?? state.settings.active_mail_provider
  const mailState = provider === 'gmail' ? state.mail.gmail : state.mail.outlook

  async function syncEmails() {
    if (!app) return
    const threadIds = app.thread_ids || []
    if (!threadIds.length) { toast(t('email.noThreads'), 'error'); return }
    if (!isConnected(mailState)) { toast(t('email.connectFirst', { provider: provider === 'outlook' ? 'Outlook' : 'Gmail' }), 'error'); return }
    setSyncing(true)
    try {
      const token = await ensureToken(provider, state, update)
      if (!token) { toast(t('email.sessionExpired'), 'error'); setSyncing(false); return }
      const messages = await fetchEmailsForApp(app, provider, token, state.mail.gmail.user_email, state.mail.outlook.user_email)
      update(s => {
        s.emails[app.id] = messages
        const a = s.applications.find(x => x.id === app.id)
        if (a) a.sync_provider = provider
      })
      if (messages.length) setExpandedEmails(new Set([messages[messages.length - 1].id]))
      toast(messages.length
        ? t('email.syncResult', { n: messages.length, t: threadIds.length })
        : t('email.noReplies'), messages.length ? 'success' : undefined)

      if (messages.length && state.settings.openrouter_key && state.settings.openrouter_model) {
        setSyncing(false)
        setAnalyzing(true)
        try {
          const emailText = messages.map(e => `[${new Date(e.date).toLocaleDateString()}] ${e.direction === 'outgoing' ? 'Sent' : 'Received'} — ${e.subject}\n${(e.body ?? e.snippet).slice(0, 2000)}`).join('\n\n')
          const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${state.settings.openrouter_key}`,
              'Content-Type': 'application/json',
              'HTTP-Referer': 'https://crm-e.app',
              'X-Title': 'crm-e',
            },
            body: JSON.stringify({
              model: state.settings.openrouter_model,
              messages: [
                { role: 'system', content: AI_SYSTEM_PROMPT },
                { role: 'user', content: `Application: ${app.role} at ${app.company}\n\nEmails:\n${emailText}` },
              ],
            }),
          })
          if (res.ok) {
            const data = await res.json() as { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
            if (!data.error?.message) {
              const raw = data.choices?.[0]?.message?.content || ''
              const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}') as { status?: string; comment?: string }
              if (parsed.status) setAiResult({ status: parsed.status, comment: parsed.comment || '' })
            }
          } else if (res.status === 401 || res.status === 403) {
            toast(t('compose.aiKeyExpired'), 'error')
          }
        } catch { /* silent — AI is best-effort */ }
        finally { setAnalyzing(false) }
      }
    } catch (e) { toast((e as Error).message, 'error') }
    finally { setSyncing(false); setAnalyzing(false) }
  }

  const coverLetterTemplates = state.templates.filter(t => (t.type ?? 'email') === 'cover_letter')

  // Shared placeholder builder for the reply panel. Empty profile fields are
  // omitted so unresolved {{my_*}} placeholders stay visible in the body —
  // surfaces the missing-profile warning rather than silently sending blanks.
  function buildReplyVars(filesText: string): Record<string, string> {
    const s = state.settings
    const fullName = [s.name, s.last_name].filter(Boolean).join(' ')
    const address  = [s.street, s.city, s.postal_code, s.country].filter(Boolean).join(', ')
    const out: Record<string, string> = {
      company: app?.company ?? '', role: app?.role ?? '',
      contact_name: app?.contact_name || 'there',
      files: filesText,
      ...(s.links ?? []).filter(l => l.label && l.url).reduce((acc, l) => { acc[linkVar(l.label)] = l.url; return acc }, {} as Record<string, string>),
    }
    if (s.name)      out.my_name      = s.name
    if (s.last_name) out.my_last_name = s.last_name
    if (fullName)    out.my_full_name = fullName
    if (s.email || mailState.user_email) out.my_email = s.email || mailState.user_email
    if (s.phone)     out.my_phone     = s.phone
    if (address)     out.my_address   = address
    if (s.linkedin)  out.my_linkedin  = s.linkedin
    return out
  }

  function applyCoverLetterReply(tplId: string) {
    setReplyCoverLetterId(tplId)
    setReplyPdfAttachment(null)
    if (!tplId) { setReplyCoverLetterBody(''); return }
    const tpl = state.templates.find(t => t.id === tplId)
    if (!tpl) { setReplyCoverLetterBody(''); return }
    const vars = buildReplyVars('')
    setReplyCoverLetterBody(tpl.body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`))
  }

  async function generateReplyCoverLetterPDF() {
    if (!replyCoverLetterBody) return
    setReplyGeneratingPdf(true)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const margin = 20
      const maxWidth = doc.internal.pageSize.getWidth() - margin * 2
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      const lines = doc.splitTextToSize(replyCoverLetterBody, maxWidth)
      let y = margin + 5
      for (const line of lines) {
        if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin }
        doc.text(line, margin, y)
        y += 6
      }
      const dataUrl = doc.output('datauristring')
      const filename = `cover-letter-${(app?.company || 'application').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`
      setReplyPdfAttachment({ id: 'reply-cl-pdf', label: 'Cover letter', description: '', filename, data_url: dataUrl, size: Math.round((dataUrl.length - 28) * 0.75), type: 'application/pdf', uploaded_at: new Date().toISOString() })
      toast('Cover letter PDF attached', 'success')
    } catch (e) {
      toast(`PDF error: ${(e as Error).message}`, 'error')
    } finally {
      setReplyGeneratingPdf(false)
    }
  }

  async function sendReply() {
    if (!replyTarget || !app) return
    if (!replyBody.trim()) { toast(t('email.replyEmpty'), 'error'); return }
    const token = await ensureToken(provider, state, update)
    if (!token) { toast(t('email.sessionExpired'), 'error'); return }
    setReplySending(true)
    const subject = replyTarget.subject.startsWith('Re:') ? replyTarget.subject : `Re: ${replyTarget.subject}`
    const to = /<(.+)>/.exec(replyTarget.from)?.[1] ?? replyTarget.from
    const attachedFiles = [
      ...(replyPdfAttachment ? [replyPdfAttachment] : []),
      ...replyFiles.map(id => state.files.find(f => f.id === id)).filter(Boolean) as FileRecord[],
    ]
    try {
      if (provider === 'gmail') {
        const from = mailState.user_email ? `${state.settings.name} <${mailState.user_email}>` : mailState.user_email
        const encoded = buildGmailRaw(from, to, subject, replyBody, attachedFiles, replyTarget.messageId)
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: encoded, threadId: replyTarget.threadId }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
          throw new Error(err.error?.message || `Gmail ${res.status}`)
        }
      } else if (attachedFiles.length === 0) {
        const res = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${replyTarget.id}/reply`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment: replyBody }),
        })
        if (!res.ok && res.status !== 202) {
          const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
          throw new Error(err.error?.message || `Graph ${res.status}`)
        }
      } else {
        // createReply draft → patch body → attach files → send
        const draftRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${replyTarget.id}/createReply`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!draftRes.ok) {
          const err = await draftRes.json().catch(() => ({})) as { error?: { message?: string } }
          throw new Error(err.error?.message || `Graph ${draftRes.status}`)
        }
        const draft = await draftRes.json() as { id?: string }
        if (!draft.id) throw new Error('No draft ID returned')
        await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ body: { contentType: 'Text', content: replyBody } }),
        })
        for (const f of attachedFiles) {
          await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}/attachments`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: f.filename,
              contentType: f.type,
              contentBytes: f.data_url.split(',')[1] ?? '',
            }),
          })
        }
        const sendRes = await fetch(`https://graph.microsoft.com/v1.0/me/messages/${draft.id}/send`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        })
        if (!sendRes.ok && sendRes.status !== 202) {
          const err = await sendRes.json().catch(() => ({})) as { error?: { message?: string } }
          throw new Error(err.error?.message || `Graph ${sendRes.status}`)
        }
      }
      update(s => {
        const a = s.applications.find(x => x.id === app.id)
        if (a) { a.last_contact_at = new Date().toISOString().slice(0, 10); a.follow_up_at = '' }
      })
      toast(t('compose.sent', { provider: providerLabel }), 'success')
      setReplyTarget(null)
      setReplyBody('')
      setReplyTplId('')
      setReplyFiles([])
      setReplyCoverLetterId('')
      setReplyCoverLetterBody('')
      setReplyPdfAttachment(null)
      setReplyAttachOpen(false)
    } catch (e) {
      toast(`${t('compose.sendFailed')} ${(e as Error).message}`, 'error')
    } finally {
      setReplySending(false)
    }
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
    const label = statusLabel(status as Parameters<typeof statusLabel>[0])
    toast(`Status → ${label}`, 'success')
    setAiResult(null)
    onClose()
  }

  const providerLabel = provider === 'outlook' ? 'Outlook' : 'Gmail'

  return (
    <dialog ref={ref} style={{ maxWidth: '720px' }}>
      <div className="p-5 flex flex-col gap-3 min-w-[560px] max-w-[720px]">
        <div className="flex justify-between items-center gap-3">
          <h3 className="m-0 text-base font-semibold">{app ? `${app.company} — ${app.role}` : t('email.dlgTitle')}</h3>
          <div className="flex gap-1.5">
            <button className="primary" onClick={syncEmails} disabled={syncing || analyzing}>
              {syncing ? t('email.syncing') : analyzing ? `✦ ${t('email.analyzing')}` : (providerLabel === 'Outlook' ? t('email.syncOutlook') : t('email.syncGmail'))}
            </button>
            <button className="ghost" onClick={onClose}>✕</button>
          </div>
        </div>
        <div className="text-lo text-xs">
          {(app?.thread_ids?.length ?? 0) > 0
            ? t('email.syncResult', { n: app!.thread_ids.length, t: app!.thread_ids.length })
            : t('email.noThreads')}
        </div>
        {aiResult && (
          <div className="suggestion">
            <div>
              <strong>{t('email.aiSuggests')}</strong> {aiResult.comment}
              {' · '}Status: <strong>{statusLabel(aiResult.status as Parameters<typeof statusLabel>[0])}</strong>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => applyStatus(aiResult.status)}>{t('email.aiApply')}</button>
              <button className="ghost" onClick={() => setAiResult(null)}>{t('email.aiDismiss')}</button>
            </div>
          </div>
        )}
        {!aiResult && suggested && suggested !== app?.status && (
          <div className="suggestion">
            <span>{t('email.aiSuggests')} <strong>{statusLabel(suggested)}</strong></span>
            <button onClick={() => applyStatus(suggested)}>{t('email.aiApply')}</button>
          </div>
        )}
        <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto">
          {emails.length === 0
            ? <p className="text-center text-lo p-10 bg-surface rounded-lg border border-dashed border-edge">{t('email.noReplies')}</p>
            : emails.map((e, i) => {
              const isOut = e.direction === 'outgoing'
              const expanded = expandedEmails.has(e.id)
              const toggle = () => setExpandedEmails(prev => {
                const n = new Set(prev); n.has(e.id) ? n.delete(e.id) : n.add(e.id); return n
              })
              return (
                <div key={e.id} className={`email-item ${e.direction} ${e.classification}`}>
                  <div
                    className="flex justify-between items-center gap-2 text-xs text-lo cursor-pointer select-none"
                    onClick={toggle}
                  >
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
                      <span className="text-[10px] opacity-50">{expanded ? '▲' : '▼'}</span>
                    </span>
                  </div>
                  {expanded && (
                    <>
                      <div className="flex items-start justify-between gap-2 mt-1.5">
                        <div className="font-semibold text-hi text-[13px] mb-1">{e.subject}</div>
                        <button
                          className="ghost shrink-0"
                          style={{ padding: '1px 8px', fontSize: 11, marginTop: -1 }}
                          onClick={ev => { ev.stopPropagation(); setReplyTarget(e); setReplyBody(''); setReplyTplId('') }}
                        >↩ {t('email.reply')}</button>
                      </div>
                      <div className="text-xs text-lo leading-relaxed whitespace-pre-wrap">{(e.body ?? e.snippet.replace(/&#39;/g, "'").replace(/&amp;/g, '&')).trim()}</div>
                    </>
                  )}
                  {!expanded && (
                    <div className="text-xs text-lo truncate mt-1 opacity-70">{e.subject}</div>
                  )}
                  {i < emails.length - 1 && <div className="absolute left-5 bottom-[-10px] w-[2px] h-[10px] bg-edge" />}
                </div>
              )
            })
          }
        </div>
        {replyTarget && (
          <div className="border border-edge rounded-xl overflow-hidden bg-surface flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-hi">{replyTarget.subject.startsWith('Re:') ? replyTarget.subject : `Re: ${replyTarget.subject}`}</span>
                <span className="text-xs text-lo">To: {/<(.+)>/.exec(replyTarget.from)?.[1] ?? replyTarget.from}</span>
              </div>
              <button className="ghost" style={{ padding: '2px 8px', fontSize: 13 }} onClick={() => { setReplyTarget(null); setReplyBody(''); setReplyTplId(''); setReplyFiles([]); setReplyCoverLetterId(''); setReplyCoverLetterBody(''); setReplyPdfAttachment(null); setReplyAttachOpen(false) }}>✕</button>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-edge bg-raised/30">
              <select className="text-xs bg-transparent border border-edge rounded-md px-2 py-1 text-lo" style={{ width: 'auto' }} value={replyTplId} onChange={e => {
                const id = e.target.value; setReplyTplId(id)
                if (id) {
                  const tpl = state.templates.find(tpl => tpl.id === id)
                  if (tpl) {
                    const fileNames = replyFiles.map(fid => state.files.find(f => f.id === fid)?.filename).filter(Boolean).join(', ') || '(none)'
                    const vars = buildReplyVars(fileNames)
                    setReplyBody(tpl.body.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`))
                  }
                }
              }}>
                <option value="">{t('email.replyTemplate')}</option>
                {state.templates.filter(tpl => (tpl.type ?? 'email') === 'email').map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
              </select>
              {coverLetterTemplates.length > 0 && (
                <select className="text-xs bg-transparent border border-edge rounded-md px-2 py-1 text-lo" style={{ width: 'auto' }} value={replyCoverLetterId} onChange={e => { applyCoverLetterReply(e.target.value) }}>
                  <option value="">{t('email.replyCoverLetter')}</option>
                  {coverLetterTemplates.map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
                </select>
              )}
              {state.files.filter(f => ATTACHABLE_TYPES.has(f.type)).length > 0 && (
                <button type="button" className="ghost ml-auto flex items-center gap-1 text-xs" style={{ padding: '2px 8px' }}
                  onClick={() => setReplyAttachOpen(o => !o)}>
                  📎 {replyFiles.length + (replyPdfAttachment ? 1 : 0) > 0 ? t('email.attached', { n: replyFiles.length + (replyPdfAttachment ? 1 : 0) }) : t('email.attach')}
                </button>
              )}
            </div>

            {/* Attach panel */}
            {state.files.filter(f => ATTACHABLE_TYPES.has(f.type)).length > 0 && replyAttachOpen && (
              <div className="px-4 py-2 border-b border-edge bg-canvas flex flex-wrap gap-x-4 gap-y-1">
                {state.files.filter(f => ATTACHABLE_TYPES.has(f.type)).map(f => (
                  <label key={f.id} className="flex-row items-center gap-1.5 text-xs text-hi cursor-pointer">
                    <input type="checkbox" checked={replyFiles.includes(f.id)} style={{ width: 'auto' }}
                      onChange={e => setReplyFiles(prev => e.target.checked ? [...prev, f.id] : prev.filter(x => x !== f.id))} />
                    {f.label} <span className="text-lo">({f.filename})</span>
                  </label>
                ))}
              </div>
            )}

            {/* Cover letter panel */}
            {replyCoverLetterBody && (
              <div className="px-4 py-3 border-b border-edge bg-canvas flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-lo">{t('compose.coverLetterLbl')}</span>
                  <button type="button" className="ghost" style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => { applyCoverLetterReply('') }}>✕</button>
                </div>
                <textarea className="text-[12px]" rows={4} value={replyCoverLetterBody} onChange={e => { setReplyCoverLetterBody(e.target.value); setReplyPdfAttachment(null) }} />
                <div className="flex items-center gap-2">
                  <button type="button" onClick={generateReplyCoverLetterPDF} disabled={replyGeneratingPdf} style={{ fontSize: 12 }}>
                    {replyGeneratingPdf ? t('compose.generating') : replyPdfAttachment ? t('compose.regeneratePdf') : t('compose.generatePdf')}
                  </button>
                  {replyPdfAttachment && <span className="text-xs text-success">✓ {replyPdfAttachment.filename}</span>}
                </div>
              </div>
            )}

            {/* Missing-profile warning */}
            {(() => {
              const missing = Array.from(new Set([...(replyBody + replyCoverLetterBody).matchAll(/\{\{(my_\w+)\}\}/g)].map(m => m[1])))
              if (missing.length === 0) return null
              return (
                <div className="px-4 py-2 text-xs bg-warn/10 border-b border-warn/30" style={{ color: 'var(--warning, #f59e0b)' }}>
                  {t('compose.profileMissing', { fields: missing.join(', ') })}
                </div>
              )
            })()}

            {/* Body */}
            <div className="px-4 py-3">
              <textarea
                rows={6}
                placeholder={t('email.replyPh')}
                value={replyBody}
                onChange={e => setReplyBody(e.target.value)}
                autoFocus
                className="w-full rounded-lg border border-edge bg-canvas"
                style={{ resize: 'vertical', outline: 'none', boxShadow: 'none', padding: '10px 12px', fontSize: 13, lineHeight: 1.6 }}
              />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-edge bg-raised/30">
              <button className="ghost" onClick={() => { setReplyTarget(null); setReplyBody(''); setReplyTplId(''); setReplyFiles([]); setReplyCoverLetterId(''); setReplyCoverLetterBody(''); setReplyPdfAttachment(null); setReplyAttachOpen(false) }}>{t('compose.cancel')}</button>
              <button className="primary" onClick={sendReply} disabled={replySending || !replyBody.trim()}>
                {replySending ? t('email.sendingReply') : t('email.sendReply')}
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  )
}

// ── Applications (main) ───────────────────────────────────────────────────────

export default function Applications({ onNavigateSettings, highlightId, onHighlightConsumed }: { onNavigateSettings?: () => void; highlightId?: string | null; onHighlightConsumed?: () => void }) {
  const { state, update, toast } = useStore()
  const { t, statusLabel } = useLang()
  const [flashId, setFlashId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const [sortCol, setSortCol] = useState<'company' | 'role' | 'status' | 'applied_at' | 'last_contact_at' | 'deadline' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [multiSelect, setMultiSelect] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkSyncing, setBulkSyncing] = useState(false)
  const [scanningDeadline, setScanningDeadline] = useState<Set<string>>(new Set())

  // Highlight a specific row when navigated from a notification
  useEffect(() => {
    if (!highlightId) return
    setFlashId(highlightId)
    onHighlightConsumed?.()
    // Small delay so the tab has rendered before scrolling
    const scrollTimer = setTimeout(() => {
      document.getElementById(`app-row-${highlightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
    // Fade the highlight out after 2 s
    const fadeTimer = setTimeout(() => setFlashId(null), 2000)
    return () => { clearTimeout(scrollTimer); clearTimeout(fadeTimer) }
  }, [highlightId])

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
    if (!confirm(`${t('app.delete')} ${n}?`)) return
    update(s => {
      const removedJobIds = s.applications.filter(a => selected.has(a.id) && a.source_job_id).map(a => a.source_job_id!)
      s.applications = s.applications.filter(a => !selected.has(a.id))
      s.imported_job_ids = s.imported_job_ids.filter(id => !removedJobIds.includes(id))
    })
    exitMultiSelect()
    toast(t('app.delete'))
  }

  async function syncApps(apps: Application[]) {
    const toSync = apps.filter(a => (a.thread_ids || []).length > 0)
    if (!toSync.length) { toast('No applications have tracked email threads', 'error'); return }
    setBulkSyncing(true)
    let done = 0
    try {
      await Promise.all(toSync.map(async app => {
        const prov: MailProvider = app.sync_provider ?? state.settings.active_mail_provider
        const token = await ensureToken(prov, state, update)
        if (!token) return
        const messages = await fetchEmailsForApp(app, prov, token, state.mail.gmail.user_email, state.mail.outlook.user_email)
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

  function syncAll() { syncApps(state.applications) }

  async function aiScanDeadline(app: Application) {
    if (!state.settings.openrouter_key || !state.settings.openrouter_model) return
    setScanningDeadline(prev => new Set([...prev, app.id]))
    try {
      const text = [app.notes, app.role, app.company].filter(Boolean).join('\n')
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${state.settings.openrouter_key}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://crm-e.app',
          'X-Title': 'crm-e',
        },
        body: JSON.stringify({
          model: state.settings.openrouter_model,
          messages: [
            { role: 'system', content: AI_DEADLINE_PROMPT },
            { role: 'user', content: text },
          ],
        }),
      })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) { toast(t('compose.aiKeyExpired'), 'error'); return }
        const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } | string }
        const errMsg = typeof errBody.error === 'object' ? errBody.error?.message : String(errBody.error ?? `HTTP ${res.status}`)
        throw new Error(errMsg ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as { choices?: { message?: { content?: string } }[] }
      const raw = (data.choices?.[0]?.message?.content ?? '').trim()
      // Accept YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        update(s => { const a = s.applications.find(x => x.id === app.id); if (a) a.deadline = raw })
        toast(t('app.deadlineFound', { date: raw }), 'success')
      } else {
        toast(t('app.deadlineNotFound'), undefined)
      }
    } catch (e) {
      toast(`${t('compose.aiError')} ${(e as Error).message}`, 'error')
    } finally {
      setScanningDeadline(prev => { const n = new Set(prev); n.delete(app.id); return n })
    }
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
    toast(t('appDlg.save'), 'success')
  }

  function deleteApp(id: string) {
    const app = state.applications.find(a => a.id === id)
    if (!app || !confirm(`${t('app.delete')} ${app.company} — ${app.role}?`)) return
    update(s => {
      if (app.source_job_id) s.imported_job_ids = s.imported_job_ids.filter(j => j !== app.source_job_id)
      s.applications = s.applications.filter(a => a.id !== id)
    })
    toast(t('app.delete'))
  }

  function saveView(v: FilterView) {
    update(s => {
      const idx = s.filter_views.findIndex(x => x.id === v.id)
      if (idx >= 0) s.filter_views[idx] = v
      else s.filter_views.push(v)
      s.active_view_id = v.id
    })
    setViewOpen(false)
    toast(t('view.save'), 'success')
  }

  function deleteView(id: string) {
    const view = state.filter_views.find(v => v.id === id)
    if (!view || !confirm(`${t('view.delete')} "${view.name}"?`)) return
    update(s => {
      s.filter_views = s.filter_views.filter(v => v.id !== id)
      if (s.active_view_id === id) s.active_view_id = null
    })
    setViewOpen(false)
    toast(t('view.delete'))
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
      a.follow_up_at = ''
      if (a.status === 'draft') a.status = 'applied'
      if (!a.applied_at) a.applied_at = a.last_contact_at
      a.sync_provider = provider
      if (threadId) { if (!a.thread_ids) a.thread_ids = []; if (!a.thread_ids.includes(threadId)) a.thread_ids.push(threadId) }
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

  const today = new Date().toISOString().slice(0, 10)
  const dueFollowUps = state.applications.filter(a => a.follow_up_at && a.follow_up_at <= today && a.status !== 'rejected' && a.status !== 'offer')

  return (
    <div className="px-6 py-6 w-full">
      {dueFollowUps.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {dueFollowUps.map(a => (
            <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-warn/10 border border-warn/30 text-[13px]">
              <span>⏰ {t('app.followUpBanner')}: <strong>{a.company}</strong> — {a.role}</span>
              <div className="flex gap-1.5 shrink-0">
                <button className="ghost" style={{ fontSize: 11, padding: '1px 8px' }} onClick={() => { setEmailsApp(a); setEmailsOpen(true) }}>{t('app.openEmails')}</button>
                <button className="ghost" style={{ fontSize: 11, padding: '1px 8px' }} onClick={() => update(s => { const x = s.applications.find(x => x.id === a.id); if (x) x.follow_up_at = '' })}>{t('app.dismiss')}</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <h2 className="m-0 text-base font-semibold">{t('tab.applications')}</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <input type="search" placeholder={`${t('appDlg.company')} / ${t('appDlg.role')}…`} value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('app.allStatuses')}</option>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{statusLabel(s.value)}</option>)}
          </select>
          <button className="primary" onClick={() => openAppDialog()}>{t('app.new')}</button>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-3 pb-3 border-b border-edge">
        <button className={`view-chip ${!state.active_view_id ? 'active' : ''}`} onClick={() => setActiveView(null)}>
          {t('app.allStatuses').split(' ')[0]} <span className="view-count">{state.applications.length}</span>
        </button>
        {state.filter_views.map(v => (
          <span key={v.id} className={`view-chip ${state.active_view_id === v.id ? 'active' : ''}`} onClick={() => setActiveView(v.id)}>
            <span className="view-label">{v.name}</span>
            <span className="view-count">{state.applications.filter(a => matchesView(a, v)).length}</span>
            <button className="view-edit" onClick={e => { e.stopPropagation(); setEditingView(v); setViewOpen(true) }}>✎</button>
          </span>
        ))}
        <button className="view-chip add-view" onClick={() => { setEditingView(null); setViewOpen(true) }}>+ {t('view.new')}</button>
      </div>

      <div className="flex gap-3 mb-4 flex-wrap">
        <span className="bg-surface border border-edge px-3 py-[6px] rounded-lg text-[13px]">Total<strong className="text-primary ml-1.5">{scoped.length}</strong></span>
        {STATUSES.map(s => <span key={s.value} className="bg-surface border border-edge px-3 py-[6px] rounded-lg text-[13px]">{statusLabel(s.value)}<strong className="text-primary ml-1.5">{counts[s.value] || 0}</strong></span>)}
      </div>

      <div className="flex items-center justify-end gap-2 mb-1.5 min-h-[30px]">
        {!multiSelect
          ? <>
              <button className="ghost text-xs px-[10px] py-1 opacity-45 hover:opacity-100 flex items-center gap-1" onClick={syncAll} disabled={bulkSyncing}>
                <span className={`inline-block leading-none${bulkSyncing ? ' animate-spin' : ''}`} style={{ fontSize: '13px' }}>↻</span>
                {bulkSyncing ? t('email.syncing') : t('app.syncAll')}
              </button>
              <button className="ghost text-xs px-[10px] py-1 opacity-45 hover:opacity-100" onClick={() => setMultiSelect(true)}>☑ {t('app.select')}</button>
            </>
          : <>
              <span className="bulk-count text-[13px]">{selected.size > 0 ? `${selected.size} selected` : '…'}</span>
              <button className="ghost text-xs px-[10px] py-1" disabled={rows.length === 0} onClick={() => toggleSelectAll(rows.map(r => r.id))}>
                {rows.length > 0 && rows.every(r => selected.has(r.id)) ? '✗' : '✓'}
              </button>
              <button className="danger text-xs px-[10px] py-1" disabled={selected.size === 0} onClick={bulkDelete}>
                {`${t('app.delete')}${selected.size > 0 ? ` (${selected.size})` : ''}`}
              </button>
              <button className="ghost text-xs px-[10px] py-1" onClick={exitMultiSelect}>{t('appDlg.cancel')}</button>
            </>
        }
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-lo p-10 bg-surface rounded-lg border border-dashed border-edge" dangerouslySetInnerHTML={{ __html: state.applications.length === 0 ? 'No applications yet. Click <strong>+ New</strong> to add one.' : 'No applications match your filter.' }} />
      ) : (
        <div className="overflow-x-auto rounded-lg">
        <table className="w-full border-collapse bg-surface rounded-lg overflow-hidden">
          <thead>
            <tr>
              {multiSelect && <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo" style={{ width: 32 }} />}
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo" style={{ width: 28 }}></th>
              {(['company', 'role', 'status', 'applied_at', 'last_contact_at', 'deadline'] as const).map(col => {
                const colKey: Record<string, string> = { company: 'app.colCompany', role: 'app.colRole', status: 'app.colStatus', applied_at: 'app.colApplied', last_contact_at: 'app.colLast', deadline: 'app.colDeadline' }
                const labels: Record<string, string> = { company: t(colKey.company), role: t(colKey.role), status: t(colKey.status), applied_at: t(colKey.applied_at), last_contact_at: t(colKey.last_contact_at), deadline: t(colKey.deadline) }
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
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">{t('app.contact')}</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">{t('app.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(a => {
              const statusMeta = STATUSES.find(s => s.value === a.status) ?? STATUSES[0]
              const emailCount = (state.emails[a.id] || []).length
              return (
                <tr id={`app-row-${a.id}`} key={a.id} className={`hover:[&>td]:bg-raised transition-colors ${selected.has(a.id) ? 'row-selected' : ''} ${flashId === a.id ? '[&>td]:bg-primary/10' : ''}`}>
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
                        <option value="">{t('jobs.noIntent')}</option>
                        {state.filter_views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{a.role}</td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm"><span className={`status-badge status-${a.status}`}>{statusLabel(statusMeta.value)}</span></td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{a.applied_at || '—'}</td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{a.last_contact_at || '—'}</td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">
                    {(() => {
                      // ── Has a deadline ──
                      if (a.deadline) {
                        const dlMs = new Date(a.deadline).getTime()
                        if (!Number.isNaN(dlMs)) {
                          const daysLeft = Math.floor((dlMs - Date.now()) / 86_400_000)
                          const overdue = daysLeft < 0
                          const label = overdue
                            ? `${Math.abs(daysLeft)}d ago`
                            : daysLeft === 0
                              ? t('app.deadlineToday')
                              : t('app.deadlineDays', { n: String(daysLeft) })
                          const cls = overdue
                            ? 'bg-zinc-500/15 text-zinc-400'
                            : daysLeft <= 2
                              ? 'bg-red-500/15 text-red-400'
                              : daysLeft <= 7
                                ? 'bg-yellow-500/15 text-yellow-400'
                                : 'bg-green-500/15 text-green-400'
                          return <span title={a.deadline} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none ${cls}`}>{label}</span>
                        }
                      }

                      // ── No deadline — try regex first ──
                      const suggested = extractDeadlineFromText(a.notes)
                      if (suggested) {
                        return (
                          <button
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold leading-none bg-primary/10 text-primary hover:bg-primary/20 transition-colors border-none cursor-pointer"
                            title={`Found in notes — click to set`}
                            onClick={() => update(s => { const app = s.applications.find(x => x.id === a.id); if (app) app.deadline = suggested })}
                          >
                            {t('app.deadlineSuggest', { date: suggested })}
                          </button>
                        )
                      }

                      // ── No deadline, no regex match — offer AI scan ──
                      const isScanning = scanningDeadline.has(a.id)
                      if (state.settings.openrouter_key && state.settings.openrouter_model && a.notes) {
                        return (
                          <button
                            className="text-[10px] text-lo/40 hover:text-lo bg-transparent border-none cursor-pointer p-0 transition-colors"
                            disabled={isScanning}
                            onClick={() => aiScanDeadline(a)}
                          >
                            {isScanning ? '…' : t('app.deadlineScan')}
                          </button>
                        )
                      }

                      return <span className="text-lo/40">—</span>
                    })()}
                  </td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{a.contact_email ? <a href={`mailto:${a.contact_email}`}>{a.contact_email}</a> : '—'}</td>
                  <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">
                    <div className="flex gap-1 items-center">
                      <button className="px-2 py-1 text-xs whitespace-nowrap" onClick={() => { setComposeApp(a); setComposeOpen(true) }}>{t('app.compose')}</button>
                      <button className="emails-btn px-2 py-1 text-xs whitespace-nowrap" onClick={() => { setEmailsApp(a); setEmailsOpen(true) }}>
                        {t('app.emails')}{emailCount ? ` (${emailCount})` : ''}
                      </button>
                      <button className="px-2 py-1 text-xs whitespace-nowrap" onClick={() => openAppDialog(a)}>{t('app.edit')}</button>
                      <button className="px-2 py-1 text-xs whitespace-nowrap" onClick={() => deleteApp(a.id)}>{t('app.delete')}</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}

      <AppDialog open={appOpen} initial={editingApp} views={state.filter_views} onClose={closeApp} onSave={saveApp} />
      <ViewDialog open={viewOpen} initial={editingView} onClose={useCallback(() => setViewOpen(false), [])} onSave={saveView} onDelete={deleteView} />
      <ComposeDialog key={composeApp?.id ?? 'none'} open={composeOpen} app={composeApp} onClose={useCallback(() => setComposeOpen(false), [])} onSent={onSent} onNavigateSettings={() => { setComposeOpen(false); onNavigateSettings?.() }} />
      <EmailsDialog open={emailsOpen} app={emailsApp} onClose={useCallback(() => setEmailsOpen(false), [])} />
    </div>
  )
}
