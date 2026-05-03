import { createContext, useContext, useState, useCallback, useRef, ReactNode } from 'react'
import type { AppState } from './types'

const STORAGE_KEY = 'job-crm:v1'

export const DEFAULT_STATE: AppState = {
  applications: [],
  templates: [
    {
      id: 'tpl-seed-1',
      name: 'Cold application',
      subject: 'Application for {{role}} at {{company}}',
      body: `Hi {{contact_name}},\n\nI'm writing to apply for the {{role}} role at {{company}}. I've attached my CV and cover letter ({{files}}) for your consideration.\n\nI'd love the chance to talk about how I could contribute to your team.\n\nBest,\n{{my_name}}`,
      type: 'email',
    },
    {
      id: 'tpl-seed-2',
      name: 'Follow-up',
      subject: 'Following up on {{role}} application',
      body: `Hi {{contact_name}},\n\nI wanted to follow up on my application for the {{role}} position at {{company}} submitted earlier.\n\nHappy to share any additional info that would be useful. Looking forward to hearing from you.\n\nBest,\n{{my_name}}`,
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
    compose: 'gmail', active_mail_provider: 'gmail',
    openrouter_key: '', openrouter_model: '',
  },
  mail: {
    gmail:   { token: '', refresh_token: '', expires_at: 0, user_email: '' },
    outlook: { token: '', refresh_token: '', expires_at: 0, user_email: '' },
  },
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return structuredClone(DEFAULT_STATE)
    const parsed = JSON.parse(raw)
    const base = structuredClone(DEFAULT_STATE)
    const result = { ...base, ...parsed }
    // deep-merge nested objects so added fields aren't dropped
    result.settings = { ...base.settings, ...(parsed.settings ?? {}) }
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

type ToastKind = '' | 'success' | 'error'

interface StoreCtx {
  state: AppState
  update: (fn: (s: AppState) => void) => void
  toast: (msg: string, kind?: ToastKind) => void
}

const Ctx = createContext<StoreCtx>(null!)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(loadState)
  const [toastMsg, setToastMsg] = useState('')
  const [toastKind, setToastKind] = useState<ToastKind>('')
  const [toastVisible, setToastVisible] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const update = useCallback((fn: (s: AppState) => void) => {
    setState(prev => {
      const next = structuredClone(prev)
      fn(next)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
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
