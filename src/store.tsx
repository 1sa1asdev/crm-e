import { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react'
import Database from '@tauri-apps/plugin-sql'
import type { AppState } from './types'

const DB_PATH = 'sqlite:crm-data.db'
const OLD_STORAGE_KEY = 'job-crm:v1' // for one-time migration from localStorage

export const DEFAULT_STATE: AppState = {
  applications: [],
  templates: [
    {
      id: 'tpl-seed-1',
      name: 'Spontanansökan',
      subject: 'Ansökan om {{role}} hos {{company}}',
      body: `Hej {{contact_name}},\n\nJag skriver för att ansöka om tjänsten som {{role}} hos {{company}}. Jag bifogar mitt CV och personliga brev ({{files}}) för er bedömning.\n\nJag skulle gärna vilja prata om hur jag kan bidra till ert team.\n\nMed vänliga hälsningar,\n{{my_name}}`,
      type: 'email',
    },
    {
      id: 'tpl-seed-2',
      name: 'Uppföljning',
      subject: 'Uppföljning av ansökan om {{role}}',
      body: `Hej {{contact_name}},\n\nJag ville följa upp min ansökan om tjänsten som {{role}} hos {{company}} som jag skickade in tidigare.\n\nJag delar gärna med mig av ytterligare information om det skulle vara till hjälp. Ser fram emot att höra från er.\n\nMed vänliga hälsningar,\n{{my_name}}`,
      type: 'email',
    },
  ],
  files: [],
  emails: {},
  leads: [],
  imported_job_ids: [],
  filter_views: [],
  active_view_id: null,
  settings: {
    name: '', last_name: '', email: '', phone: '',
    street: '', city: '', postal_code: '', country: '',
    linkedin: '', links: [],
    active_mail_provider: 'gmail',
    openrouter_key: '', openrouter_model: '',
    compose_assist: 'context',
  },
  mail: {
    gmail:   { token: '', refresh_token: '', expires_at: 0, user_email: '' },
    outlook: { token: '', refresh_token: '', expires_at: 0, user_email: '' },
  },
}

// ── Parse + migrate raw JSON string into a valid AppState ─────────────────────

function parseState(raw: string): AppState {
  try {
    const parsed = JSON.parse(raw)
    const base = structuredClone(DEFAULT_STATE)
    const result = { ...base, ...parsed }
    result.settings = { ...base.settings, ...(parsed.settings ?? {}) }
    if (!Array.isArray(result.settings.links)) result.settings.links = []
    // migrate templates missing type field
    if (Array.isArray(result.templates)) {
      result.templates = result.templates.map((t: { type?: string }) => t.type ? t : { ...t, type: 'email' })
    }
    // migrate old flat mail structure { token, ... } → new { gmail, outlook }
    if (parsed.mail && typeof parsed.mail.token === 'string') {
      const oldProvider = parsed.settings?.email_provider === 'outlook' ? 'outlook' : 'gmail'
      result.mail = { ...base.mail, [oldProvider]: { ...base.mail[oldProvider], ...parsed.mail } }
    } else {
      result.mail = {
        gmail:   { ...base.mail.gmail,   ...(parsed.mail?.gmail   ?? {}) },
        outlook: { ...base.mail.outlook, ...(parsed.mail?.outlook ?? {}) },
      }
    }
    return result
  } catch {
    return structuredClone(DEFAULT_STATE)
  }
}

// ── SQLite helpers ────────────────────────────────────────────────────────────

let _db: Database | null = null

async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load(DB_PATH)
    await _db.execute(
      'CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, data TEXT NOT NULL)'
    )
  }
  return _db
}

async function loadState(): Promise<AppState> {
  try {
    const db = await getDb()
    const rows = await db.select<{ data: string }[]>('SELECT data FROM state WHERE id = 1')
    if (rows.length > 0 && rows[0].data) {
      return parseState(rows[0].data)
    }

    // First launch — try migrating from old localStorage data
    try {
      const oldRaw = localStorage.getItem(OLD_STORAGE_KEY)
      if (oldRaw) {
        const migrated = parseState(oldRaw)
        await db.execute(
          'INSERT OR REPLACE INTO state (id, data) VALUES (1, ?)',
          [JSON.stringify(migrated)]
        )
        localStorage.removeItem(OLD_STORAGE_KEY)
        return migrated
      }
    } catch { /* no old data, that's fine */ }

    return structuredClone(DEFAULT_STATE)
  } catch (e) {
    console.error('SQLite load failed, falling back to localStorage:', e)
    // Last-resort fallback so the app never shows blank
    try {
      const raw = localStorage.getItem(OLD_STORAGE_KEY)
      if (raw) return parseState(raw)
    } catch { /* ignore */ }
    return structuredClone(DEFAULT_STATE)
  }
}

async function saveState(state: AppState): Promise<void> {
  try {
    const db = await getDb()
    await db.execute(
      'INSERT OR REPLACE INTO state (id, data) VALUES (1, ?)',
      [JSON.stringify(state)]
    )
  } catch (e) {
    console.error('SQLite save failed:', e)
  }
}

// ── Store context ─────────────────────────────────────────────────────────────

type ToastKind = '' | 'success' | 'error'

interface StoreCtx {
  state: AppState
  update: (fn: (s: AppState) => void) => void
  toast: (msg: string, kind?: ToastKind) => void
}

const Ctx = createContext<StoreCtx>(null!)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(structuredClone(DEFAULT_STATE))
  const [loaded, setLoaded] = useState(false)

  const [toastMsg, setToastMsg] = useState('')
  const [toastKind, setToastKind] = useState<ToastKind>('')
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Load from SQLite on mount (async)
  useEffect(() => {
    loadState().then(s => {
      setState(s)
      setLoaded(true)
    })
  }, [])

  const update = useCallback((fn: (s: AppState) => void) => {
    setState(prev => {
      const next = structuredClone(prev)
      fn(next)
      saveState(next) // fire-and-forget — SQLite write is non-blocking
      return next
    })
  }, [])

  const toast = useCallback((msg: string, kind: ToastKind = '') => {
    setToastMsg(msg)
    setToastKind(kind)
    setToastVisible(true)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastVisible(false), kind === 'error' ? 5000 : 2200)
  }, [])

  if (!loaded) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--color-lo, #888)', fontSize: 14 }}>
        Laddar…
      </div>
    )
  }

  return (
    <Ctx.Provider value={{ state, update, toast }}>
      {children}
      <div className={`toast ${toastVisible ? 'show' : ''} ${toastKind}`}>{toastMsg}</div>
    </Ctx.Provider>
  )
}

export function useStore() {
  return useContext(Ctx)
}
