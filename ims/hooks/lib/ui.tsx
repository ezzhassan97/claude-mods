/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Color, Elements, RenderElement, RenderSurface } from 'claude-code'

// The design system, shared with the command-center pack (plugins cannot
// import across folders, so this file is a copy — keep the two in step).
// ponytail: copy, not a package; extract one if a third pack needs it.
// Colors are Claude Code's own theme keys,
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
