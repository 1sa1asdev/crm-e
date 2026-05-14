import { useState, useCallback } from 'react'
import { useStore } from '../store'
import { useLang } from '../hooks/useLang'
import { useDialog } from '../hooks/useDialog'
import { uid } from '../utils'
import type { Lead, Application } from '../types'

function LeadDialog({ open, initial, onClose, onSave }: {
  open: boolean
  initial: Lead | null
  onClose: () => void
  onSave: (data: Record<string, string>) => void
}) {
  const ref = useDialog(open, onClose)
  const { t } = useLang()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    onSave(Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>)
  }

  return (
    <dialog ref={ref}>
      <form onSubmit={handleSubmit}>
        <h3>{initial ? t('leads.dlgEdit') : t('leads.dlgNew')}</h3>
        <input type="hidden" name="id" defaultValue={initial?.id ?? ''} key={initial?.id} />
        <label>{t('leads.name')}<input name="name" required defaultValue={initial?.name ?? ''} key={`n-${initial?.id}`} /></label>
        <label>{t('leads.titleFld')}<input name="title" placeholder="e.g. Senior Recruiter" defaultValue={initial?.title ?? ''} key={`t-${initial?.id}`} /></label>
        <label>{t('leads.company')}<input name="company" defaultValue={initial?.company ?? ''} key={`c-${initial?.id}`} /></label>
        <label>{t('leads.email')}<input type="email" name="email" defaultValue={initial?.email ?? ''} key={`e-${initial?.id}`} /></label>
        <label>{t('leads.linkedin')}<input type="url" name="linkedin_url" placeholder="https://linkedin.com/in/…" defaultValue={initial?.linkedin_url ?? ''} key={`l-${initial?.id}`} /></label>
        <label>{t('leads.phone')}<input name="phone" defaultValue={initial?.phone ?? ''} key={`p-${initial?.id}`} /></label>
        <label>{t('leads.tags')}<input name="tags" placeholder="recruiter, reference" defaultValue={initial?.tags ?? ''} key={`tg-${initial?.id}`} /></label>
        <label>{t('leads.lastContact')}<input type="date" name="last_contact_at" defaultValue={initial?.last_contact_at ?? ''} key={`lc-${initial?.id}`} /></label>
        <label>{t('leads.notes')}<textarea name="notes" rows={4} defaultValue={initial?.notes ?? ''} key={`no-${initial?.id}`} /></label>
        <menu>
          <button type="button" className="ghost" onClick={onClose}>{t('leads.cancel')}</button>
          <button type="submit" className="primary">{t('leads.save')}</button>
        </menu>
      </form>
    </dialog>
  )
}

interface BulkRow {
  name: string
  title: string
  company: string
  email: string
  linkedin_url: string
  phone: string
  tags: string
}

const EMPTY_ROW: BulkRow = { name: '', title: '', company: '', email: '', linkedin_url: '', phone: '', tags: '' }

