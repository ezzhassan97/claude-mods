// The drawing kit for the desktop. A row of separate elements wraps onto new
// lines in the desktop app, so every line here is drawn as ONE SVG and only
// real buttons sit beside it (the technique savvy-progress uses). Neutrals are
// CSS classes that switch with the system theme; accents are fixed hues that
// read on both. Pure string building, no I/O.

export const INK = {
  clay: '#D97757',
  green: '#3FA66B',
  amber: '#D4932A',
  red: '#D9534F',
  blue: '#4F8EF7',
  purple: '#9A72E8',
  teal: '#2BA89A',
  gray: '#8E8C85',
} as const

export type Ink = (typeof INK)[keyof typeof INK]

/** Every text size is scaled by this: the desktop draws SVG text larger than the app's own. */
export const FONT = 0.86

export const SANS = "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
export const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace"

const STYLE =
  '.t{fill:#1f1e1d}.s{fill:#6f6d66}.m{fill:#a3a19a}.k{fill:#e9e7df}.tile{fill:#f3f1ea}.ln{stroke:#e4e2da}.card{fill:#fbfaf6;stroke:#e2e0d7}.bar{fill:#f1efe8;stroke:#dedcd2}' +
  '@media (prefers-color-scheme: dark){.t{fill:#ecebe6}.s{fill:#a8a69f}.m{fill:#76746e}.k{fill:#34332f}.tile{fill:#262523}.ln{stroke:#33322e}.card{fill:#232220;stroke:#383733}.bar{fill:#1b1a19;stroke:#3a3935}}' +
  '.live{animation:pulse 1.4s ease-in-out infinite}@keyframes pulse{50%{opacity:.35}}' +
  '@media (prefers-reduced-motion: reduce){.live{animation:none}}'

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Width of one character in em, for the system UI font. ponytail: class table, not font metrics. */
function em(ch: string): number {
  if (ch === ' ') return 0.28
  if (/[A-Z]/.test(ch)) return ch === 'M' || ch === 'W' ? 0.86 : ch === 'I' ? 0.3 : ch === 'J' ? 0.5 : 0.68
  if (/[a-z]/.test(ch)) return 'mw'.includes(ch) ? 0.84 : 'ijl'.includes(ch) ? 0.25 : 'ftr'.includes(ch) ? 0.36 : 0.56
  if (/[0-9]/.test(ch)) return 0.6
  if (".,:;|!'`".includes(ch)) return 0.28
  if ('()[]{}'.includes(ch)) return 0.34
  if ('·•'.includes(ch)) return 0.32
  if ('-'.includes(ch)) return 0.4
  if ('…'.includes(ch)) return 0.9
  return 0.72
}

/** Rendered width of a text, in px. Monospace is exact; the UI font is estimated per character. */
export const width = (text: string, size: number, opts: { bold?: boolean; mono?: boolean } = {}): number =>
  opts.mono ? [...text].length * size * 0.61 : [...text].reduce((n, ch) => n + em(ch), 0) * size * (opts.bold ? 1.07 : 1)

/** Cut a text with an ellipsis so it fits `max` px. */
export function fit(text: string, max: number, size: number, opts: { bold?: boolean; mono?: boolean } = {}): string {
  if (width(text, size, opts) <= max) return text
  const per = width('a', size, opts)
  const n = Math.max(0, Math.floor(max / per) - 1)
  return n <= 0 ? '' : `${[...text].slice(0, n).join('').trimEnd()}…`
}

/** One piece of a line: text (class or color), a pill, a dot, or a mini bar. */
export type Seg = {
  t?: string
  cls?: 't' | 's' | 'm'
  color?: string
  bold?: boolean
  size?: number
  mono?: boolean
  pill?: string
  dot?: string
  live?: boolean
  bar?: { w: number; pct: number; color: string }
  /** This segment shrinks (ellipsis) to whatever room the line has left. */
  grow?: boolean
  gap?: number
}

function segWidth(s: Seg): number {
  const size = (s.size ?? 12.5) * FONT
  if (s.dot) return 8
  if (s.bar) return s.bar.w
  const w = width(s.t ?? '', size, s)
  return s.pill ? w + 12 : w
}

function drawSeg(s: Seg, x: number, y: number, text: string): string {
  const size = (s.size ?? 12.5) * FONT
  if (s.dot) return `<circle cx="${x + 4}" cy="${y - size * 0.32}" r="3.6" fill="${s.dot}"${s.live ? ' class="live"' : ''}/>`
  if (s.bar) {
    const fill = Math.max(0, Math.min(1, s.bar.pct)) * s.bar.w
    const by = y - size * 0.4
    return `<rect class="k" x="${x}" y="${by}" width="${s.bar.w}" height="5" rx="2.5"/>` + (fill > 0 ? `<rect x="${x}" y="${by}" width="${Math.max(5, fill)}" height="5" rx="2.5" fill="${s.bar.color}"/>` : '')
  }
  const font = `font-family="${s.mono ? MONO : SANS}" font-size="${size}"${s.bold ? ' font-weight="600"' : ''}`
  if (s.pill) {
    const w = width(text, size, s) + 12
    return (
      `<rect x="${x}" y="${y - size * 0.92}" width="${w}" height="${size * 1.3}" rx="${size * 0.65}" fill="${s.pill}" fill-opacity=".16"/>` +
      `<text x="${x + 6}" y="${y}" ${font} fill="${s.pill}">${esc(text)}</text>`
    )
  }
  const paint = s.color ? `fill="${s.color}"` : `class="${s.cls ?? 't'}"`
  return `<text x="${x}" y="${y}" ${font} ${paint} font-variant-numeric="tabular-nums">${esc(text)}</text>`
}

