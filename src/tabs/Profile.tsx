import { useStore } from '../store'

export default function Profile() {
  const { state, update, toast } = useStore()
  const s = state.settings
  const connectedEmail = state.mail.gmail.user_email || state.mail.outlook.user_email

  function field(label: string, key: keyof typeof s, type = 'text', placeholder = '') {
    return (
      <label className="flex flex-col gap-1 text-[13px] text-lo">{label}
        <input
          type={type}
          placeholder={placeholder}
          value={(s[key] as string) ?? ''}
          onChange={e => update(ss => { (ss.settings as unknown as Record<string, unknown>)[key] = e.target.value })}
          onBlur={() => toast('Saved', 'success')}
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
      <h2 className="m-0 text-base font-semibold mb-1">Profile</h2>
      <p className="text-lo text-[13px] m-0 mb-6">Used in email templates via <code>{'{{my_name}}'}</code>, <code>{'{{my_phone}}'}</code>, <code>{'{{my_address}}'}</code>, <code>{'{{my_links}}'}</code> etc.</p>

      <h3 className="text-sm font-semibold mb-3 mt-0">Personal</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 mb-6">
        {field('First name', 'name', 'text', 'Jane')}
        {field('Last name', 'last_name', 'text', 'Doe')}
        <label className="flex flex-col gap-1 text-[13px] text-lo">Email
          <div className="flex items-center gap-2 px-3 py-[7px] rounded-lg border border-edge bg-raised text-lo text-[13px] min-h-[34px]">
            {connectedEmail
              ? <><span className="flex-1 truncate">{connectedEmail}</span><span className="text-[11px] text-lo/50 shrink-0"></span></>
              : <span className="text-lo/50 italic">No account connected — go to Settings</span>}
          </div>
        </label>
        {field('Phone', 'phone', 'tel', '+46 70 000 00 00')}
      </div>

      <h3 className="text-sm font-semibold mb-3">Address</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 mb-6">
        {field('Street', 'street', 'text', '123 Main St')}
        {field('City', 'city', 'text', 'Stockholm')}
        {field('Postal code', 'postal_code', 'text', '111 22')}
        {field('Country', 'country', 'text', 'Sweden')}
      </div>

      <h3 className="text-sm font-semibold mb-3">Online</h3>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 mb-6">
        {field('LinkedIn', 'linkedin', 'url', 'https://linkedin.com/in/jane')}
      </div>

      <h3 className="text-sm font-semibold mb-3">Custom links</h3>
      <div className="flex flex-col gap-2 mb-3">
        {(s.links ?? []).map((link, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              type="text"
              placeholder="Label (e.g. Portfolio)"
              value={link.label}
              style={{ width: 160 }}
              onChange={e => updateLink(i, 'label', e.target.value)}
              onBlur={() => toast('Saved', 'success')}
            />
            <input
              type="url"
              placeholder="https://…"
              value={link.url}
              style={{ flex: 1 }}
              onChange={e => updateLink(i, 'url', e.target.value)}
              onBlur={() => toast('Saved', 'success')}
            />
            <button className="ghost text-xs px-2 py-1" style={{ color: 'var(--danger, #ef4444)' }} onClick={() => removeLink(i)}>✕</button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="ghost text-xs px-3 py-1" onClick={() => addLink()}>+ Custom</button>
        {[
          { label: 'GitHub', url: 'https://github.com/' },
          { label: 'Portfolio', url: 'https://yoursite.com' },
          { label: 'Dribbble', url: 'https://dribbble.com/' },
          { label: 'Behance', url: 'https://behance.net/' },
        ].filter(p => !(s.links ?? []).some(l => l.label === p.label)).map(p => (
          <button key={p.label} className="ghost text-xs px-3 py-1" onClick={() => addLink(p.label, p.url)}>
            + {p.label}
          </button>
        ))}</div>
    </div>
  )
}
