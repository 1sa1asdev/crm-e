import { useState, useEffect, useCallback, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { useStore } from './store'
import { useLang } from './hooks/useLang'
import { ensureToken, startTokenKeepalive } from './auth'
import Applications from './tabs/Applications'
import Leads from './tabs/Leads'
import Jobs from './tabs/Jobs'
import Templates from './tabs/Templates'
import Files from './tabs/Files'
import Settings from './tabs/Data'
import Profile from './tabs/Profile'
import Dashboard from './tabs/Dashboard'

type Tab = 'dashboard' | 'applications' | 'leads' | 'jobs' | 'templates' | 'files' | 'profile' | 'settings'
const TAB_IDS: { id: Tab; key: string }[] = [
  { id: 'dashboard',    key: 'tab.overview' },
  { id: 'applications', key: 'tab.applications' },
  { id: 'leads',        key: 'tab.contacts' },
  { id: 'jobs',         key: 'tab.findJobs' },
  { id: 'templates',    key: 'tab.templates' },
  { id: 'files',        key: 'tab.files' },
  { id: 'settings',     key: 'tab.settings' },
]

function ProviderStack() {
  const { state, update, toast } = useStore()
  const { t } = useLang()
  const active = state.settings.active_mail_provider
  const gmailSaved   = !!state.mail.gmail.user_email
  const outlookSaved = !!state.mail.outlook.user_email
  if (!gmailSaved && !outlookSaved) return null

  function toggle() {
    const next = active === 'gmail' ? 'outlook' : 'gmail'
    update(ss => { ss.settings.active_mail_provider = next })
    toast(t('auth.switchedTo', { provider: next === 'gmail' ? 'Gmail' : 'Outlook' }), 'success')
  }

  const back      = active === 'gmail' ? 'outlook' : 'gmail'
  const backLabel  = back   === 'gmail' ? 'G' : 'O'
  const frontLabel = active === 'gmail' ? 'G' : 'O'
  const providerName = active === 'gmail' ? 'Gmail' : 'Outlook'

  return (
    <button
      onClick={toggle}
      title={t('auth.switchTitle', { provider: providerName })}
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
  const { t } = useLang()
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
            <div className="text-sm font-semibold text-hi truncate">{s.name || t('header.noName')}</div>
            <div className="text-xs text-lo truncate">{connectedEmail || s.email || <span className="italic opacity-60">{t('header.noAccount')}</span>}</div>
          </div>
          <div className="p-1">
            <button className="w-full text-left px-3 py-2 text-xs rounded hover:bg-raised transition-colors bg-transparent border-none text-lo" onClick={() => { onNavigate('profile'); setOpen(false) }}>{t('header.editProfile')}</button>
            <button className="w-full text-left px-3 py-2 text-xs rounded hover:bg-raised transition-colors bg-transparent border-none text-lo" onClick={() => { onNavigate('settings'); setOpen(false) }}>{t('header.settings')}</button>
          </div>
        </div>
      )}
    </div>
  )
}

type Notif = { id: string; appId: string; msg: string; kind: 'followUp' | 'stale' | 'deadlineUrgent' | 'deadlineSoon' }