/** A vertical stack of drawn lines, sized to `w` px; `svg()` closes it. */
export type Icon = 'play' | 'bulb' | 'next' | 'bookmark' | 'shield' | 'trash'

const ICON: Record<Icon, string> = {
  play: '<path d="M9 7.5v9l7.5-4.5z" fill="currentColor" stroke="none"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.9 1 1 1.6V16h5v-.5c.1-.6.5-1.2 1-1.6A6 6 0 0 0 12 3z"/>',
  next: '<path d="M5 12h12"/><path d="M13 7l5 5-5 5"/>',
  bookmark: '<path d="M7 4h10v16l-5-3.5L7 20z"/><path d="M12 8v5"/><path d="M9.5 10.5h5"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/><path d="M12 8v5"/><path d="M12 16h.01"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
}

/** A card: framed background, an icon badge on the left, content beside it. */
export type Frame = { icon: Icon; ink: string; bare?: boolean } | { bar: true }

export class Canvas {
  private parts: string[] = []
  y = 0
  readonly pad: number
  constructor(readonly w: number, pad = 0, private readonly frame?: Frame) {
    this.pad = frame && 'icon' in frame ? 54 : pad
  }



  space(h: number): this {
    this.y += h
    return this
  }

  /** Left segments flow from the left, right segments hug the right edge. */
  line(left: Seg[], right: Seg[] = [], h = 22): this {
    const base = this.y + h * 0.7
    const gapOf = (s: Seg): number => s.gap ?? 7
    const rightW = right.reduce((n, s, i) => n + segWidth(s) + (i ? gapOf(s) : 0), 0)
    let room = this.w - this.pad - this.rpad - (right.length ? rightW + 14 : 0)
    const fixed = left.filter(s => !s.grow).reduce((n, s, i) => n + segWidth(s) + (i ? gapOf(s) : 0), 0)
    const growers = left.filter(s => s.grow)
    const each = growers.length ? Math.max(0, (room - fixed - growers.length * 7) / growers.length) : 0
    let x = this.pad
    for (const [i, s] of left.entries()) {
      if (i) x += gapOf(s)
      const size = (s.size ?? 12.5) * FONT
      const text = s.grow ? fit(s.t ?? '', each - (s.pill ? 12 : 0), size, s) : (s.t ?? '')
      if (s.grow && !text) continue
      const shown = { ...s, t: text }
      if (x + segWidth(shown) > this.pad + room + 1 && !s.grow) break
      this.parts.push(drawSeg(shown, x, base, text))
      x += segWidth(shown)
    }
    room = 0
    let rx = this.w - this.rpad - rightW
    for (const [i, s] of right.entries()) {
      if (i) rx += gapOf(s)
      this.parts.push(drawSeg(s, rx, base, s.t ?? ''))
      rx += segWidth(s)
    }
    this.y += h
    return this
  }

  /** Small caps section label with an optional dim aside. */
  label(text: string, aside = '', color?: string): this {
    const base = this.y + 13
    this.parts.push(`<text x="${this.pad}" y="${base}" font-family="${SANS}" font-size="${10.5 * FONT}" font-weight="600" letter-spacing=".7" ${color ? `fill="${color}"` : 'class="s"'}>${esc(text.toUpperCase())}</text>`)
    if (aside) this.parts.push(`<text x="${this.w - this.rpad}" y="${base}" text-anchor="end" font-family="${SANS}" font-size="${11 * FONT}" class="m">${esc(aside)}</text>`)
    this.y += 20
    return this
  }

  /** Stat tiles in a row: muted label over a large value. */
  tiles(items: { label: string; value: string; color?: string }[]): this {
    const gap = 8
    const tw = (this.w - this.pad - this.rpad - gap * (items.length - 1)) / items.length
    items.forEach((it, i) => {
      const x = this.pad + i * (tw + gap)
      this.parts.push(
        `<rect class="tile" x="${x}" y="${this.y}" width="${tw}" height="46" rx="9"/>` +
          `<text x="${x + 11}" y="${this.y + 17}" font-family="${SANS}" font-size="${10.5 * FONT}" class="s">${esc(it.label)}</text>` +
          `<text x="${x + 11}" y="${this.y + 37}" font-family="${SANS}" font-size="${16 * FONT}" font-weight="600" ${it.color ? `fill="${it.color}"` : 'class="t"'} font-variant-numeric="tabular-nums">${esc(fit(it.value, tw - 18, 16 * FONT, { bold: true }))}</text>`,
      )
    })
    this.y += 54
    return this
  }

