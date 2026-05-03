import { useState, useEffect, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { useStore } from './store'
import Applications from './tabs/Applications'
import Leads from './tabs/Leads'
import Jobs from './tabs/Jobs'
import Templates from './tabs/Templates'
import Files from './tabs/Files'
import Settings from './tabs/Data'
import Profile from './tabs/Profile'

type Tab = 'applications' | 'leads' | 'jobs' | 'templates' | 'files' | 'profile' | 'settings'
const TABS: { id: Tab; label: string }[] = [
  { id: 'applications', label: 'Applications' },
  { id: 'leads', label: 'Leads' },
  { id: 'jobs', label: 'Find jobs' },
  { id: 'templates', label: 'Templates' },
  { id: 'files', label: 'Files' },
  { id: 'settings', label: 'Settings' },
]

function ProviderStack() {
  const { state, update, toast } = useStore()
  const active = state.settings.active_mail_provider
  const gmailSaved   = !!state.mail.gmail.user_email
  const outlookSaved = !!state.mail.outlook.user_email
  if (!gmailSaved && !outlookSaved) return null

  function toggle() {
    const next = active === 'gmail' ? 'outlook' : 'gmail'
    update(ss => { ss.settings.active_mail_provider = next })
    toast(`Switched to ${next === 'gmail' ? 'Gmail' : 'Outlook'}`, 'success')
  }

  const back      = active === 'gmail' ? 'outlook' : 'gmail'
  const backLabel  = back   === 'gmail' ? 'G' : 'O'
  const frontLabel = active === 'gmail' ? 'G' : 'O'

  return (
    <button
      onClick={toggle}
      title={`Active: ${active === 'gmail' ? 'Gmail' : 'Outlook'} — click to switch`}
      className="relative bg-transparent border-none cursor-pointer p-0 shrink-0"
      style={{ width: 30, height: 22 }}
    >
      <span className={`provider-icon ${back}-icon provider-icon-dim absolute`} style={{ top: 0, left: 8, zIndex: 0 }}>
        {backLabel}
      </span>
      <span className={`provider-icon ${active}-icon absolute`} style={{ top: 0, left: 0, zIndex: 1 }}>
        {frontLabel}
      </span>
    </button>
  )
}

function ProfileDropdown({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { state } = useStore()
  const s = state.settings
  const [open, setOpen] = useState(false)
  const connectedEmail = state.mail[s.active_mail_provider].user_email || state.mail[s.active_mail_provider === 'gmail' ? 'outlook' : 'gmail'].user_email
  const initial = s.name ? s.name[0].toUpperCase() : '?'

  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button className="w-7 h-7 rounded-full bg-primary text-[#08121c] text-[11px] font-bold flex items-center justify-center leading-none border-none cursor-pointer hover:opacity-80 transition-opacity">
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-full w-56 bg-surface border border-edge rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-edge">
            <div className="text-sm font-semibold text-hi truncate">{s.name || 'No name set'}</div>
            <div className="text-xs text-lo truncate">{connectedEmail || s.email || <span className="italic opacity-60">No account connected</span>}</div>
          </div>
          <div className="p-1">
            <button className="w-full text-left px-3 py-2 text-xs rounded hover:bg-raised transition-colors bg-transparent border-none text-lo" onClick={() => { onNavigate('profile'); setOpen(false) }}>Edit profile</button>
            <button className="w-full text-left px-3 py-2 text-xs rounded hover:bg-raised transition-colors bg-transparent border-none text-lo" onClick={() => { onNavigate('settings'); setOpen(false) }}>Settings</button>
          </div>
        </div>
      )}
    </div>
  )
}

function UpdateBanner({ pending, onInstall }: { pending: Update; onInstall: () => void }) {
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2 bg-success/10 border-b border-success/30 text-[13px]">
      <span>Update <strong>{pending.version}</strong> is available</span>
      <button className="primary text-xs px-3 py-1" onClick={onInstall}>Install &amp; restart</button>
    </div>
  )
}