function BulkLeadsDialog({ open, onClose, onSave }: {
  open: boolean
  onClose: () => void
  onSave: (rows: BulkRow[]) => void
}) {
  const ref = useDialog(open, onClose)
  const { t } = useLang()
  const [rows, setRows] = useState<BulkRow[]>([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }])

  function updateRow(i: number, field: keyof BulkRow, value: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))
  }

  function addRow()             { setRows(prev => [...prev, { ...EMPTY_ROW }]) }
  function removeRow(i: number) { setRows(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev) }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const valid = rows.filter(r => r.name.trim())
    if (valid.length === 0) return
    onSave(valid)
    setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }])
  }

  function handleClose() {
    setRows([{ ...EMPTY_ROW }, { ...EMPTY_ROW }, { ...EMPTY_ROW }])
    onClose()
  }

  const validCount = rows.filter(r => r.name.trim()).length

  return (
    <dialog ref={ref} style={{ maxWidth: 1100, width: '95vw', padding: 0, overflow: 'hidden' }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', padding: 0, gap: 0 }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-edge">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-hi">{t('leads.bulkTitle')}</span>
            <span className="text-xs text-lo">{t('leads.name')} *</span>
          </div>
          <button type="button" className="ghost" style={{ padding: '2px 8px', fontSize: 13 }} onClick={handleClose}>✕</button>
        </div>

        {/* Rows */}
        <div className="px-5 py-4 overflow-y-auto" style={{ maxHeight: '70vh' }}>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left text-[11px] uppercase tracking-wide text-lo font-semibold pb-2 pr-2" style={{ width: 28 }}>#</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-lo font-semibold pb-2 pr-2">{t('leads.colName')} *</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-lo font-semibold pb-2 pr-2">{t('leads.colTitle')}</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-lo font-semibold pb-2 pr-2">{t('leads.colCompany')}</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-lo font-semibold pb-2 pr-2">{t('leads.colEmail')}</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-lo font-semibold pb-2 pr-2">{t('leads.colLinkedin')}</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-lo font-semibold pb-2 pr-2">{t('leads.phone')}</th>
                <th className="text-left text-[11px] uppercase tracking-wide text-lo font-semibold pb-2 pr-2">{t('leads.colTags')}</th>
                <th className="pb-2" style={{ width: 32 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="pr-2 py-1 text-xs text-lo">{i + 1}</td>
                  <td className="pr-2 py-1"><input type="text" placeholder="Anna Andersson" value={row.name} onChange={e => updateRow(i, 'name', e.target.value)} style={{ width: '100%' }} /></td>
                  <td className="pr-2 py-1"><input type="text" placeholder="Recruiter" value={row.title} onChange={e => updateRow(i, 'title', e.target.value)} style={{ width: '100%' }} /></td>
                  <td className="pr-2 py-1"><input type="text" placeholder="Spotify" value={row.company} onChange={e => updateRow(i, 'company', e.target.value)} style={{ width: '100%' }} /></td>
                  <td className="pr-2 py-1"><input type="email" placeholder="anna@spotify.com" value={row.email} onChange={e => updateRow(i, 'email', e.target.value)} style={{ width: '100%' }} /></td>
                  <td className="pr-2 py-1"><input type="url" placeholder="linkedin.com/in/…" value={row.linkedin_url} onChange={e => updateRow(i, 'linkedin_url', e.target.value)} style={{ width: '100%' }} /></td>
                  <td className="pr-2 py-1"><input type="tel" placeholder="+46 70 …" value={row.phone} onChange={e => updateRow(i, 'phone', e.target.value)} style={{ width: '100%' }} /></td>
                  <td className="pr-2 py-1"><input type="text" placeholder="recruiter, warm" value={row.tags} onChange={e => updateRow(i, 'tags', e.target.value)} style={{ width: '100%' }} /></td>
                  <td className="py-1 text-center">
                    <button type="button" className="ghost" style={{ padding: '2px 6px', fontSize: 12, color: 'var(--danger, #ef4444)' }} onClick={() => removeRow(i)} disabled={rows.length === 1}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3">
            <button type="button" className="ghost" style={{ fontSize: 12 }} onClick={addRow}>{t('leads.addRow')}</button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-edge bg-raised/30">
          <span className="text-xs text-lo">{validCount > 0 ? t('leads.bulkValid', { n: validCount }) : `${t('leads.name')} *`}</span>
          <div className="flex gap-2">
            <button type="button" className="ghost" onClick={handleClose}>{t('leads.cancel')}</button>
            <button type="submit" className="primary" disabled={validCount === 0}>{t('leads.bulkSave', { n: validCount })}</button>
          </div>
        </div>
      </form>
    </dialog>
  )
}

function renderTagChips(tags: string) {
  if (!tags) return null
  const chips = tags.split(',').map(t => t.trim()).filter(Boolean)
  return <>{chips.map((tag, i) => <span key={i} className="job-chip">{tag}</span>)}</>
}

export default function Leads({ onNavigate }: { onNavigate?: (tab: string) => void } = {}) {
  const { state, update, toast } = useStore()
  const { t } = useLang()
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [editing, setEditing] = useState<Lead | null>(null)
  const onClose = useCallback(() => setDialogOpen(false), [])
  const onBulkClose = useCallback(() => setBulkOpen(false), [])

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
    toast(t('leads.saved'), 'success')
  }

  function saveBulkLeads(rows: BulkRow[]) {
    const now = new Date().toISOString()
    update(s => {
      for (const row of rows) {
        s.leads.unshift({
          id: uid('lead'),
          name: row.name.trim(),
          title: row.title.trim(),
          company: row.company.trim(),
          email: row.email.trim(),
          linkedin_url: row.linkedin_url.trim(),
          phone: row.phone.trim(),
          tags: row.tags.trim(),
          last_contact_at: '',
          notes: '',
          created_at: now,
        })
      }
    })
    setBulkOpen(false)
    toast(t('leads.bulkSaved', { n: rows.length }), 'success')
  }

  function deleteLead(id: string) {
    const lead = state.leads.find(l => l.id === id)
    if (!lead || !confirm(t('leads.deleteConfirm', { name: lead.name }))) return
    update(s => { s.leads = s.leads.filter(l => l.id !== id) })
    toast(t('leads.deleted'))
  }

  function convertToApplication(lead: Lead) {
    const now = new Date().toISOString()
    const app: Application = {
      id: uid('app'),
      company: lead.company || '',
      role: lead.title || '',
      status: 'draft',
      applied_at: '',
      last_contact_at: lead.last_contact_at || '',
      contact_name: lead.name || '',
      contact_email: lead.email || '',
      link: lead.linkedin_url || '',
      notes: lead.notes || '',
      source_job_id: '',
      thread_ids: [],
      created_at: now,
    }
    update(s => { s.applications.unshift(app) })
    toast(t('leads.converted'), 'success')
    if (onNavigate) onNavigate('applications')
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
        <h2 className="m-0 text-base font-semibold">{t('leads.title')}</h2>
        <div className="flex gap-2 items-center flex-wrap">
          <input type="search" placeholder={`${t('leads.colName')}, ${t('leads.colCompany')}…`} value={search} onChange={e => setSearch(e.target.value)} style={{ width: 240 }} />
          <button onClick={() => setBulkOpen(true)}>{t('leads.bulk')}</button>
          <button className="primary" onClick={() => { setEditing(null); setDialogOpen(true) }}>{t('leads.new')}</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-center text-lo p-10 bg-surface rounded-lg border border-dashed border-edge">{t('leads.noLeads')}</p>
      ) : (
        <table className="w-full border-collapse bg-surface rounded-lg overflow-hidden">
          <thead>
            <tr>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">{t('leads.colName')}</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">{t('leads.colTitle')}</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">{t('leads.colCompany')}</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">{t('leads.colEmail')}</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">{t('leads.colLinkedin')}</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">{t('leads.colTags')}</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">{t('leads.colLast')}</th>
              <th className="bg-raised text-left px-[14px] py-[10px] border-b border-edge font-semibold text-[11px] uppercase tracking-[0.5px] text-lo">{t('leads.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(l => (
              <tr key={l.id} className="hover:[&>td]:bg-raised transition-colors">
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{l.name}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{l.title || '—'}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{l.company || '—'}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : '—'}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{l.linkedin_url ? <a href={l.linkedin_url} target="_blank" rel="noopener">↗</a> : '—'}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{renderTagChips(l.tags) ?? '—'}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">{l.last_contact_at || '—'}</td>
                <td className="text-left px-[14px] py-[10px] border-b border-edge text-sm">
                  <div className="flex gap-1 items-center flex-wrap">
                    <button
                      className="px-2 py-1 text-xs whitespace-nowrap text-primary border border-primary/40 rounded hover:bg-primary/10 bg-transparent transition-colors cursor-pointer"
                      title={t('leads.toApplication')}
                      onClick={() => convertToApplication(l)}
                    >{t('leads.toApplication')}</button>
                    <button className="px-2 py-1 text-xs whitespace-nowrap" onClick={() => { setEditing(l); setDialogOpen(true) }}>{t('leads.edit')}</button>
                    <button className="px-2 py-1 text-xs whitespace-nowrap" onClick={() => deleteLead(l.id)}>{t('leads.delete')}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <LeadDialog open={dialogOpen} initial={editing} onClose={onClose} onSave={saveLead} />
      <BulkLeadsDialog open={bulkOpen} onClose={onBulkClose} onSave={saveBulkLeads} />
    </div>
  )
}
