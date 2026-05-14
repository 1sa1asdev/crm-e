import { useStore } from '../store'
import { translations, interpolate } from '../i18n'
import type { Lang } from '../i18n'
import type { StatusValue } from '../types'

export function useLang() {
  const { state, update } = useStore()
  const lang: Lang = ((state.settings as unknown as Record<string, unknown>).lang as Lang) ?? 'sv'

  /** Translate a key, optionally interpolating {var} tokens */
  function t(key: string, vars?: Record<string, string | number>): string {
    const map = translations[lang] as Record<string, string>
    const raw = map[key] ?? (translations['en'] as Record<string, string>)[key] ?? key
    return vars ? interpolate(raw, vars) : raw
  }

  /** Translate a status value → label in the current language */
  function statusLabel(value: StatusValue): string {
    return t(`status.${value}`)
  }

  /** Toggle between 'en' and 'sv' */
  function toggleLang() {
    const next: Lang = lang === 'sv' ? 'en' : 'sv'
    update(s => { (s.settings as unknown as Record<string, unknown>).lang = next })
  }

  return { lang, t, statusLabel, toggleLang }
}
