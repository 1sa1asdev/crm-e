import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { useStore, DEFAULT_STATE } from '../store'

// ── Outlook PKCE ──────────────────────────────────────────────────────────────
export const AZURE_CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID
export const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
const OUTLOOK_SCOPES = 'openid email Mail.Read Mail.Send offline_access'

async function generatePKCE() {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  const verifier = btoa(String.fromCharCode(...array)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return { verifier, challenge }
}

// ── OpenRouter types ──────────────────────────────────────────────────────────
interface ORModel {
  id: string
  name: string
  pricing: { prompt: string; completion: string }
}

export default function Settings() {
  const { state, update, toast } = useStore()
  const s = state.settings
  const [orModels, setOrModels] = useState<ORModel[]>([])
  const [orLoading, setOrLoading] = useState(false)

  async function fetchModels() {
    if (!s.openrouter_key) { toast('Enter your OpenRouter API key first', 'error'); return }
    setOrLoading(true)
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${s.openrouter_key}` },
      })
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json() as { data: ORModel[] }
      const free = (data.data || []).filter(m => parseFloat(m.pricing.prompt) === 0 && parseFloat(m.pricing.completion) === 0)
      setOrModels(free)
      toast(`Loaded ${free.length} free models`, 'success')
    } catch (e) { toast(`Failed: ${(e as Error).message}`, 'error') }
    finally { setOrLoading(false) }
  }

  // ── Outlook: start local server, open system browser ─────────────────────
  async function connectOutlook() {
    try {
      const { verifier, challenge } = await generatePKCE()
      const port = await invoke<number>('start_oauth_listener', { verifier, provider: 'microsoft', clientId: AZURE_CLIENT_ID, clientSecret: '' })
      const redirectUri = `http://localhost:${port}`

      const params = new URLSearchParams({
        client_id: AZURE_CLIENT_ID,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: OUTLOOK_SCOPES,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        response_mode: 'query',
      })
      await shellOpen(`${MS_AUTH_URL}?${params}`)
      toast('Browser opened — sign in to continue')
    } catch (e) { toast(`Outlook error: ${(e as Error).message}`, 'error') }
  }

  // ── Gmail OAuth2 PKCE ────────────────────────────────────────────────────────
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send email profile'
const GMAIL_CLIENT_ID = import.meta.env.VITE_GMAIL_CLIENT_ID
const GMAIL_CLIENT_SECRET = import.meta.env.VITE_GMAIL_CLIENT_SECRET

async function connectGmail() {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) { toast('Gmail credentials not configured', 'error'); return }
  try {
    const { verifier, challenge } = await generatePKCE()
    const port = await invoke<number>('start_oauth_listener', {
      verifier, provider: 'google', clientId: GMAIL_CLIENT_ID, clientSecret: GMAIL_CLIENT_SECRET,
    })
    const redirectUri = `http://localhost:${port}`

    const params = new URLSearchParams({
      client_id: GMAIL_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: GOOGLE_SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    })
    await shellOpen(`${GOOGLE_AUTH_URL}?${params}`)
    toast('Browser opened — sign in to continue')
  } catch (e) { toast(`Gmail error: ${(e as Error).message}`, 'error') }
}

  const now = Date.now()
  const gmailConnected  = !!(state.mail.gmail.token  && state.mail.gmail.expires_at  > now + 30_000)
  const outlookConnected = !!(state.mail.outlook.token && state.mail.outlook.expires_at > now + 30_000)

  function disconnectGmail()   { update(ss => { ss.mail.gmail   = { token: '', refresh_token: '', expires_at: 0, user_email: '' } }); toast('Gmail disconnected') }
  function disconnectOutlook() { update(ss => { ss.mail.outlook = { token: '', refresh_token: '', expires_at: 0, user_email: '' } }); toast('Outlook disconnected') }

  // ── Export / Import / Clear ────────────────────────────────────────────────
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `crm-e-${new Date().toISOString().slice(0, 10)}.json`
    a.click(); URL.revokeObjectURL(url)
  }

  function importData() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'application/json'
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return
      try {
        const imported = JSON.parse(await file.text()) as { applications?: unknown; templates?: unknown }
        if (!imported.applications || !imported.templates) throw new Error('invalid shape')
        update(ss => Object.assign(ss, { ...DEFAULT_STATE, ...imported }))
        toast('Imported', 'success')
      } catch (e) { toast(`Import failed: ${(e as Error).message}`, 'error') }
    }
    input.click()
  }

  function clearAll() {
    if (!confirm('Wipe all applications, templates, and files?')) return
    update(ss => Object.assign(ss, structuredClone(DEFAULT_STATE)))
    toast('Cleared')
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3"><h2 className="m-0 text-base font-semibold">Settings</h2></div>

      <h3 className="mt-0 mb-2 text-sm font-semibold">Email sync</h3>
      <p className="text-lo text-[13px] m-0 mb-4">Save credentials for both providers. Only one is <strong>active</strong> at a time — click to switch.</p>

      {(['gmail', 'outlook'] as const).map(p => {
        const isActive = s.active_mail_provider === p
        const isSaved  = p === 'gmail' ? gmailConnected : outlookConnected
        const account  = p === 'gmail' ? state.mail.gmail.user_email : state.mail.outlook.user_email
        return (
          <div key={p} className={`provider-row ${isActive ? 'provider-active' : ''}`}>
            <span className="flex items-center gap-1.5 text-[13px] font-semibold min-w-[90px]">
              <span className={`provider-icon ${p === 'gmail' ? 'gmail-icon' : 'outlook-icon'}`}>{p === 'gmail' ? 'G' : 'O'}</span>
              {p === 'gmail' ? 'Gmail' : 'Outlook'}
            </span>
            <div className={`gmail-status ${isSaved ? 'connected' : 'disconnected'}`}>
              {isSaved ? `Saved as ${account}` : 'Not connected'}
            </div>
            {isActive
              ? <span className="active-badge">Active</span>
              : <button onClick={() => { update(ss => { ss.settings.active_mail_provider = p }); toast(`Switched to ${p === 'gmail' ? 'Gmail' : 'Outlook'}`, 'success') }}>Set active</button>}
            {isSaved
              ? <button onClick={p === 'gmail' ? disconnectGmail : disconnectOutlook}>Remove</button>
              : <button className="primary" onClick={p === 'gmail' ? connectGmail : connectOutlook}>Connect</button>}
          </div>
        )
      })}

      <h3 className="mt-6 mb-2 text-sm font-semibold">AI — email analysis</h3>
      <p className="text-lo text-[13px] m-0 mb-4">
        Paste your <strong>OpenRouter</strong> API key and pick a model. The AI reads your synced emails and suggests a hiring-stage status + comment.
      </p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3 max-w-[720px] mb-6">
        <label className="flex flex-col gap-1 text-[13px] text-lo">OpenRouter API key
          <input type="password" placeholder="sk-or-…" value={s.openrouter_key}
            onChange={e => update(ss => { ss.settings.openrouter_key = e.target.value.trim() })}
            onBlur={() => s.openrouter_key && toast('Key saved', 'success')} />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="flex flex-col gap-1 text-[13px] text-lo">Model
            {orModels.length > 0
              ? <select value={s.openrouter_model} style={{ width: 'auto' }}
                  onChange={e => { update(ss => { ss.settings.openrouter_model = e.target.value }); toast('Model saved', 'success') }}>
                  <option value="">— pick a model —</option>
                  {orModels.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              : <input readOnly value={s.openrouter_model || ''} placeholder="Click Load models first" onChange={() => {}} />
            }
          </label>
          <button onClick={fetchModels} disabled={orLoading} style={{ alignSelf: 'flex-start' }}>
            {orLoading ? 'Loading…' : 'Load models'}
          </button>
        </div>
      </div>

      <h3 className="mt-6 mb-2 text-sm font-semibold">Data management</h3>
      <div className="flex gap-2 flex-wrap pt-4 border-t border-edge">
        <button onClick={exportData}>Export JSON</button>
        <button onClick={importData}>Import JSON</button>
        <button className="danger" onClick={clearAll}>Clear all data</button>
      </div>
    </div>
  )
}
