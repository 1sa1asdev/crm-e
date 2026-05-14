import { useStore } from '../store'
import { useLang } from '../hooks/useLang'
import { STATUSES } from '../types'
import type { StatusValue, Application, Lead } from '../types'

// Solid hex colors for inline tile fills
const STATUS_COLORS: Record<StatusValue, { bg: string; border: string }> = {
  draft:     { bg: '#3a4456', border: '#4a5468' },
  applied:   { bg: '#3b82f6', border: '#60a5fa' },
  replied:   { bg: '#f59e0b', border: '#fbbf24' },
  interview: { bg: '#10b981', border: '#34d399' },
  offer:     { bg: '#059669', border: '#10b981' },
  rejected:  { bg: '#ef4444', border: '#f87171' },
  ghosted:   { bg: '#4b5563', border: '#6b7280' },
}

function tileDimensions(total: number) {
  if (total <= 8)   return { size: 28, gap: 6, minH: 80 }
  if (total <= 25)  return { size: 22, gap: 5, minH: 90 }
  if (total <= 60)  return { size: 16, gap: 4, minH: 100 }
  if (total <= 120) return { size: 12, gap: 3, minH: 110 }
  return                   { size:  9, gap: 2, minH: 120 }
}

interface TileDims { size: number; gap: number; minH: number }

function Tile({ app, color, size, noCompany, noRole }: { app: Application; color: { bg: string; border: string }; size: number; noCompany: string; noRole: string }) {
  const title = `${app.company || noCompany} — ${app.role || noRole}`
  return (
    <div
      title={title}
      className="rounded-[3px] cursor-help transition-transform hover:scale-110"
      style={{ width: size, height: size, background: color.bg, border: `1px solid ${color.border}` }}
    />
  )
}

function LeadTile({ lead, size, noName }: { lead: Lead; size: number; noName: string }) {
  const title = `${lead.name || noName}${lead.company ? ` — ${lead.company}` : ''}${lead.title ? ` (${lead.title})` : ''}`
  return (
    <div
      title={title}
      className="rounded-[3px] cursor-help transition-transform hover:scale-110"
      style={{ width: size, height: size, background: '#7c3aed', border: '1px solid #a78bfa' }}
    />
  )
}

function StatusColumn({ status, apps, dims, label, empty, noCompany, noRole }: {
  status: StatusValue; apps: Application[]; dims: TileDims; label: string; empty: string; noCompany: string; noRole: string
}) {
  const color = STATUS_COLORS[status]
  return (
    <div className="flex flex-col gap-2 min-w-[110px] flex-1">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-hi">{label}</span>
        <span className="text-[11px] text-lo tabular-nums">{apps.length}</span>
      </div>
      <div
        className="flex flex-wrap content-start bg-canvas border border-edge rounded-lg p-2"
        style={{ gap: dims.gap, minHeight: dims.minH }}
      >
        {apps.length === 0
          ? <span className="text-[11px] text-lo/50 italic m-auto">{empty}</span>
          : apps.map(a => <Tile key={a.id} app={a} color={color} size={dims.size} noCompany={noCompany} noRole={noRole} />)}
      </div>
    </div>
  )
}

