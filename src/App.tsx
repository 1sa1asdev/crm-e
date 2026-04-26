import { useState } from 'react'

type Tab = 'applications' | 'leads' | 'jobs' | 'templates' | 'letters' | 'files' | 'data'

const TABS: Tab[] = ['applications', 'leads', 'jobs', 'templates', 'letters', 'files', 'data']

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('applications')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '24px',
        background: 'var(--surface)',
      }}>
        <h1 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>crm-e</h1>
        <nav style={{ display: 'flex', gap: '4px' }}>
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? 'var(--surface-2)' : 'transparent',
                color: activeTab === tab ? 'var(--text)' : 'var(--text-dim)',
                border: 'none',
                padding: '8px 14px',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                fontSize: '14px',
                textTransform: 'capitalize',
              }}
            >
              {tab}
            </button>
          ))}
        </nav>
      </header>

      <main style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
        <p style={{ color: 'var(--text-dim)' }}>
          {activeTab} — coming soon
        </p>
      </main>
    </div>
  )
}
