import { useState, useCallback, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { useDialog } from '../hooks/useDialog'
import { uid } from '../utils'
import type { Template } from '../types'

type TplType = 'email' | 'cover_letter'

const PLACEHOLDER_GROUPS = [
  {
    label: 'Application',
    items: ['{{company}}', '{{role}}', '{{contact_name}}', '{{files}}'],
  },
  {
    label: 'My profile',
    items: ['{{my_name}}', '{{my_last_name}}', '{{my_full_name}}', '{{my_email}}', '{{my_phone}}', '{{my_address}}', '{{my_linkedin}}', '{{my_links}}'],
  },
]

const PREVIEW_VARS: Record<string, string> = {
  company: 'Acme Corp', role: 'Software Engineer', contact_name: 'Jane Smith', files: 'CV.pdf',
  my_name: 'John', my_last_name: 'Doe', my_full_name: 'John Doe',
  my_email: 'john@example.com', my_phone: '+1 555 000 0000',
  my_address: '123 Main St, Stockholm, 111 22, Sweden',
  my_linkedin: 'https://linkedin.com/in/johndoe',
  my_links: 'Portfolio: https://johndoe.dev',
}

function A4Preview({ text }: { text: string }) {
  const filled = text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => PREVIEW_VARS[k] ?? `{{${k}}}`)
  return (
    <div style={{ background: '#fff', color: '#111', width: '100%', padding: '10% 12%', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 11, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxShadow: '0 2px 16px rgba(0,0,0,0.35)', minHeight: 320 }}>
      {filled || <span style={{ color: '#aaa', fontStyle: 'italic' }}>Start typing in the body to see a preview…</span>}
    </div>
  )
}

function PlaceholderSidebar({ onInsert }: { onInsert: (p: string) => void }) {
  return (
    <div style={{ width: 160, flexShrink: 0, borderLeft: '1px solid var(--color-edge)', padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
      <p className="m-0 text-[11px] text-lo/60">Click to insert at cursor</p>
      {PLACEHOLDER_GROUPS.map(group => (
        <div key={group.label}>
          <div className="text-[11px] font-semibold text-lo/60 uppercase tracking-wide mb-1.5">{group.label}</div>
          <div className="flex flex-col gap-1">
            {group.items.map(p => (
              <button key={p} type="button" onClick={() => onInsert(p)}
                className="text-left text-[11px] font-mono px-2 py-1 rounded bg-raised border border-edge text-lo hover:text-hi hover:border-primary transition-colors">
                {p}
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
