import type { AppState } from './types'

const GMAIL_TOKEN_URL   = 'https://oauth2.googleapis.com/token'
const OUTLOOK_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const OUTLOOK_SCOPES    = 'openid email Mail.Read Mail.Send offline_access'
const REFRESH_BUFFER_MS = 5 * 60 * 1000   // refresh if expiring within 5 minutes
const KEEPALIVE_MS      = 45 * 60 * 1000  // proactive refresh every 45 min

// Discriminated result — we MUST know whether credentials should be wiped
type RefreshResult =
  | { ok: true;  access_token: string; refresh_token?: string; expires_in: number }
  | { ok: false; revoked: boolean }  // revoked=true → wipe; false → transient error, keep

async function fetchRefreshedToken(
  provider: 'gmail' | 'outlook',
  refreshToken: string,
): Promise<RefreshResult> {
  try {
    const params = provider === 'gmail'
      ? new URLSearchParams({
          client_id:     import.meta.env.VITE_GMAIL_CLIENT_ID,
          client_secret: import.meta.env.VITE_GMAIL_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type:    'refresh_token',
        })
      : new URLSearchParams({
          client_id:     import.meta.env.VITE_AZURE_CLIENT_ID,
          refresh_token: refreshToken,
          grant_type:    'refresh_token',
          scope:         OUTLOOK_SCOPES,
        })

    const url = provider === 'gmail' ? GMAIL_TOKEN_URL : OUTLOOK_TOKEN_URL
    const res = await fetch(url, { method: 'POST', body: params })

    if (!res.ok) {
      // Only treat 400/401 with a specific auth error code as definitively revoked.
      // 5xx, timeouts, etc. are transient — keep credentials and retry next time.
      if (res.status === 400 || res.status === 401) {
        const json = await res.json().catch(() => ({})) as { error?: string }
        const revoked = ['invalid_grant', 'unauthorized_client', 'invalid_client'].includes(json.error ?? '')
        return { ok: false, revoked }
      }
      // Transient server error — do NOT wipe credentials
      return { ok: false, revoked: false }
    }

    const json = await res.json() as {
      access_token?: string; refresh_token?: string
      expires_in?: number;   error?: string
    }
    if (json.error || !json.access_token) return { ok: false, revoked: true }

    return {
      ok:            true,
      access_token:  json.access_token,
      refresh_token: json.refresh_token,
      expires_in:    json.expires_in ?? 3600,
    }
  } catch {
    // Network error — keep credentials, will retry on next ensureToken call
    return { ok: false, revoked: false }
  }
}

// Returns a valid access token, refreshing silently if needed.
// Returns null only when the token genuinely cannot be obtained (revoked / no refresh token).
// On transient errors the existing token is returned if it hasn't expired yet, otherwise null.
export async function ensureToken(
  provider: 'gmail' | 'outlook',
  state: AppState,
  update: (fn: (s: AppState) => void) => void,
): Promise<string | null> {
  const m = state.mail[provider]
  if (!m.refresh_token) return null

  // Token still valid — return as-is
  if (m.token && m.expires_at > Date.now() + REFRESH_BUFFER_MS) return m.token

  // Attempt a silent refresh
  const result = await fetchRefreshedToken(provider, m.refresh_token)

  if (!result.ok) {
    if (result.revoked) {
      // Token definitively revoked by the provider — force re-login
      update(s => {
        s.mail[provider].token         = ''
        s.mail[provider].refresh_token = ''
        s.mail[provider].expires_at    = 0
        s.mail[provider].user_email    = ''
      })
    }
    // Transient error — return existing token if still usable, otherwise null
    return m.token && m.expires_at > Date.now() ? m.token : null
  }

  update(s => {
    s.mail[provider].token      = result.access_token
    s.mail[provider].expires_at = Date.now() + (result.expires_in - 60) * 1000
    if (result.refresh_token) s.mail[provider].refresh_token = result.refresh_token
  })

  return result.access_token
}

// Call once after app load. Sets up a recurring background refresh so tokens
// never go stale while the app is open, even if the user is idle.
export function startTokenKeepalive(
  getState: () => AppState,
  update: (fn: (s: AppState) => void) => void,
): () => void {
  const tick = () => {
    const state = getState()
    for (const provider of ['gmail', 'outlook'] as const) {
      if (state.mail[provider].refresh_token) {
        ensureToken(provider, state, update).catch(() => {})
      }
    }
  }
  const id = setInterval(tick, KEEPALIVE_MS)
  return () => clearInterval(id)
}
