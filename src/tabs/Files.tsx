import { useState, useCallback, useRef } from 'react'
import { useStore } from '../store'
import { useLang } from '../hooks/useLang'
import { useDialog } from '../hooks/useDialog'
import { uid, formatBytes } from '../utils'
import type { FileRecord } from '../types'

// Extract plain text from a file's data_url.
// Supports PDF (via pdfjs-dist) and plain text files.
async function extractCvText(f: FileRecord): Promise<string> {
  if (!f.data_url) throw new Error('No file data')

  if (f.type === 'text/plain') {
    const base64 = f.data_url.split(',')[1] ?? ''
    return atob(base64)
  }

  if (f.type === 'application/pdf') {
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.mjs',
      import.meta.url,
    ).href

    const base64 = f.data_url.split(',')[1] ?? ''
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
    const pages: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map(item => ('str' in item ? item.str : '')).join(' '))
    }
    return pages.join('\n')
  }

  throw new Error('Unsupported file type — upload a PDF or plain text file')
}

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
  const { t } = useLang()
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [info, setInfo] = useState('')
  const [infoError, setInfoError] = useState(false)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) { setPendingFile(null); setInfo(''); return }
    if (f.size > 3 * 1024 * 1024) {
      setInfoError(true)
      setInfo(t('files.sizeWarn', { name: f.name, size: formatBytes(f.size) }))
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
        <h3>{initial ? t('files.dlgEdit') : t('files.dlgNew')}</h3>
        <label>
          {t('files.file')}
          <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.txt" onChange={handleFileChange} />
          {initial && !pendingFile && <span className="text-xs text-lo mt-1 block">{initial.filename ? t('files.current', { name: initial.filename, size: formatBytes(initial.size) }) : ''}</span>}
          {info && <span className={infoError ? 'text-xs text-danger mt-1 block' : 'text-xs text-lo mt-1 block'}>{info}</span>}
        </label>
        <label>{t('files.label')} <span className="text-lo font-normal text-xs">({t('files.labelHint')})</span>
          <input name="label" placeholder={t('files.phLabel')} defaultValue={initial?.label ?? ''} key={initial?.id} />
        </label>
        <label>{t('files.description')}
          <input name="description" placeholder={t('files.phDesc')} defaultValue={initial?.description ?? ''} key={`d-${initial?.id}`} />
        </label>
        <menu>
          <button type="button" className="ghost" onClick={onClose}>{t('files.cancel')}</button>
          <button type="submit" className="primary">{t('files.save')}</button>
        </menu>
      </form>
    </dialog>
  )
}