export default function Dashboard({ onNavigate }: { onNavigate?: (tab: 'applications' | 'leads') => void }) {
  const { state } = useStore()
  const { t, statusLabel } = useLang()
  const apps  = state.applications
  const leads = state.leads

  const byStatus: Record<StatusValue, Application[]> = {
    draft: [], applied: [], replied: [], interview: [], offer: [], rejected: [], ghosted: [],
  }
  for (const a of apps) {
    const s = (a.status as StatusValue) || 'draft'
    if (byStatus[s]) byStatus[s].push(a)
  }

  const total = apps.length
  const active = byStatus.applied.length + byStatus.replied.length + byStatus.interview.length
  const wins = byStatus.offer.length
  const closed = byStatus.rejected.length + byStatus.ghosted.length
  const successRate = total > 0 ? Math.round((wins / Math.max(total - byStatus.draft.length, 1)) * 100) : 0

  const maxColumn = Math.max(...Object.values(byStatus).map(c => c.length), leads.length, 1)
  const dims = tileDimensions(maxColumn)

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <h2 className="m-0 text-base font-semibold">{t('dash.title')}</h2>
        <span className="text-xs text-lo">{t('dash.subtitle')}</span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3 mb-6">
        <div className="bg-surface border border-edge rounded-lg px-4 py-3">
          <div className="text-[11px] text-lo uppercase tracking-wide">{t('dash.total')}</div>
          <div className="text-2xl font-bold text-hi mt-0.5 tabular-nums">{total}</div>
        </div>
        <div className="bg-surface border border-edge rounded-lg px-4 py-3">
          <div className="text-[11px] text-lo uppercase tracking-wide">{t('dash.active')}</div>
          <div className="text-2xl font-bold mt-0.5 tabular-nums" style={{ color: STATUS_COLORS.applied.bg }}>{active}</div>
        </div>
        <div className="bg-surface border border-edge rounded-lg px-4 py-3">
          <div className="text-[11px] text-lo uppercase tracking-wide">{t('dash.offers')}</div>
          <div className="text-2xl font-bold mt-0.5 tabular-nums" style={{ color: STATUS_COLORS.offer.bg }}>{wins}</div>
        </div>
        <div className="bg-surface border border-edge rounded-lg px-4 py-3">
          <div className="text-[11px] text-lo uppercase tracking-wide">{t('dash.closed')}</div>
          <div className="text-2xl font-bold mt-0.5 tabular-nums" style={{ color: STATUS_COLORS.rejected.bg }}>{closed}</div>
        </div>
        <div className="bg-surface border border-edge rounded-lg px-4 py-3">
          <div className="text-[11px] text-lo uppercase tracking-wide">{t('dash.successRate')}</div>
          <div className="text-2xl font-bold text-hi mt-0.5 tabular-nums">{successRate}%</div>
        </div>
      </div>

      {/* Applications kanban */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">{t('dash.byStatus')}</h3>
        {apps.length > 0 && onNavigate && (
          <button className="ghost text-xs px-2 py-1" onClick={() => onNavigate('applications')}>{t('dash.openApplications')}</button>
        )}
      </div>

      {apps.length === 0 ? (
        <p className="text-center text-lo p-10 bg-surface rounded-lg border border-dashed border-edge mb-8">
          {t('dash.noApplications')}
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2 mb-8">
          {STATUSES.map(s => (
            <StatusColumn
              key={s.value}
              status={s.value}
              apps={byStatus[s.value]}
              dims={dims}
              label={statusLabel(s.value)}
              empty={t('dash.empty')}
              noCompany={t('dash.noCompany')}
              noRole={t('dash.noRole')}
            />
          ))}
        </div>
      )}

      {/* Leads section */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="m-0 text-sm font-semibold">{t('dash.contacts')} <span className="text-lo font-normal text-xs">({leads.length})</span></h3>
        {leads.length > 0 && onNavigate && (
          <button className="ghost text-xs px-2 py-1" onClick={() => onNavigate('leads')}>{t('dash.openContacts')}</button>
        )}
      </div>

      {leads.length === 0 ? (
        <p className="text-center text-lo p-10 bg-surface rounded-lg border border-dashed border-edge">
          {t('dash.noContacts')}
        </p>
      ) : (
        <div
          className="flex flex-wrap bg-canvas border border-edge rounded-lg p-3"
          style={{ gap: dims.gap }}
        >
          {leads.map(l => <LeadTile key={l.id} lead={l} size={dims.size} noName={t('dash.noName')} />)}
        </div>
      )}

      {/* Legend */}
      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-[11px] text-lo">{t('dash.legend')}</span>
        {STATUSES.map(s => (
          <span key={s.value} className="flex items-center gap-1.5 text-[11px] text-lo">
            <span style={{ display: 'inline-block', width: 10, height: 10, background: STATUS_COLORS[s.value].bg, borderRadius: 2 }} />
            {statusLabel(s.value)}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-lo">
          <span style={{ display: 'inline-block', width: 10, height: 10, background: '#7c3aed', borderRadius: 2 }} />
          {t('dash.leadLegend')}
        </span>
      </div>
    </div>
  )
}
