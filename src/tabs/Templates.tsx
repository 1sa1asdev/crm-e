import { useState, useCallback } from 'react'
import { useStore } from '../store'
import { useDialog } from '../hooks/useDialog'
import { uid } from '../utils'
import type { Template } from '../types'

function TplDialog({ open, initial, onClose, onSave }: {
  open: boolean
  initial: Template | null
  onClose: () => void
  onSave: (data: Record<string, string>) => void
}) {
  const ref = useDialog(open, onClose)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSave(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>)
  }

  return (
    <dialog ref={ref}>
      <form onSubmit={handleSubmit}>
        <h3>{initial ? 'Edit template' : 'New template'}</h3>
        <input type="hidden" name="id" defaultValue={initial?.id ?? ''} key={initial?.id} />
        <label>Name<input name="name" required placeholder="Cold outreach" defaultValue={initial?.name ?? ''} key={`n-${initial?.id}`} /></label>
        <label>Subject<input name="subject" required placeholder="Application for {{role}} at {{company}}" defaultValue={initial?.subject ?? ''} key={`s-${initial?.id}`} /></label>
        <label>Body<textarea name="body" rows={12} required defaultValue={initial?.body ?? ''} key={`b-${initial?.id}`} /></label>
        <menu>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </menu>
      </form>
    </dialog>
  )
}

export default function Templates() {
  const { state, update, toast } = useStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const onClose = useCallback(() => setDialogOpen(false), [])

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

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <h2 className="m-0 text-base font-semibold">Email templates</h2>
        <button className="primary" onClick={() => { setEditing(null); setDialogOpen(true) }}>+ New template</button>
      </div>
      <p className="text-lo text-[13px] m-0 mb-4">
        Use placeholders: <code className="bg-raised px-1.5 py-[2px] rounded text-xs font-mono">{'{{company}}'}</code>, <code className="bg-raised px-1.5 py-[2px] rounded text-xs font-mono">{'{{role}}'}</code>, <code className="bg-raised px-1.5 py-[2px] rounded text-xs font-mono">{'{{contact_name}}'}</code>, <code className="bg-raised px-1.5 py-[2px] rounded text-xs font-mono">{'{{my_name}}'}</code>, <code className="bg-raised px-1.5 py-[2px] rounded text-xs font-mono">{'{{files}}'}</code>
      </p>
      {state.templates.length === 0
        ? <p className="text-center text-lo p-10 bg-surface rounded-lg border border-dashed border-edge">No templates yet.</p>
        : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {state.templates.map(t => (
              <div key={t.id} className="bg-surface border border-edge rounded-lg p-[14px]">
                <h3 className="m-0 mb-1.5 text-sm font-semibold">{t.name}</h3>
                <div className="text-lo text-xs mb-2.5">{t.subject}</div>
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

      <TplDialog open={dialogOpen} initial={editing} onClose={onClose} onSave={saveTpl} />
    </div>
  )
}
