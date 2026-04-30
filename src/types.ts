export const STATUSES = [
  { value: 'draft',     label: 'Draft' },
  { value: 'applied',   label: 'Applied' },
  { value: 'replied',   label: 'Replied' },
  { value: 'interview', label: 'Interview' },
  { value: 'offer',     label: 'Offer' },
  { value: 'rejected',  label: 'Rejected' },
  { value: 'ghosted',   label: 'Ghosted' },
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
  created_at: string
}

export interface Template {
  id: string
  name: string
  subject: string
  body: string
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
}

export interface EmailRecord {
  id: string
  threadId: string
  date: number
  from: string
  to: string
  subject: string
  snippet: string
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
  role_keywords: string
  company_keywords: string
  statuses: string[]
}

export interface Settings {
  name: string
  email: string
  compose: 'gmail' | 'mailto'
  active_mail_provider: MailProvider
  openrouter_key: string
  openrouter_model: string
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