  /** A full-width progress bar with an optional label above it. */
  progress(pct: number, color: string, h = 6): this {
    const w = this.w - this.pad - this.rpad
    const fill = Math.max(0, Math.min(1, pct)) * w
    this.parts.push(`<rect class="k" x="${this.pad}" y="${this.y}" width="${w}" height="${h}" rx="${h / 2}"/>`)
    if (fill > 0) this.parts.push(`<rect x="${this.pad}" y="${this.y}" width="${Math.max(h, fill)}" height="${h}" rx="${h / 2}" fill="${color}"/>`)
    this.y += h + 8
    return this
  }

  rule(): this {
    this.parts.push(`<line class="ln" x1="${this.pad}" x2="${this.w - this.rpad}" y1="${this.y + 6}" y2="${this.y + 6}" stroke-width="1"/>`)
    this.y += 12
    return this
  }

  /** Wrapped text, up to `lines` lines, with an optional colored bullet. */
  text(body: string, opts: { cls?: 't' | 's' | 'm'; color?: string; size?: number; lines?: number; bullet?: string; indent?: number; reserve?: number } = {}): this {
    const size = (opts.size ?? 12.5) * FONT
    const indent = (opts.indent ?? 0) + (opts.bullet ? 14 : 0)
    const max = this.w - this.pad - this.rpad - indent - (opts.reserve ?? 0)
    const words = body.split(/\s+/).filter(Boolean)
    const out: string[] = []
    let cur = ''
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word
      if (width(next, size) > max && cur) {
        out.push(cur)
        cur = word
      } else cur = next
    }
    if (cur) out.push(cur)
    const limit = opts.lines ?? 3
    const shown = out.slice(0, limit)
    if (out.length > limit && shown.length) shown[shown.length - 1] = fit(`${shown[shown.length - 1]} …`, max, size)
    shown.forEach((l, i) => {
      const base = this.y + size * 1.1 + i * size * 1.45
      if (i === 0 && opts.bullet) this.parts.push(`<circle cx="${this.pad + (opts.indent ?? 0) + 4}" cy="${base - size * 0.33}" r="2.6" fill="${opts.bullet}"/>`)
      this.parts.push(`<text x="${this.pad + indent}" y="${base}" font-family="${SANS}" font-size="${size}" ${opts.color ? `fill="${opts.color}"` : `class="${opts.cls ?? 't'}"`}>${esc(l)}</text>`)
    })
    this.y += shown.length * size * 1.45 + 4
    return this
  }

  /** Raw SVG drawn at the current y, `h` tall. */
  /** Markup drawn where it says, without moving down (a rail beside rows already drawn). */
  overlay(markup: string): this {
    this.parts.push(markup)
    return this
  }

  raw(markup: string, h: number): this {
    this.parts.push(`<g transform="translate(0 ${this.y})">${markup}</g>`)
    this.y += h
    return this
  }

  /** Right padding: framed cards keep 14px, bare drawings their own pad. */
  get rpad(): number {
    return this.frame ? 14 : this.pad
  }

  svg(): string {
    // an icon badge (cy 28, r 15) needs 46px, however short the content
    const h = Math.ceil(this.frame && 'icon' in this.frame ? Math.max(this.y, 46) : this.y)
    let back = ''
    if (this.frame && 'icon' in this.frame) {
      const { icon, ink, bare } = this.frame
      back =
        (bare ? '' : `<rect class="card" x=".5" y=".5" width="${this.w - 1}" height="${h - 1}" rx="12" stroke-width="1"/>`) +
        `<circle cx="27" cy="28" r="15" fill="${ink}" fill-opacity=".15"/>` +
        `<g transform="translate(16.5 17.5) scale(.875)" fill="none" stroke="${ink}" color="${ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[icon]}</g>`
    } else if (this.frame) {
      back = `<rect class="bar" x=".5" y=".5" width="${this.w - 1}" height="${h - 1}" rx="10" stroke-width="1"/>`
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${h}" viewBox="0 0 ${this.w} ${h}"><style>${STYLE}</style>${back}${this.parts.join('')}</svg>`
  }

  get height(): number {
    return Math.ceil(this.y)
  }
}

/** Status color for a Jira status name. */
export function statusInk(status: string, category = ''): string {
  const s = status.toLowerCase()
  if (category === 'done' || /deploy|done|closed|resolved/.test(s)) return INK.green
  if (/returned|reopen|block|fail/.test(s)) return INK.red
  if (/uat|test/.test(s)) return INK.amber
  if (/review/.test(s)) return INK.blue
  if (category === 'indeterminate' || /progress/.test(s)) return INK.clay
  return INK.gray
}

/** Green → amber → red as a percentage climbs. */
export const loadInk = (pct: number | null | undefined, warnAt = 60, badAt = 85): string =>
  pct == null ? INK.gray : pct >= badAt ? INK.red : pct >= warnAt ? INK.amber : INK.green
