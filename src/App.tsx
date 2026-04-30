import { useState, useEffect, useCallback } from 'react'
import { listen } from '@tauri-apps/api/event'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { useStore } from './store'
import type { MailProvider } from './types'
import Applications from './tabs/Applications'
import Leads from './tabs/Leads'
import Jobs from './tabs/Jobs'
import Templates from './tabs/Templates'
import Files from './tabs/Files'
import Data from './tabs/Data'

type Tab = 'applications' | 'leads' | 'jobs' | 'templates' | 'files' | 'data'
const TABS: { id: Tab; label: string }[] = [
  { id: 'applications', label: 'Applications' },
  { id: 'leads', label: 'Leads' },
  { id: 'jobs', label: 'Find jobs' },
  { id: 'templates', label: 'Templates' },
  { id: 'files', label: 'Files' },
  { id: 'data', label: 'Data' },
]

function MailIndicator() {
  const { state, update, toast } = useStore()
  const provider: MailProvider = state.settings.active_mail_provider
  const other: MailProvider = provider === 'gmail' ? 'outlook' : 'gmail'
  const mail = state.mail[provider]
  const connected = !!(mail.token && mail.expires_at > Date.now() + 30_000)
  const label = provider === 'gmail' ? 'Gmail' : 'Outlook'
  const otherLabel = other === 'gmail' ? 'Gmail' : 'Outlook'
  const letter = provider === 'gmail' ? 'G' : 'O'

  function switchProvider() {
    update(s => { s.settings.active_mail_provider = other })
    toast(`Switched to ${otherLabel}`, 'success')
  }

  return (
    <button
      className={`ml-auto flex items-center gap-[7px] px-[10px] pl-[6px] py-1 rounded-full border text-xs whitespace-nowrap max-w-[220px] overflow-hidden cursor-pointer transition-all ${connected ? 'bg-success/[.07] border-success/30 hover:bg-success/[.14]' : 'opacity-55 border-edge hover:opacity-80'}`}
      onClick={switchProvider}
      title={`Active: ${label}${connected ? ` (${mail.user_email})` : ' — not connected'} · Click to switch to ${otherLabel}`}
    >
      <span className={`provider-icon ${provider === 'gmail' ? 'gmail-icon' : 'outlook-icon'}`}>{letter}</span>
      <span className="overflow-hidden text-ellipsis text-lo">{connected ? mail.user_email || label : `${label} — not connected`}</span>
    </button>
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
  const { update, toast } = useStore()
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    check().then(u => { if (u?.available) setPendingUpdate(u) }).catch(() => {})
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
      })
      toast(`Connected to ${key === 'gmail' ? 'Gmail' : 'Outlook'}`, 'success')
      setActive('data')
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
        <MailIndicator />
      </header>
      <main className="flex-1 overflow-y-auto">
        {active === 'applications' && <Applications />}
        {active === 'leads' && <Leads />}
        {active === 'jobs' && <Jobs />}
        {active === 'templates' && <Templates />}
        {active === 'files' && <Files />}
        {active === 'data' && <Data />}
      </main>
    </div>
  )
}
