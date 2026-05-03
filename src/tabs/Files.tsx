import { useState, useCallback, useRef } from 'react'
import { useStore } from '../store'
import { useDialog } from '../hooks/useDialog'
import { uid, formatBytes } from '../utils'
import type { FileRecord } from '../types'

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = () => reject(r.error || new Error('read error'))
    r.readAsDataURL(file)
  })
}

function FileDialog({ open, initial, onClose, onSave }: {
  open: boolean
  initial: FileRecord | null
  onClose: () => void
  onSave: (record: Partial<FileRecord>, file: File | null) => void
}) {
  const ref = useDialog(open, onClose)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [info, setInfo] = useState('')
  const [infoError, setInfoError] = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) { setPendingFile(null); setInfo(''); return }
    if (f.size > 3 * 1024 * 1024) {
      setInfoError(true)
      setInfo(`${f.name} is ${formatBytes(f.size)} — max 3 MB (Outlook attachment limit)`)
      setPendingFile(null)
      e.target.value = ''
      return
    }
    setInfoError(false)
    setInfo(`${f.name} — ${formatBytes(f.size)}`)
    setPendingFile(f)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const label = (form.elements.namedItem('label') as HTMLInputElement).value.trim()
    const description = (form.elements.namedItem('description') as HTMLInputElement).value.trim()
    onSave({ id: initial?.id, label, description }, pendingFile)
  }

  return (
    <dialog ref={ref}>
      <form onSubmit={handleSubmit}>
        <h3>{initial ? 'Edit file' : 'Upload file'}</h3>
        <label>
          File
          <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.txt" onChange={handleFileChange} />
          {initial && !pendingFile && <span className="text-xs text-lo mt-1 block">{initial.filename ? `Current: ${initial.filename} (${formatBytes(initial.size)}) — pick a new file to replace` : ''}</span>}
          {info && <span className={infoError ? 'text-xs text-danger mt-1 block' : 'text-xs text-lo mt-1 block'}>{info}</span>}
        </label>
        <label>Label <span className="text-lo font-normal text-xs">(optional — defaults to filename)</span>
          <input name="label" placeholder="CV 2026" defaultValue={initial?.label ?? ''} key={initial?.id} />
        </label>
        <label>Description
          <input name="description" placeholder="Latest CV, 1 page" defaultValue={initial?.description ?? ''} key={`d-${initial?.id}`} />
        </label>
        <menu>
          <button type="button" className="ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </menu>
      </form>
    </dialog>
  )
}

export default function Files() {
  const { state, update, toast } = useStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<FileRecord | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const dropFileInput = useRef<HTMLInputElement>(null)
  const onClose = useCallback(() => setDialogOpen(false), [])

  async function saveFile(record: Partial<FileRecord>, file: File | null) {
    const existing = record.id ? state.files.find(f => f.id === record.id) ?? null : null
    if (!existing && !file) { toast('Pick a file first', 'error'); return }

    let fileData: Partial<FileRecord> = {}
    if (file) {
      try {
        const dataUrl = await readFileAsDataUrl(file)
        fileData = { filename: file.name, data_url: dataUrl, size: file.size, type: file.type || 'application/octet-stream', uploaded_at: new Date().toISOString() }
      } catch (e) { toast(`Read failed: ${(e as Error).message}`, 'error'); return }
    }

    const label = record.label || fileData.filename?.replace(/\.[^.]+$/, '') || existing?.filename?.replace(/\.[^.]+$/, '') || 'Untitled'

    update(s => {
      if (existing) {
        const idx = s.files.findIndex(f => f.id === existing.id)
        if (idx >= 0) s.files[idx] = { ...existing, ...fileData, label, description: record.description ?? existing.description }
      } else {
        s.files.unshift({ ...fileData, id: uid('file'), label, description: record.description ?? '' } as FileRecord)
      }
    })
    setDialogOpen(false)
    toast('File saved', 'success')
  }

  async function handleDroppedFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (!files.length) return
    let ok = 0
    for (const file of files) {
      if (file.size > 3 * 1024 * 1024) { toast(`${file.name} too large (max 3 MB)`, 'error'); continue }
      try {
        const dataUrl = await readFileAsDataUrl(file)
        update(s => {
          s.files.unshift({
            id: uid('file'),
            label: file.name.replace(/\.[^.]+$/, '') || file.name,
            description: '',
            filename: file.name,
            data_url: dataUrl,
            size: file.size,
            type: file.type || 'application/octet-stream',
            uploaded_at: new Date().toISOString(),
          })
        })
        ok++
      } catch { toast(`Failed to read ${file.name}`, 'error') }
    }
    if (ok) toast(`Uploaded ${ok}/${files.length}`, 'success')
  }

  function deleteFile(id: string) {
    const f = state.files.find(x => x.id === id)
    if (!f || !confirm(`Delete "${f.label || f.filename}"?`)) return
    update(s => { s.files = s.files.filter(x => x.id !== id) })
    toast('Deleted')
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <h2 className="m-0 text-base font-semibold">Standard files</h2>
        <button className="primary" onClick={() => { setEditing(null); setDialogOpen(true) }}>+ Upload file</button>
      </div>
      <p className="text-lo text-[13px] m-0 mb-4">Upload standard attachments (CV, cover letter, portfolio PDF). Stored in your browser. Download them when composing.</p>

      <div
        className={`dropzone ${dragOver ? 'dragover' : ''}`}
        onClick={() => dropFileInput.current?.click()}
        onDragEnter={e => { e.preventDefault(); setDragOver(true) }}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
        onDrop={async e => { e.preventDefault(); setDragOver(false); await handleDroppedFiles(Array.from(e.dataTransfer?.files ?? [])) }}
      >
        <div className="flex flex-col gap-1 pointer-events-none text-[13px]">
          <strong className="text-sm text-hi">Drop files here</strong>
          <span>or click <strong>+ Upload file</strong> for a form with label and description.</span>
        </div>
      </div>
      <input ref={dropFileInput} type="file" multiple hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.txt" onChange={async e => { await handleDroppedFiles(e.target.files ?? []); e.target.value = '' }} />

      {state.files.length === 0
        ? <p className="text-center text-lo p-10 bg-surface rounded-lg border border-dashed border-edge">No files uploaded yet.</p>
        : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
            {state.files.map(f => (
              <div key={f.id} className="bg-surface border border-edge rounded-lg p-[14px]">
                <h3 className="m-0 mb-1.5 text-sm font-semibold">{f.label || f.filename || 'Untitled'}<span className="text-[11px] text-lo ml-1.5">{formatBytes(f.size)}</span></h3>
                <div className="text-lo text-xs mb-2.5"><code className="bg-raised px-1.5 py-[2px] rounded text-xs font-mono">{f.filename || '—'}</code></div>
                <div className="text-[13px] text-lo max-h-[80px] overflow-hidden mb-2.5 whitespace-pre-wrap">{f.description}</div>
                <div className="flex gap-1.5">
                  {f.data_url && <a className="inline-block px-[10px] py-1 text-xs bg-raised border border-edge rounded-lg text-hi no-underline hover:bg-edge" href={f.data_url} download={f.filename || 'file'}>Download</a>}
                  <button className="px-[10px] py-1 text-xs" onClick={() => { setEditing(f); setDialogOpen(true) }}>Edit</button>
                  <button className="px-[10px] py-1 text-xs" onClick={() => deleteFile(f.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )
      }

      <FileDialog open={dialogOpen} initial={editing} onClose={onClose} onSave={saveFile} />
    </div>
  )
}
