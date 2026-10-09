// Small, pure formatting helpers. A copy of command-center's (plugins cannot
// import across folders) — keep the two in step.

export const money = (usd: number | null | undefined): string =>
  usd == null ? '—' : usd >= 100 ? `$${Math.round(usd)}` : usd >= 10 ? `$${usd.toFixed(1)}` : `$${usd.toFixed(2)}`

export const pct = (n: number | null | undefined): string => (n == null ? '—' : `${Math.round(n)}%`)

export const tokens = (n: number): string =>
  n < 1000 ? `${n}` : n < 1_000_000 ? `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k` : `${(n / 1_000_000).toFixed(1)}M`

/** "now", "4m", "3h", "2d" — how long ago `at` was. */
export function ago(at: number, now: number): string {
  const s = Math.max(0, (now - at) / 1000)
  if (s < 45) return 'now'
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  return `${Math.round(s / 86400)}d`
}

/** "8s", "1m 4s", "2h 5m". */
export function dur(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export const plural = (n: number, word: string, many = `${word}s`): string => `${n} ${n === 1 ? word : many}`

export function trunc(text: string, max: number): string {
  if (max <= 1) return text.slice(0, Math.max(0, max))
  const points = [...text]
  return points.length > max ? `${points.slice(0, max - 1).join('')}…` : text
}

export const basename = (path: string): string => path.replace(/\/+$/, '').split('/').pop() ?? path
export const dirname = (path: string): string => path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'

/** `path` relative to `root` when inside it, else `~`-shortened. */
export function rel(path: string, root: string | null, home: string | null): string {
  if (root && (path === root || path.startsWith(`${root}/`))) return path.slice(root.length + 1) || '.'
  if (home && path.startsWith(`${home}/`)) return `~/${path.slice(home.length + 1)}`
  return path
}

export const lines = (text: string | undefined): number => (text ? text.split('\n').length : 0)

/** First Jira-style key in a branch or title (IMS-2423), else null. */
export const ticketKey = (text: string): string | null => /\b([A-Z][A-Z0-9]+-\d+)\b/.exec(text)?.[1] ?? null

// Model output and other untrusted text (PR titles, comments, file names) is
// drawn on screen. Keep only what a person can see: strip escape sequences,
// control/format/private-use characters, fold whitespace, cap the length.
// Text carrying Unicode tag characters is refused: they only ever hide text.
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g
const TAGS = /[\u{E0000}-\u{E007F}]/u
const UNSEEN = /[\p{Cc}\p{Cf}\p{Cn}\p{Co}\p{Cs}\p{Variation_Selector}ᅟᅠㅤﾠ]/gu

export function clean(text: string, max = 400): string {
  if (TAGS.test(text)) return ''
  const safe = text.replace(ESCAPES, '').replace(/\s+/g, ' ').replace(UNSEEN, '').replace(/ {2,}/g, ' ').trim()
  return trunc(safe, max)
}
