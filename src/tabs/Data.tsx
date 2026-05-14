import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { useStore, DEFAULT_STATE } from '../store'
import { useLang } from '../hooks/useLang'

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
  const { t } = useLang()
  const s = state.settings
  const [orModels, setOrModels] = useState<ORModel[]>([])
  const [orLoading, setOrLoading] = useState(false)

  async function fetchModels() {
    if (!s.openrouter_key) { toast(t('settings.noKey'), 'error'); return }
    setOrLoading(true)
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${s.openrouter_key}`,
          'HTTP-Referer': 'https://crm-e.app',
          'X-Title': 'crm-e',
        },
      })
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) { toast(t('compose.aiKeyExpired'), 'error'); return }
        const errBody = await res.json().catch(() => ({})) as { error?: { message?: string } | string }
        const errMsg = typeof errBody.error === 'object' ? errBody.error?.message : String(errBody.error ?? `HTTP ${res.status}`)
        throw new Error(errMsg ?? `HTTP ${res.status}`)
      }
      const data = await res.json() as { data: ORModel[] }
      const free = (data.data || []).filter(m => parseFloat(m.pricing.prompt) === 0 && parseFloat(m.pricing.completion) === 0)
      setOrModels(free)
      toast(t('settings.loadedModels', { n: free.length }), 'success')
    } catch (e) { toast(`${t('settings.loadFailed')} ${(e as Error).message}`, 'error') }
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
      toast(t('settings.browserOpened'))
    } catch (e) { toast(`${t('settings.outlookError')} ${(e as Error).message}`, 'error') }
  }

  // ── Gmail OAuth2 PKCE ────────────────────────────────────────────────────────
  const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
  const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send email profile'
  const GMAIL_CLIENT_ID = import.meta.env.VITE_GMAIL_CLIENT_ID
  const GMAIL_CLIENT_SECRET = import.meta.env.VITE_GMAIL_CLIENT_SECRET

  async function connectGmail() {
    if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET) { toast(t('settings.gmailError') + ' credentials not configured', 'error'); return }
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
      toast(t('settings.browserOpened'))
    } catch (e) { toast(`${t('settings.gmailError')} ${(e as Error).message}`, 'error') }
  }

  const now = Date.now()
  const gmailConnected  = !!(state.mail.gmail.token  && state.mail.gmail.expires_at  > now + 30_000)
  const outlookConnected = !!(state.mail.outlook.token && state.mail.outlook.expires_at > now + 30_000)

  function disconnectGmail() {
    update(ss => { ss.mail.gmail = { token: '', refresh_token: '', expires_at: 0, user_email: '' } })
    toast(t('settings.gmailDisconnected'))
  }
  function disconnectOutlook() {
    update(ss => { ss.mail.outlook = { token: '', refresh_token: '', expires_at: 0, user_email: '' } })
    toast(t('settings.outlookDisconnected'))
  }

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
        if (!imported.applications || !imported.templates) throw new Error(t('settings.invalidFormat'))
        update(ss => Object.assign(ss, { ...DEFAULT_STATE, ...imported }))
        toast(t('settings.imported'), 'success')
      } catch (e) { toast(`${t('settings.importFailed')} ${(e as Error).message}`, 'error') }
    }
    input.click()
  }

  function clearAll() {
    if (!confirm(t('settings.clearConfirm'))) return
    update(ss => Object.assign(ss, structuredClone(DEFAULT_STATE)))
    toast(t('settings.cleared'))
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <h2 className="m-0 text-base font-semibold">{t('settings.title')}</h2>
      </div>

      <h3 className="mt-0 mb-2 text-sm font-semibold">{t('settings.emailSync')}</h3>
      <p className="text-lo text-[13px] m-0 mb-4">{t('settings.emailSyncDesc')}</p>

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
              {isSaved ? t('settings.connected', { email: account }) : t('settings.notConnected')}
            </div>
            {isActive
              ? <span className="active-badge">{t('settings.active')}</span>
              : <button onClick={() => {
                  update(ss => { ss.settings.active_mail_provider = p })
                  toast(t('settings.switchedTo', { provider: p === 'gmail' ? 'Gmail' : 'Outlook' }), 'success')
                }}>{t('settings.setActive')}</button>}
            {isSaved
              ? <button onClick={p === 'gmail' ? disconnectGmail : disconnectOutlook}>{t('settings.disconnect')}</button>
              : <button className="primary" onClick={p === 'gmail' ? connectGmail : connectOutlook}>{t('settings.connect')}</button>}
          </div>
        )
      })}

      <h3 className="mt-6 mb-2 text-sm font-semibold">{t('settings.aiTitle')}</h3>
      <p className="text-lo text-[13px] m-0 mb-4">{t('settings.aiDesc')}</p>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3 max-w-[720px] mb-6">
        <label className="flex flex-col gap-1 text-[13px] text-lo">{t('settings.apiKey')}
          <input type="password" placeholder="sk-or-…" value={s.openrouter_key}
            onChange={e => update(ss => { ss.settings.openrouter_key = e.target.value.trim() })}
            onBlur={() => s.openrouter_key && toast(t('settings.keySaved'), 'success')} />
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="flex flex-col gap-1 text-[13px] text-lo">{t('settings.model')}
            {orModels.length > 0
              ? <select value={s.openrouter_model} style={{ width: 'auto' }}
                  onChange={e => { update(ss => { ss.settings.openrouter_model = e.target.value }); toast(t('settings.modelSaved'), 'success') }}>
                  <option value="">— {t('settings.modelFirst')} —</option>
                  {orModels.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              : <input readOnly value={s.openrouter_model || ''} placeholder={t('settings.modelFirst')} onChange={() => {}} />
            }
          </label>
          <button onClick={fetchModels} disabled={orLoading} style={{ alignSelf: 'flex-start' }}>
            {orLoading ? t('settings.loading') : t('settings.loadModels')}
          </button>
        </div>
      </div>

      <h3 className="mt-6 mb-2 text-sm font-semibold">{t('settings.composeAssist')}</h3>
      <p className="text-lo text-[13px] m-0 mb-3">{t('settings.composeAssistDesc')}</p>
      <div className="flex flex-col gap-2 mb-6">
        {(['context', 'ai', 'both', 'none'] as const).map(opt => {
          const labelKey = opt === 'none' ? 'settings.composeNone' : opt === 'ai' ? 'settings.composeAI' : opt === 'both' ? 'settings.composeBoth' : 'settings.composeContext'
          const current = s.compose_assist ?? 'context'
          return (
            <label key={opt} className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="radio"
                name="compose_assist"
                value={opt}
                checked={current === opt}
                style={{ width: 'auto', marginTop: 2 }}
                onChange={() => update(ss => { ss.settings.compose_assist = opt })}
              />
              <span className="text-[13px] text-lo leading-snug">{t(labelKey)}</span>
            </label>
          )
        })}
      </div>

      <h3 className="mt-6 mb-2 text-sm font-semibold">{t('settings.dataTitle')}</h3>
      <div className="flex gap-2 flex-wrap pt-4 border-t border-edge">
        <button onClick={exportData}>{t('settings.exportJson')}</button>
        <button onClick={importData}>{t('settings.importJson')}</button>
        <button className="danger" onClick={clearAll}>{t('settings.clearAll')}</button>
      </div>
    </div>
  )
}