export default function Files() {
  const { state, update, toast } = useStore()
  const { t } = useLang()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<FileRecord | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [cvDragOver, setCvDragOver] = useState(false)
  const [cvLoading, setCvLoading] = useState(false)
  const dropFileInput = useRef<HTMLInputElement>(null)
  const cvFileInput = useRef<HTMLInputElement>(null)
  const onClose = useCallback(() => setDialogOpen(false), [])

  const cvFile = state.files.find(f => f.is_cv) ?? null

  // ── CV slot ────────────────────────────────────────────────────────────────

  async function uploadCv(file: File) {
    if (file.type !== 'application/pdf' && file.type !== 'text/plain') {
      toast(t('files.cvTypeError'), 'error'); return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast(t('files.cvSizeError'), 'error'); return
    }
    setCvLoading(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const record: FileRecord = {
        id: cvFile?.id ?? uid('file'),
        label: file.name.replace(/\.[^.]+$/, ''),
        description: '',
        filename: file.name,
        data_url: dataUrl,
        size: file.size,
        type: file.type,
        uploaded_at: new Date().toISOString(),
        is_cv: true,
        cv_text: '',
      }
      // Extract text before saving so the AI can use it immediately
      const text = await extractCvText(record)
      record.cv_text = text
      update(s => {
        s.files = s.files.filter(f => !f.is_cv)  // remove old CV if any
        s.files.unshift(record)
      })
      toast(t('files.cvUploaded'), 'success')
    } catch (e) {
      toast(`${t('files.cvError')} ${(e as Error).message}`, 'error')
    } finally {
      setCvLoading(false)
    }
  }

  function removeCv() {
    if (!cvFile) return
    update(s => { s.files = s.files.filter(f => !f.is_cv) })
    toast(t('files.cvRemoved'))
  }

  // ── Regular files ──────────────────────────────────────────────────────────

  async function saveFile(record: Partial<FileRecord>, file: File | null) {
    const existing = record.id ? state.files.find(f => f.id === record.id) ?? null : null
    if (!existing && !file) { toast(t('files.selectFirst'), 'error'); return }

    let fileData: Partial<FileRecord> = {}
    if (file) {
      try {
        const dataUrl = await readFileAsDataUrl(file)
        fileData = { filename: file.name, data_url: dataUrl, size: file.size, type: file.type || 'application/octet-stream', uploaded_at: new Date().toISOString() }
      } catch (e) { toast(`${t('files.readError')} ${(e as Error).message}`, 'error'); return }
    }

    const label = record.label || fileData.filename?.replace(/\.[^.]+$/, '') || existing?.filename?.replace(/\.[^.]+$/, '') || 'Namnlös'

    update(s => {
      if (existing) {
        const idx = s.files.findIndex(f => f.id === existing.id)
        if (idx >= 0) s.files[idx] = { ...existing, ...fileData, label, description: record.description ?? existing.description }
      } else {
        s.files.unshift({ ...fileData, id: uid('file'), label, description: record.description ?? '' } as FileRecord)
      }
    })
    setDialogOpen(false)
    toast(t('files.saved'), 'success')
  }

  async function handleDroppedFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (!files.length) return
    let ok = 0
    for (const file of files) {
      if (file.size > 3 * 1024 * 1024) { toast(t('files.tooLarge', { name: file.name }), 'error'); continue }
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
      } catch { toast(`${t('files.readError')} ${file.name}`, 'error') }
    }
    if (ok) toast(t('files.uploaded', { ok, total: files.length }), 'success')
  }

  function deleteFile(id: string) {
    const f = state.files.find(x => x.id === id)
    if (!f || !confirm(t('files.deleteConfirm', { name: f.label || f.filename }))) return
    update(s => { s.files = s.files.filter(x => x.id !== id) })
    toast(t('files.deleted'))
  }

  const regularFiles = state.files.filter(f => !f.is_cv)

  return (
    <div className="p-6 max-w-[1200px] mx-auto flex flex-col gap-8">

      {/* ── CV slot ── */}
      <div>
        <h2 className="m-0 text-base font-semibold mb-1">{t('files.cvTitle')}</h2>
        <p className="text-lo text-[13px] m-0 mb-4">{t('files.cvDesc')}</p>

        {cvFile ? (
          // Filled state
          <div className="flex items-center gap-4 p-4 bg-surface border border-primary/40 rounded-lg">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 shrink-0 text-primary text-lg">
              📄
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-hi truncate">{cvFile.label || cvFile.filename}</div>
              <div className="text-xs text-lo mt-0.5">{formatBytes(cvFile.size)} · {t('files.cvReady')}</div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                className="ghost text-xs px-3 py-1"
                onClick={() => cvFileInput.current?.click()}
                disabled={cvLoading}
              >
                {t('files.cvReplace')}
              </button>
              <button
                className="ghost text-xs px-3 py-1"
                style={{ color: 'var(--danger, #ef4444)' }}
                onClick={removeCv}
              >
                {t('files.cvRemove')}
              </button>
            </div>
          </div>
        ) : (
          // Empty state — drop zone
          <div
            className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed cursor-pointer transition-colors p-8 text-center
              ${cvDragOver ? 'border-primary bg-primary/5' : 'border-edge hover:border-primary/50 hover:bg-raised/50'}`}
            onClick={() => cvFileInput.current?.click()}
            onDragEnter={e => { e.preventDefault(); setCvDragOver(true) }}
            onDragOver={e => { e.preventDefault(); setCvDragOver(true) }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setCvDragOver(false) }}
            onDrop={async e => {
              e.preventDefault(); setCvDragOver(false)
              const file = e.dataTransfer.files[0]
              if (file) await uploadCv(file)
            }}
          >
            {cvLoading ? (
              <span className="text-sm text-lo">{t('files.cvExtracting')}</span>
            ) : (
              <>
                <span className="text-2xl">📄</span>
                <span className="text-sm font-medium text-hi">{t('files.cvDrop')}</span>
                <span className="text-xs text-lo">{t('files.cvHint')}</span>
              </>
            )}
          </div>
        )}

        <input
          ref={cvFileInput}
          type="file"
          hidden
          accept=".pdf,.txt"
          onChange={async e => {
            const file = e.target.files?.[0]
            if (file) await uploadCv(file)
            e.target.value = ''
          }}
        />
      </div>

      {/* ── Other files ── */}
      <div>
        <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
          <h2 className="m-0 text-base font-semibold">{t('files.title')}</h2>
          <button className="primary" onClick={() => { setEditing(null); setDialogOpen(true) }}>{t('files.upload')}</button>
        </div>
        <p className="text-lo text-[13px] m-0 mb-4">{t('files.desc')}</p>

        <div
          className={`dropzone ${dragOver ? 'dragover' : ''}`}
          onClick={() => dropFileInput.current?.click()}
          onDragEnter={e => { e.preventDefault(); setDragOver(true) }}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
          onDrop={async e => { e.preventDefault(); setDragOver(false); await handleDroppedFiles(Array.from(e.dataTransfer?.files ?? [])) }}
        >
          <div className="flex flex-col gap-1 pointer-events-none text-[13px]">
            <strong className="text-sm text-hi">{t('files.dropHere')}</strong>
            <span>{t('files.orClick')}</span>
          </div>
        </div>
        <input ref={dropFileInput} type="file" multiple hidden accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.gif,.webp,.txt" onChange={async e => { await handleDroppedFiles(e.target.files ?? []); e.target.value = '' }} />

        {regularFiles.length === 0
          ? <p className="text-center text-lo p-10 bg-surface rounded-lg border border-dashed border-edge">{t('files.noFiles')}</p>
          : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {regularFiles.map(f => (
                <div key={f.id} className="bg-surface border border-edge rounded-lg p-[14px]">
                  <h3 className="m-0 mb-1.5 text-sm font-semibold">{f.label || f.filename || 'Namnlös'}<span className="text-[11px] text-lo ml-1.5">{formatBytes(f.size)}</span></h3>
                  <div className="text-lo text-xs mb-2.5"><code className="bg-raised px-1.5 py-[2px] rounded text-xs font-mono">{f.filename || '—'}</code></div>
                  <div className="text-[13px] text-lo max-h-[80px] overflow-hidden mb-2.5 whitespace-pre-wrap">{f.description}</div>
                  <div className="flex gap-1.5">
                    {f.data_url && <a className="inline-block px-[10px] py-1 text-xs bg-raised border border-edge rounded-lg text-hi no-underline hover:bg-edge" href={f.data_url} download={f.filename || 'file'}>{t('files.download')}</a>}
                    <button className="px-[10px] py-1 text-xs" onClick={() => { setEditing(f); setDialogOpen(true) }}>{t('files.edit')}</button>
                    <button className="px-[10px] py-1 text-xs" onClick={() => deleteFile(f.id)}>{t('files.delete')}</button>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </div>

      <FileDialog open={dialogOpen} initial={editing} onClose={onClose} onSave={saveFile} />
    </div>
  )
}
