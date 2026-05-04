import type { AppState } from './types'

const GMAIL_TOKEN_URL   = 'https://oauth2.googleapis.com/token'
const OUTLOOK_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh if expiring within 5 minutes

async function fetchRefreshedToken(
  provider: 'gmail' | 'outlook',
  refreshToken: string,
): Promise<{ access_token: string; refresh_token?: string; expires_in: number } | null> {
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
        })

    const url = provider === 'gmail' ? GMAIL_TOKEN_URL : OUTLOOK_TOKEN_URL
    const res = await fetch(url, { method: 'POST', body: params })
    if (!res.ok) return null
    const json = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }
    if (json.error || !json.access_token) return null
    return { access_token: json.access_token, refresh_token: json.refresh_token, expires_in: json.expires_in ?? 3600 }
  } catch {
    return null
  }
}

// Returns a valid access token, refreshing silently if needed.
// Returns null if no refresh token exists or refresh fails (caller should prompt reconnect).
export async function ensureToken(
  provider: 'gmail' | 'outlook',
  state: AppState,
  update: (fn: (s: AppState) => void) => void,
): Promise<string | null> {
  const m = state.mail[provider]
  if (!m.refresh_token) return null

  // Token still valid — return it as-is
  if (m.token && m.expires_at > Date.now() + REFRESH_BUFFER_MS) return m.token

  // Token expired or close to expiry — refresh
  const result = await fetchRefreshedToken(provider, m.refresh_token)
  if (!result) {
    // Refresh failed (token revoked / expired) — clear everything so the UI
    // shows "Connect account" and forces the user to log in again
    update(s => {
      s.mail[provider].token         = ''
      s.mail[provider].refresh_token = ''
      s.mail[provider].expires_at    = 0
      s.mail[provider].user_email    = ''
    })
    return null
  }

  update(s => {
    s.mail[provider].token      = result.access_token
    s.mail[provider].expires_at = Date.now() + (result.expires_in - 60) * 1000
    if (result.refresh_token) s.mail[provider].refresh_token = result.refresh_token
  })

  return result.access_token
}