export default function App() {
  const [active, setActive] = useState<Tab>('applications')
  const { state, update, toast } = useStore()
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null)
  const [installing, setInstalling] = useState(false)
  const ap = state.settings.active_mail_provider
  const activeEmail = state.mail[ap].user_email || state.mail[ap === 'gmail' ? 'outlook' : 'gmail'].user_email

  useEffect(() => {
    check().then(u => { if (u?.available) setPendingUpdate(u) }).catch(() => {})
  }, [])

  useEffect(() => {
    async function resolveEmail(provider: 'gmail' | 'outlook', token: string): Promise<string> {
      if (provider === 'gmail') {
        const r = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } })
        if (!r.ok) return ''
        const d = await r.json() as { email?: string }
        return d.email ?? ''
      } else {
        const r = await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${token}` } })
        if (!r.ok) return ''
        const d = await r.json() as { mail?: string; userPrincipalName?: string }
        return d.mail || d.userPrincipalName || ''
      }
    }

    async function syncEmail() {
      for (const provider of ['gmail', 'outlook'] as const) {
        const m = state.mail[provider]
        if (!m.token) continue
        const email = m.user_email || await resolveEmail(provider, m.token).catch(() => '')
        if (email) {
          update(s => { s.mail[provider].user_email = email; s.settings.email = email })
          break
        }
      }
    }

    syncEmail()
  }, [])

  const installUpdate = useCallback(async () => {
    if (!pendingUpdate) return
    setInstalling(true)
    try {
      await pendingUpdate.downloadAndInstall()
      await relaunch()
    } catch (e) {
      toast(`Update failed: ${(e as Error).message}`, 'error')
      setInstalling(false)
    }
  }, [pendingUpdate])

  useEffect(() => {
    const unlistenTokens = listen<{ access_token: string; refresh_token: string; expires_in: number; user_email: string; provider: string }>('oauth_tokens', (event) => {
      const d = event.payload
      const key = d.provider === 'google' ? 'gmail' : 'outlook'
      update(s => {
        s.mail[key].token = d.access_token
        s.mail[key].refresh_token = d.refresh_token
        s.mail[key].expires_at = Date.now() + (d.expires_in - 60) * 1000
        s.mail[key].user_email = d.user_email
        if (d.user_email) s.settings.email = d.user_email
      })
      toast(`Connected to ${key === 'gmail' ? 'Gmail' : 'Outlook'}`, 'success')
      setActive('settings')
    })
    const unlistenError = listen<string>('oauth_error', (event) => {
      toast(`Auth failed: ${event.payload}`, 'error')
    })

    return () => {
      unlistenTokens.then(fn => fn())
      unlistenError.then(fn => fn())
    }
  }, [])

  return (
    <div className="flex flex-col h-screen">
      {pendingUpdate && <UpdateBanner pending={pendingUpdate} onInstall={installing ? () => {} : installUpdate} />}
      <header className="px-6 py-4 border-b border-edge flex items-center gap-6 bg-surface shrink-0">
        <h1 className="m-0 text-lg font-semibold">crm-e</h1>
        <nav className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`bg-transparent border-none px-[14px] py-2 rounded-lg cursor-pointer text-sm transition-colors ${active === t.id ? 'bg-raised text-hi' : 'text-lo hover:bg-raised hover:text-hi'}`}
              onClick={() => setActive(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ProviderStack />
          {activeEmail && <span className="text-xs text-lo/70">{activeEmail}</span>}
          <ProfileDropdown onNavigate={setActive} />
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        {active === 'applications' && <Applications />}
        {active === 'leads' && <Leads />}
        <div style={{ display: active === 'jobs' ? 'block' : 'none' }}><Jobs /></div>
        {active === 'templates' && <Templates />}
        {active === 'files' && <Files />}
        {active === 'profile' && <Profile />}
        {active === 'settings' && <Settings />}
      </main>
    </div>
  )
}
