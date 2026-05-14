import { useStore } from '../store'
import { useLang } from '../hooks/useLang'

export default function Profile() {
  const { state, update, toast } = useStore()
  const { t } = useLang()
  const s = state.settings
  const connectedEmail = state.mail.gmail.user_email || state.mail.outlook.user_email

  function field(labelKey: string, key: keyof typeof s, type = 'text', placeholderKey = '') {
    return (
      <label className="flex flex-col gap-1 text-[13px] text-lo">{t(labelKey)}
        <input
          type={type}
          placeholder={placeholderKey ? t(placeholderKey) : ''}
          value={(s[key] as string) ?? ''}
          onChange={e => update(ss => { (ss.settings as unknown as Record<string, unknown>)[key] = e.target.value })}
          onBlur={() => toast(t('profile.saved'), 'success')}
        />
      </label>
    )
  }

  function addLink(label = '', url = '') {
    update(ss => {
      if (!Array.isArray(ss.settings.links)) ss.settings.links = []
      ss.settings.links.push({ label, url })
    })
  }

  function updateLink(i: number, key: 'label' | 'url', val: string) {
    update(ss => { ss.settings.links[i][key] = val })
  }

  function removeLink(i: number) {
    update(ss => { ss.settings.links.splice(i, 1) })
  }

  return (
    <div className="p-6 max-w-[720px] mx-auto">
      <h2 className="m-0 text-base font-semibold mb-1">{t('profile.title')}</h2>
      <p className="text-lo text-[13px] m-0 mb-6">{t('profile.subtitle')}</p>

      <h3 className="text-sm font-semibold mb-3 mt-0">{t('profile.personal')}</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 mb-6">
        {field('profile.firstName', 'name', 'text', 'profile.phFirst')}
        {field('profile.lastName', 'last_name', 'text', 'profile.phLast')}
        <label className="flex flex-col gap-1 text-[13px] text-lo">{t('profile.email')}
          <div className="flex items-center gap-2 px-3 py-[7px] rounded-lg border border-edge bg-raised text-lo text-[13px] min-h-[34px]">
            {connectedEmail
              ? <><span className="flex-1 truncate">{connectedEmail}</span><span className="text-[11px] text-lo/50 shrink-0"></span></>
              : <span className="text-lo/50 italic">{t('profile.noAccount')}</span>}
          </div>
        </label>
        {field('profile.phone', 'phone', 'tel', 'profile.phPhone')}
      </div>

      <h3 className="text-sm font-semibold mb-3">{t('profile.address')}</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 mb-6">
        {field('profile.street', 'street', 'text', 'profile.phStreet')}
        {field('profile.city', 'city', 'text', 'profile.phCity')}
        {field('profile.postalCode', 'postal_code', 'text', 'profile.phPostal')}
        {field('profile.country', 'country', 'text', 'profile.phCountry')}
      </div>

      <h3 className="text-sm font-semibold mb-3">{t('profile.online')}</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 mb-6">
        {field('profile.linkedin', 'linkedin', 'url', 'profile.phLinkedin')}
      </div>

      <h3 className="text-sm font-semibold mb-3">{t('profile.links')}</h3>
      <div className="flex flex-col gap-2 mb-3">
        {(s.links ?? []).map((link, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              type="text"
              placeholder={t('profile.phLinkLabel')}
              value={link.label}
              style={{ width: 160 }}
              onChange={e => updateLink(i, 'label', e.target.value)}
              onBlur={() => toast(t('profile.saved'), 'success')}
            />
            <input
              type="url"
              placeholder="https://…"
              value={link.url}
              style={{ flex: 1 }}
              onChange={e => updateLink(i, 'url', e.target.value)}
              onBlur={() => toast(t('profile.saved'), 'success')}
            />
            <button className="ghost text-xs px-2 py-1" style={{ color: 'var(--danger, #ef4444)' }} onClick={() => removeLink(i)}>✕</button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="ghost text-xs px-3 py-1" onClick={() => addLink()}>{t('profile.addLink')}</button>
        {[
          { label: 'GitHub', url: 'https://github.com/' },
          { label: 'Portfolio', url: 'https://yoursite.com' },
          { label: 'Dribbble', url: 'https://dribbble.com/' },
          { label: 'Behance', url: 'https://behance.net/' },
        ].filter(p => !(s.links ?? []).some(l => l.label === p.label)).map(p => (
          <button key={p.label} className="ghost text-xs px-3 py-1" onClick={() => addLink(p.label, p.url)}>
            + {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
