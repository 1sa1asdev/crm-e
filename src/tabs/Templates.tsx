import { useState, useCallback, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { useDialog } from '../hooks/useDialog'
import { uid } from '../utils'
import type { Template } from '../types'

type TplType = 'email' | 'cover_letter'

export function linkVar(label: string) {
  return `my_link_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
}

const BASE_GROUPS: { label: string; items: { tag: string; display: string }[] }[] = [
  {
    label: 'Application',
    items: [
      { tag: '{{company}}',      display: 'Company' },
      { tag: '{{role}}',         display: 'Role' },
      { tag: '{{contact_name}}', display: 'Contact name' },
      { tag: '{{files}}',        display: 'Attached files' },
    ],
  },
  {
    label: 'My profile',
    items: [
      { tag: '{{my_name}}',      display: 'First name' },
      { tag: '{{my_last_name}}', display: 'Last name' },
      { tag: '{{my_full_name}}', display: 'Full name' },
      { tag: '{{my_email}}',     display: 'Email' },
      { tag: '{{my_phone}}',     display: 'Phone' },
      { tag: '{{my_address}}',   display: 'Address' },
      { tag: '{{my_linkedin}}',  display: 'LinkedIn' },
    ],
  },
]

function A4Preview({ text }: { text: string }) {
  const { state } = useStore()
  const s = state.settings
  const fullName = [s.name, s.last_name].filter(Boolean).join(' ')
  const address = [s.street, s.city, s.postal_code, s.country].filter(Boolean).join(', ')
  const profileEmail = s.email || state.mail.gmail.user_email || state.mail.outlook.user_email

  // Real profile data fills the preview. Application-context placeholders
  // (company / role / contact_name / files) keep sample data since there is
  // no specific application selected when previewing a template.
  const previewVars: Record<string, string> = {
    company: 'Acme Corp', role: 'Software Engineer', contact_name: 'Jane Smith', files: 'CV.pdf',
    my_name:      s.name      || '{{my_name}}',
    my_last_name: s.last_name || '{{my_last_name}}',
    my_full_name: fullName    || '{{my_full_name}}',
    my_email:     profileEmail || '{{my_email}}',
    my_phone:     s.phone     || '{{my_phone}}',
    my_address:   address     || '{{my_address}}',
    my_linkedin:  s.linkedin  || '{{my_linkedin}}',
    ...(s.links ?? []).reduce((acc, l) => {
      if (l.label && l.url) acc[linkVar(l.label)] = l.url
      return acc
    }, {} as Record<string, string>),
  }

  const filled = text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => previewVars[k] ?? `{{${k}}}`)
  const missingProfile = !s.name && !s.last_name && !s.phone && !address

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      {missingProfile && (
        <div className="text-[11px] px-2.5 py-1.5 rounded-md border border-warn/40 bg-warn/10" style={{ color: 'var(--warning, #f59e0b)' }}>
          ⚠ Your profile is empty — fill in <strong>Profile</strong> so placeholders like <code>{'{{my_name}}'}</code> render correctly.
        </div>
      )}
      <div style={{ background: '#fff', color: '#111', width: '100%', padding: '10% 12%', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 11, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxShadow: '0 2px 16px rgba(0,0,0,0.35)', minHeight: 320 }}>
        {filled || <span style={{ color: '#aaa', fontStyle: 'italic' }}>Start typing in the body to see a preview…</span>}
      </div>
    </div>
  )
}

function PlaceholderSidebar({ onInsert }: { onInsert: (p: string) => void }) {
  const { state } = useStore()
  const userLinks = (state.settings.links ?? []).filter(l => l.label && l.url)

  const groups = [
    ...BASE_GROUPS,
    ...(userLinks.length > 0 ? [{
      label: 'My links',
      items: userLinks.map(l => ({ tag: `{{${linkVar(l.label)}}}`, display: l.label })),
    }] : []),
  ]

  return (
    <div style={{ width: 160, flexShrink: 0, borderLeft: '1px solid var(--color-edge)', padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
      <p className="m-0 text-[11px] text-lo/60">Click to insert at cursor</p>
      {groups.map(group => (
        <div key={group.label}>
          <div className="text-[11px] font-semibold text-lo/60 uppercase tracking-wide mb-1.5">{group.label}</div>
          <div className="flex flex-col gap-1">
            {group.items.map(({ tag, display }) => (
              <button key={tag} type="button" onClick={() => onInsert(tag)}
                className="text-left text-[11px] px-2 py-1 rounded bg-raised border border-edge text-lo hover:text-hi hover:border-primary transition-colors">
                {display}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function TplDialog({ open, initial, tplType, onClose, onSave }: {
  open: boolean
  initial: Template | null
  tplType: TplType
  onClose: () => void
  onSave: (data: Record<string, string>) => void
}) {
  const ref = useDialog(open, onClose)
  const subjectRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const lastFocused = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const isCoverLetter = tplType === 'cover_letter'
  const [previewBody, setPreviewBody] = useState(initial?.body ?? '')

  useEffect(() => { setPreviewBody(initial?.body ?? '') }, [initial?.id])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSave(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>)
  }

  function insertPlaceholder(placeholder: string) {
    const el = lastFocused.current ?? bodyRef.current
    if (!el) return
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    el.value = el.value.slice(0, start) + placeholder + el.value.slice(end)
    el.selectionStart = el.selectionEnd = start + placeholder.length
    setPreviewBody(el.value)
    el.focus()
  }

  const dialogWidth = isCoverLetter ? 1120 : 800

  return (
    <dialog ref={ref} style={{ maxWidth: dialogWidth, width: '95vw' }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {/* Editor column */}
        <form onSubmit={handleSubmit} style={{ flex: 1, minWidth: 0 }}>
          <h3>{initial ? `Edit ${isCoverLetter ? 'cover letter' : 'email template'}` : `New ${isCoverLetter ? 'cover letter' : 'email template'}`}</h3>
          <input type="hidden" name="id" defaultValue={initial?.id ?? ''} key={initial?.id} />
          <input type="hidden" name="type" value={tplType} />
          <label>Name
            <input name="name" required placeholder={isCoverLetter ? 'General cover letter' : 'Cold outreach'} defaultValue={initial?.name ?? ''} key={`n-${initial?.id}`} />
          </label>
          {!isCoverLetter && (
            <label>Subject
              <input ref={subjectRef} name="subject" required placeholder="Application for {{role}} at {{company}}"
                defaultValue={initial?.subject ?? ''} key={`s-${initial?.id}`}
                onFocus={() => { lastFocused.current = subjectRef.current }} />
            </label>
          )}
          {isCoverLetter && <input type="hidden" name="subject" value="" />}
          <label>Body
            <textarea ref={bodyRef} name="body" rows={isCoverLetter ? 18 : 12} required
              defaultValue={initial?.body ?? ''} key={`b-${initial?.id}`}
              onFocus={() => { lastFocused.current = bodyRef.current }}
              onChange={e => setPreviewBody(e.target.value)} />
          </label>
          <menu>
            <button type="button" className="ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary">Save</button>
          </menu>
        </form>

        {/* Placeholder sidebar */}
        <PlaceholderSidebar onInsert={insertPlaceholder} />

        {/* Live A4 preview — cover letters only */}
        {isCoverLetter && (
          <div style={{ width: 320, flexShrink: 0, borderLeft: '1px solid var(--color-edge)', padding: 20, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--color-canvas)', overflowY: 'auto' }}>
            <div className="text-[11px] font-semibold text-lo/60 uppercase tracking-wide">Live preview</div>
            <div className="text-[10px] text-lo/50 -mt-1">Sample data used for placeholders</div>
            <A4Preview text={previewBody} />
          </div>
        )}
      </div>
    </dialog>
  )
}

export default function Templates() {
  const { state, update, toast } = useStore()
  const [activeTab, setActiveTab] = useState<TplType>('email')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const onClose = useCallback(() => setDialogOpen(false), [])

  const visible = state.templates.filter(t => (t.type ?? 'email') === activeTab)

  function saveTpl(data: Record<string, string>) {
    update(s => {
      if (data.id) {
        const idx = s.templates.findIndex(t => t.id === data.id)
        if (idx >= 0) s.templates[idx] = { ...s.templates[idx], ...data } as Template
      } else {
        s.templates.unshift({ ...data, id: uid('tpl') } as Template)
      }
    })
    setDialogOpen(false)
    toast('Template saved', 'success')
  }

  function deleteTpl(id: string) {
    const tpl = state.templates.find(t => t.id === id)
    if (!tpl || !confirm(`Delete template "${tpl.name}"?`)) return
    update(s => { s.templates = s.templates.filter(t => t.id !== id) })
    toast('Deleted')
  }

  const tabBtn = (id: TplType, label: string) => (
    <button key={id}
      className={`bg-transparent border-none px-4 py-2 rounded-lg cursor-pointer text-sm transition-colors ${activeTab === id ? 'bg-raised text-hi' : 'text-lo hover:bg-raised hover:text-hi'}`}
      onClick={() => setActiveTab(id)}>
      {label}
    </button>
  )

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <div className="flex gap-1">
          {tabBtn('email', 'Email templates')}
          {tabBtn('cover_letter', 'Cover letters')}
        </div>
        <button className="primary" onClick={() => { setEditing(null); setDialogOpen(true) }}>+ New</button>
      </div>

      {visible.length === 0
        ? <p className="text-center text-lo p-10 bg-surface rounded-lg border border-dashed border-edge">
            No {activeTab === 'email' ? 'email templates' : 'cover letters'} yet.
          </p>
        : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {visible.map(t => (
              <div key={t.id} className="bg-surface border border-edge rounded-lg p-[14px]">
                <h3 className="m-0 mb-1.5 text-sm font-semibold">{t.name}</h3>
                {t.subject && <div className="text-lo text-xs mb-2.5">{t.subject}</div>}
                <div className="text-[13px] text-lo max-h-[80px] overflow-hidden mb-2.5 whitespace-pre-wrap">{t.body}</div>
                <div className="flex gap-1.5">
                  <button className="px-[10px] py-1 text-xs" onClick={() => { setEditing(t); setDialogOpen(true) }}>Edit</button>
                  <button className="px-[10px] py-1 text-xs" onClick={() => deleteTpl(t.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )
      }

      <TplDialog open={dialogOpen} initial={editing} tplType={activeTab} onClose={onClose} onSave={saveTpl} />
    </div>
  )
}
