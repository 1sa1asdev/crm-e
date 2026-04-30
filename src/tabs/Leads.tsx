import { useState, useCallback } from 'react'
import { useStore } from '../store'
import { useDialog } from '../hooks/useDialog'
import { uid } from '../utils'
import type { Lead } from '../types'

function LeadDialog({ open, initial, onClose, onSave }: {
  open: boolean
  initial: Lead | null
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
        <h3>{initial ? 'Edit lead' : 'New lead'}</h3>
        <input type="hidden" name="id" defaultValue={initial?.id ?? ''} key={initial?.id} />
        <label>Name<input name="name" required defaultValue={initial?.name ?? ''} key={`n-${initial?.id}`} /></label>
        <label>Title<input name="title" placeholder="e.g. Senior Recruiter" defaultValue={initial?.title ?? ''} key={`t-${initial?.id}`} /></label>
        <label>Company<input name="company" defaultValue={initial?.company ?? ''} key={`c-${initial?.id}`} /></label>
        <label>Email<input type="email" name="email" defaultValue={initial?.email ?? ''} key={`e-${initial?.id}`} /></label>
        <label>LinkedIn URL<input type="url" name="linkedin_url" placeholder="https://linkedin.com/in/…" defaultValue={initial?.linkedin_url ?? ''} key={`l-${initial?.id}`} /></label>
        <label>Phone<input name="phone" defaultValue={initial?.phone ?? ''} key={`p-${initial?.id}`} /></label>
        <label>Tags<input name="tags" placeholder="recruiter, referral, warm" defaultValue={initial?.tags ?? ''} key={`tg-${initial?.id}`} /></label>
        <label>Last contact<input type="date" name="last_contact_at" defaultValue={initial?.last_contact_at ?? ''} key={`lc-${initial?.id}`} /></label>
        <label>Notes<textarea name="notes" rows={4} defaultValue={initial?.notes ?? ''} key={`no-${initial?.id}`} /></label>
        <menu>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </menu>
      </form>
    </dialog>
  )
}

function renderTagChips(tags: string) {
  if (!tags) return null
  const chips = tags.split(',').map(t => t.trim()).filter(Boolean)
  return <>{chips.map((t, i) => <span key={i} className="job-chip">{t}</span>)}</>
}

export default function Leads() {
  const { state, update, toast } = useStore()
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Lead | null>(null)
  const onClose = useCallback(() => setDialogOpen(false), [])

  function saveLead(data: Record<string, string>) {
    update(s => {
      if (data.id) {
        const idx = s.leads.findIndex(l => l.id === data.id)
        if (idx >= 0) s.leads[idx] = { ...s.leads[idx], ...data } as Lead
      } else {
        s.leads.unshift({ ...data, id: uid('lead'), created_at: new Date().toISOString() } as Lead)
      }
    })
    setDialogOpen(false)
    toast('Lead saved', 'success')
  }

  function deleteLead(id: string) {
    const lead = state.leads.find(l => l.id === id)
    if (!lead || !confirm(`Delete lead "${lead.name}"?`)) return
    update(s => { s.leads = s.leads.filter(l => l.id !== id) })
    toast('Deleted')
  }

  const q = search.toLowerCase()
  const rows = search
    ? state.leads.filter(l =>
        (l.name || '').toLowerCase().includes(q) ||
        (l.company || '').toLowerCase().includes(q) ||
        (l.tags || '').toLowerCase().includes(q) ||
        (l.email || '').toLowerCase().includes(q)
      )
    : state.leads

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <h2 className="m-0 text-base font-semibold">Leads</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <input type="search" placeholder="Search name, company, tag…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} />
          <button className="primary" onClick={() => { setEditing(null); setDialogOpen(true) }}>+ New lead</button>
        </div>
      </div>
      <p className="text-lo text-[13px] m-0 mb-4">People worth following up with — recruiters, hiring managers, referrals.</p>

      {rows.length === 0 ? (
        <p className="text-center text-lo p-10 bg-surface rounded-lg border border-dashed border-edge" dangerouslySetInnerHTML={{ __html: state.leads.length === 0 ? 'No leads yet. Click <strong>+ New lead</strong> to add one.' : 'No leads match your search.' }} />
      ) : (
        <table className="w-full border-collapse bg-surface rounded-lg overflow-hidden">
          <thead>
            <tr>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">Name</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">Title</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">Company</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">Email</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">LinkedIn</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">Tags</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">Last contact</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(l => (
              <tr key={l.id} className="hover:[&>td]:bg-raised transition-colors">
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{l.name}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{l.title || '—'}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{l.company || '—'}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : '—'}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{l.linkedin_url ? <a href={l.linkedin_url} target="_blank" rel="noopener">Profile ↗</a> : '—'}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{renderTagChips(l.tags) ?? '—'}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{l.last_contact_at || '—'}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">
                  <div className="flex gap-1 items-center">
                    <button className="px-2 py-1 text-xs whitespace-nowrap" onClick={() => { setEditing(l); setDialogOpen(true) }}>Edit</button>
                    <button className="px-2 py-1 text-xs whitespace-nowrap" onClick={() => deleteLead(l.id)}>Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <LeadDialog open={dialogOpen} initial={editing} onClose={onClose} onSave={saveLead} />
    </div>
  )
}