function NotificationBell({ onNavigate }: { onNavigate: (tab: 'applications', appId: string) => void }) {
  const { state } = useStore()
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Compute notifications from state
  const notifications: Notif[] = []
  const todayMs = Date.now()
  const DAY_MS = 86_400_000

  for (const app of state.applications) {
    if (app.status === 'rejected' || app.status === 'ghosted' || app.status === 'offer') continue

    // Follow-up due
    if (app.follow_up_at) {
      const due = new Date(app.follow_up_at).getTime()
      if (!Number.isNaN(due) && due <= todayMs) {
        const nid = `fu-${app.id}`
        if (!dismissed.has(nid)) {
          notifications.push({
            id: nid, appId: app.id,
            msg: t('notif.followUp', { company: app.company || app.role || '?' }),
            kind: 'followUp',
          })
        }
      }
    }

    // Stale — applied/replied with no response in 30+ days
    if (app.status === 'applied' || app.status === 'replied') {
      const ref2 = app.last_contact_at || app.applied_at
      if (ref2) {
        const refMs = new Date(ref2).getTime()
        const days = Math.floor((todayMs - refMs) / DAY_MS)
        if (!Number.isNaN(refMs) && days >= 30) {
          const nid = `stale-${app.id}`
          if (!dismissed.has(nid)) {
            notifications.push({
              id: nid, appId: app.id,
              msg: t('notif.stale', { company: app.company || app.role || '?', days: String(days) }),
              kind: 'stale',
            })
          }
        }
      }
    }

    // Deadline approaching — within 7 days
    if (app.deadline) {
      const dlMs = new Date(app.deadline).getTime()
      if (!Number.isNaN(dlMs)) {
        const daysLeft = Math.floor((dlMs - todayMs) / DAY_MS)
        if (daysLeft >= 0 && daysLeft <= 7) {
          const nid = `dl-${app.id}`
          if (!dismissed.has(nid)) {
            const company = app.company || app.role || '?'
            notifications.push({
              id: nid, appId: app.id,
              msg: daysLeft === 0
                ? t('notif.deadlineToday', { company })
                : t('notif.deadlineSoon', { company, days: String(daysLeft) }),
              kind: daysLeft <= 2 ? 'deadlineUrgent' : 'deadlineSoon',
            })
          }
        }
      }
    }
  }

  const count = notifications.length

  function dismiss(id: string) { setDismissed(prev => new Set([...prev, id])) }
  function dismissAll() { setDismissed(new Set(notifications.map(n => n.id))) }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        title={t('notif.title')}
        className="relative bg-transparent border-none cursor-pointer p-1 text-lo hover:text-hi transition-colors"
        style={{ lineHeight: 1 }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full bg-primary text-[#08121c] text-[9px] font-bold flex items-center justify-center leading-none px-[3px]">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-surface border border-edge rounded-lg shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-edge">
            <span className="text-xs font-semibold text-hi">{t('notif.title')}</span>
            {count > 0 && (
              <button className="text-[10px] text-lo hover:text-hi bg-transparent border-none cursor-pointer px-0 py-0 transition-colors" onClick={dismissAll}>
                {t('notif.dismissAll')}
              </button>
            )}
          </div>
          {count === 0
            ? <div className="px-4 py-5 text-xs text-lo text-center">{t('notif.none')}</div>
            : <ul className="max-h-72 overflow-y-auto divide-y divide-edge list-none m-0 p-0">
                {notifications.map(n => (
                  <li key={n.id} className="flex items-start gap-2 px-4 py-3">
                    <span className="mt-0.5 shrink-0 text-[13px]">
                      {n.kind === 'followUp' ? '🔔' : n.kind === 'deadlineUrgent' ? '🔴' : n.kind === 'deadlineSoon' ? '🟡' : '⏳'}
                    </span>
                    <button
                      className="flex-1 text-left text-xs text-lo hover:text-hi bg-transparent border-none cursor-pointer p-0 transition-colors"
                      onClick={() => { onNavigate('applications', n.appId); setOpen(false) }}
                    >
                      {n.msg}
                    </button>
                    <button
                      className="shrink-0 text-[10px] text-lo/50 hover:text-lo bg-transparent border-none cursor-pointer px-0 py-0 transition-colors"
                      onClick={() => dismiss(n.id)}
                      title="Dismiss"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
          }
        </div>
      )}
    </div>
  )
}

function UpdateBanner({ pending, onInstall }: { pending: Update; onInstall: () => void }) {
  const { t } = useLang()
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2 bg-success/10 border-b border-success/30 text-[13px]">
      <span dangerouslySetInnerHTML={{ __html: t('update.available', { version: pending.version ?? '' }).replace(pending.version ?? '', `<strong>${pending.version}</strong>`) }} />
      <button className="primary text-xs px-3 py-1" onClick={onInstall}>{t('update.install')}</button>
    </div>
  )
}

export default function App() {
  const [active, setActive] = useState<Tab>('dashboard')
  const [highlightAppId, setHighlightAppId] = useState<string | null>(null)
  const { state, update, toast } = useStore()
  const { t, lang, toggleLang } = useLang()
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null)
  const [installing, setInstalling] = useState(false)
  const [authChecking, setAuthChecking] = useState(true)
  const ap = state.settings.active_mail_provider
  const now = Date.now()
  // Connected = has a valid (non-expired) access token. The startup useEffect
  // attempts a silent refresh — if it fails, auth.ts wipes user_email too,
  // so user_email is only present when a real session exists.
  const gmailConnected   = !!(state.mail.gmail.token   && state.mail.gmail.expires_at   > now)
  const outlookConnected = !!(state.mail.outlook.token && state.mail.outlook.expires_at > now)
  const anyConnected = gmailConnected || outlookConnected
  const activeEmail = anyConnected
    ? (state.mail[ap].user_email || state.mail[ap === 'gmail' ? 'outlook' : 'gmail'].user_email)
    : null

  useEffect(() => {
    check().then(u => { if (u?.available) setPendingUpdate(u) }).catch(() => {})
  }, [])

  useEffect(() => {
    const providers = (['gmail', 'outlook'] as const).filter(p => state.mail[p].refresh_token)
    if (providers.length === 0) { setAuthChecking(false); return }
    Promise.all(providers.map(p => ensureToken(p, state, update).catch(() => {}))).finally(() => setAuthChecking(false))
  }, [])

  // Background token keepalive — proactively refreshes every 45 min so the
  // user never gets silently logged out while the app is open.
  useEffect(() => {
    return startTokenKeepalive(() => state, update)
  }, [])

  // Auto-ghost: if a deadline existed and 60+ days have passed since it
  // without a reply, mark the application as ghosted. Runs once on mount.
  useEffect(() => {
    const GHOST_THRESHOLD_MS = 60 * 24 * 60 * 60 * 1000
    const now = Date.now()
    const stale: string[] = []
    for (const a of state.applications) {
      if (!a.deadline) continue
      if (a.status !== 'applied' && a.status !== 'replied') continue
      const ts = new Date(a.deadline).getTime()
      if (Number.isNaN(ts)) continue
      if (now - ts > GHOST_THRESHOLD_MS) stale.push(a.id)
    }
    if (stale.length > 0) {
      update(s => {
        for (const id of stale) {
          const a = s.applications.find(x => x.id === id)
          if (a) a.status = 'ghosted'
        }
      })
      toast(stale.length === 1 ? t('autoghost.one') : t('autoghost.many', { n: stale.length }))
    }
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
      toast(`${t('update.failed')} ${(e as Error).message}`, 'error')
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
      toast(t('auth.connected', { provider: key === 'gmail' ? 'Gmail' : 'Outlook' }), 'success')
      setActive('settings')
    })
    const unlistenError = listen<string>('oauth_error', (event) => {
      toast(`${t('auth.loginFailed')} ${event.payload}`, 'error')
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
          {TAB_IDS.map(tab => (
            <button
              key={tab.id}
              className={`bg-transparent border-none px-[14px] py-2 rounded-lg cursor-pointer text-sm transition-colors ${active === tab.id ? 'bg-raised text-hi' : 'text-lo hover:bg-raised hover:text-hi'}`}
              onClick={() => setActive(tab.id)}
            >
              {t(tab.key)}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ProviderStack />
          {!authChecking && (anyConnected
            ? activeEmail && <span className="text-xs text-lo/70">{activeEmail}</span>
            : <button
                className="text-xs px-3 py-1 rounded-lg border border-edge bg-transparent text-lo hover:text-hi hover:border-primary transition-colors cursor-pointer"
                onClick={() => setActive('settings')}
              >{t('header.connectAccount')}</button>
          )}
          {/* Language toggle */}
          <button
            onClick={toggleLang}
            title={lang === 'sv' ? 'Switch to English' : 'Byt till Svenska'}
            className="text-[11px] font-semibold px-2 py-0.5 rounded border border-edge bg-transparent text-lo hover:text-hi hover:border-primary transition-colors cursor-pointer shrink-0 tabular-nums"
          >
            {lang === 'sv' ? 'EN' : 'SV'}
          </button>
          <NotificationBell onNavigate={(tab, appId) => { setActive(tab); setHighlightAppId(appId) }} />
          <ProfileDropdown onNavigate={setActive} />
        </div>
      </header>
      <main className="flex-1 overflow-y-auto">
        {active === 'dashboard' && <Dashboard onNavigate={setActive} />}
        {active === 'applications' && <Applications onNavigateSettings={() => setActive('settings')} highlightId={highlightAppId} onHighlightConsumed={() => setHighlightAppId(null)} />}
        {active === 'leads' && <Leads onNavigate={tab => setActive(tab as Tab)} />}
        <div style={{ display: active === 'jobs' ? 'block' : 'none' }}><Jobs /></div>
        {active === 'templates' && <Templates />}
        {active === 'files' && <Files />}
        {active === 'profile' && <Profile />}
        {active === 'settings' && <Settings />}
      </main>
    </div>
  )
}
