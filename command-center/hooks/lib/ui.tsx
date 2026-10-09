/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Color, Elements, RenderElement, RenderSurface } from 'claude-code'

// The command center's design system. Colors are Claude Code's own theme keys,
// so every view follows the person's theme (light, dark, custom) with no
// palette of its own; glyphs are the transcript's own vocabulary (✻ ⏺ ⎿ ·).

export type Table = Elements[RenderSurface]

export const C = {
  accent: 'claude',
  text: 'text',
  muted: 'inactive',
  ok: 'success',
  bad: 'error',
  warn: 'warning',
  info: 'suggestion',
  merged: 'merged',
  plan: 'planMode',
  perm: 'permission',
} as const satisfies Record<string, Color>

export const G = {
  brand: '✻',
  dot: '●',
  ring: '○',
  half: '◐',
  ok: '✓',
  bad: '✗',
  warn: '▲',
  wait: '◆',
  sep: '·',
  branch: '⎇',
  up: '↑',
  down: '↓',
  open: '▾',
  closed: '▸',
  bullet: '⏺',
  result: '⎿',
  draft: '◇',
  merged: '⬢',
  done: '☑',
  todo: '☐',
  edit: '✎',
  arrow: '←',
  comment: '✉',
} as const

/** Green under `warnAt`, amber under `badAt`, red past it. */
export const level = (percent: number | null | undefined, warnAt = 60, badAt = 85): Color =>
  percent == null ? C.muted : percent >= badAt ? C.bad : percent >= warnAt ? C.warn : C.ok

export function kit(E: Table) {
  const { Box, Text, Button } = E

  const sep = (): RenderElement => <Text dimColor>{` ${G.sep} `}</Text>

  /** ▰▰▰▱▱▱ — a compact meter; `cells` wide. */
  const meter = (percent: number | null | undefined, cells = 10, color?: Color): RenderElement => {
    const filled = percent == null ? 0 : Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
    return (
      <Text>
        <Text color={color ?? level(percent)}>{'▰'.repeat(filled)}</Text>
        <Text dimColor>{'▱'.repeat(cells - filled)}</Text>
      </Text>
    )
  }

  /** Section title: `Title  aside` with the aside dim. */
  const title = (text: string, aside?: string): RenderElement => (
    <Box marginTop={1}>
      <Text bold>{text}</Text>
      {aside ? <Text dimColor>{`  ${aside}`}</Text> : null}
    </Box>
  )

  const empty = (text: string): RenderElement => (
    <Box paddingLeft={2}>
      <Text dimColor italic>
        {text}
      </Text>
    </Box>
  )

  /** A label: value pair on one line, label dim and padded to `width`. */
  const field = (label: string, value: RenderElement | string, width = 9): RenderElement => (
    <Box>
      <Text dimColor>{label.padEnd(width)}</Text>
      {typeof value === 'string' ? <Text wrap="truncate-end">{value}</Text> : value}
    </Box>
  )

  /** A row of plain buttons; the selected one bold in the accent color. */
  const tabs = <T extends string>(
    current: T,
    items: readonly { id: T; label: string; badge?: string }[],
    pick: (id: T) => void,
  ): RenderElement => (
    <Box flexWrap="wrap" columnGap={2}>
      {items.map((item, index) => (
        <Button
          key={`tab-${item.id}`}
          plain
          hotkey={String(index + 1)}
          label={item.badge ? `${item.label} ${item.badge}` : item.label}
          variant={item.id === current ? 'primary' : undefined}
          dimColor={item.id === current ? undefined : true}
          onPress={() => pick(item.id)}
        />
      ))}
    </Box>
  )

  return { sep, meter, title, empty, field, tabs }
}

// ---- Desktop icons: small outlined strokes (lucide-like), raw colors since an
// SVG cannot follow a theme key. The terminal gets the glyph instead.

export type IconName = 'run' | 'read' | 'write' | 'edit' | 'search' | 'web' | 'agent' | 'mcp' | 'todo' | 'plan' | 'ask' | 'tool'

const PATHS: Record<IconName, string> = {
  run: '<path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>',
  read: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  write: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  web: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20"/>',
  agent: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
  mcp: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8z"/>',
  todo: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  plan: '<path d="M3 6h18"/><path d="M3 12h12"/><path d="M3 18h7"/>',
  ask: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
}

export const GLYPH: Record<IconName, string> = {
  run: '$',
  read: '◫',
  write: '+',
  edit: '✎',
  search: '⌕',
  web: '◍',
  agent: '◆',
  mcp: '⧉',
  todo: '☑',
  plan: '≡',
  ask: '?',
  tool: '⚙',
}

export const HEX = { accent: '#D97757', ok: '#3FA66B', bad: '#D9534F', muted: '#8A8A8A', info: '#5B8DEF' } as const

/** An SVG icon, with a spinning ring around it while `isSpinning`. */
export function iconSvg(name: IconName, color: string, isSpinning = false): string {
  const ring = isSpinning
    ? `<circle cx="12" cy="12" r="11" fill="none" stroke="${HEX.accent}" stroke-width="1.5" stroke-dasharray="18 52" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite"/></circle>`
    : ''
  const scale = isSpinning ? ' transform="translate(4.8 4.8) scale(0.6)"' : ' transform="translate(2.4 2.4) scale(0.8)"'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16">${ring}<g fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${scale}>${PATHS[name]}</g></svg>`
}
