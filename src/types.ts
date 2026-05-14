export const STATUSES = [
  { value: 'draft',     label: 'Utkast' },
  { value: 'applied',   label: 'Ansökt' },
  { value: 'replied',   label: 'Besvarad' },
  { value: 'interview', label: 'Intervju' },
  { value: 'offer',     label: 'Erbjudande' },
  { value: 'rejected',  label: 'Avslag' },
  { value: 'ghosted',   label: 'Tystnad' },
] as const

export type StatusValue = typeof STATUSES[number]['value']
export type MailProvider = 'gmail' | 'outlook'

export interface Application {
  id: string
  company: string
  role: string
  status: StatusValue
  applied_at: string
  last_contact_at: string
  contact_name: string
  contact_email: string
  link: string
  notes: string
  source_job_id: string
  thread_ids: string[]
  sync_provider?: MailProvider
  view_id?: string
  follow_up_at?: string
  deadline?: string  // application_deadline from Arbetsförmedlingen, or user-set
  created_at: string
}

export interface Template {
  id: string
  name: string
  subject: string
  body: string
  type: 'email' | 'cover_letter'
}

export interface FileRecord {
  id: string
  label: string
  description: string
  filename: string
  data_url: string
  size: number
  type: string
  uploaded_at: string
  is_cv?: boolean   // designated CV — AI reads cv_text when drafting emails
  cv_text?: string  // extracted plain text from the CV file
}

export interface EmailRecord {
  id: string
  threadId: string
  messageId?: string   // RFC 2822 Message-ID header, used for reply threading
  date: number
  from: string
  to: string
  subject: string
  snippet: string      // short preview / fallback
  body?: string        // full plain-text body (populated after sync)
  direction: 'outgoing' | 'incoming' | 'unknown'
  classification: string
}

export interface Lead {
  id: string
  name: string
  title: string
  company: string
  email: string
  linkedin_url: string
  phone: string
  tags: string
  last_contact_at: string
  notes: string
  created_at: string
}

export interface FilterView {
  id: string
  name: string
  intention?: string  // open-ended: "what is your intention?" — fed directly to the AI
}

export interface CustomLink {
  label: string
  url: string
}

export interface Settings {
  name: string
  last_name: string
  email: string
  phone: string
  street: string
  city: string
  postal_code: string
  country: string
  linkedin: string
  links: CustomLink[]
  active_mail_provider: MailProvider
  openrouter_key: string
  openrouter_model: string
  lang?: 'en' | 'sv'
  compose_assist?: 'ai' | 'context' | 'both' | 'none'
}

export interface MailAuthState {
  token: string
  refresh_token: string
  expires_at: number
  user_email: string
}

export interface AppState {
  applications: Application[]
  templates: Template[]
  files: FileRecord[]
  emails: Record<string, EmailRecord[]>
  leads: Lead[]
  imported_job_ids: string[]
  filter_views: FilterView[]
  active_view_id: string | null
  settings: Settings
  mail: {
    gmail: MailAuthState
    outlook: MailAuthState
  }
}
