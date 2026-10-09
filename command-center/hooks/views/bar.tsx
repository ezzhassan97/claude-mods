/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { me } from '../features/session'
import { money, plural, trunc } from '../lib/fmt'
import type { Io } from '../lib/io'
import { drawBar, prFor, prLook } from './draw'

// The bar above the prompt, and nothing else there: this session's ticket,
// branches, environment, PRs, progress and usage, with the one button that
// opens the side panel. The cards of a finished task sit under Claude's reply
// (cards.tsx). Desktop draws a picture; the terminal the same facts as text.

type Table = Elements[RenderSurface]

// The desktop draws a band column about 8.25px wide (measured from screenshots of
// the app); the bar leaves room for its button.
// ponytail: a measured constant; recalibrate if the app changes its font.
const PX_PER_COLUMN = 8.25
export const barWidth = (cols: number): number => Math.max(260, Math.min(1700, Math.floor(cols * PX_PER_COLUMN)) - 110)

export async function bandView(io: Io, E: Table, surface: RenderSurface, props: { bodyColumns: number }, below: RenderElement): Promise<RenderElement> {
  const { Box, Text, Button } = E
  const Svg = surface === 'desktop' && 'Svg' in E ? (E as Elements['desktop']).Svg : null
  const [focus, env, ticket, github, usage, status] = [await io.s.focus.get(), await io.s.env.get(), await io.s.ticket.get(), await io.s.github.get(), await io.s.usage.get(), await io.s.status.get()]
  const bw = barWidth(props.bodyColumns)
  const parts: RenderElement[] = [below]

  const goal = await io.s.goal.get()
  const done = ticket?.requirements.filter(r => r.state !== 'open').length ?? 0
  const progress = ticket?.requirements.length ? { done, total: ticket.requirements.length } : goal ? { done: goal.steps.filter(x => x.done).length, total: goal.steps.length } : null
  const title = ticket?.summary ?? goal?.title ?? (me.lastPrompt || me.title)
  const open = (): void => void io.togglePane()
  parts.push(
    Svg ? (
      <Box key="bar" flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Svg width={bw} source={drawBar({ focus, env, ticket, github, usage, status, title, progress }, bw)} alt={barAlt(focus, ticket, usage)} />
        </Box>
        <Box flexShrink={0}>
          <Button key="bar-open" label="Open ▸" onPress={open} />
        </Box>
      </Box>
    ) : (
      <Box key="bar" flexDirection="column">
        <Box justifyContent="space-between">
          <Text wrap="truncate-end">
            <Text color="claude">{status === 'working' ? '◐ ' : '● '}</Text>
            <Text bold>{ticket ? `${ticket.key} ` : `${focus?.project ?? ''} `}</Text>
            <Text dimColor>{ticket ? `${ticket.status} · ` : ''}</Text>
            <Text>{trunc(title, 60)}</Text>
            {focus?.worktree ? <Text dimColor>{`  ▣ ${focus.worktree}`}</Text> : null}
            {env?.dbMode ? <Text color={env.dbMode === 'staging' ? 'warning' : 'success'}>{`  DB ${env.dbMode}`}</Text> : null}
            {progress ? <Text dimColor>{`  ${progress.done}/${progress.total}`}</Text> : null}
          </Text>
          <Button key="bar-open" plain dimColor label="open ▸" onPress={open} />
        </Box>
        {(focus?.branches ?? []).map(b => {
          const pr = prFor(b, github.focus)
          return (
            <Text key={`b-${b.root}`} wrap="truncate-end">
              <Text dimColor>{b.side === 'frontend' ? 'FE ' : b.side === 'backend' ? 'BE ' : '⎇ '}</Text>
              <Text>{b.branch ?? '(detached)'}</Text>
              <Text dimColor>{` · ${plural(b.commits, 'commit')}`}</Text>
              {b.unpushed ? <Text color="warning">{` ↑${b.unpushed}`}</Text> : null}
              <Text dimColor>{pr ? ` · ${prLook(pr).text}` : ' · no PR'}</Text>
            </Text>
          )
        })}
        <Text dimColor>{usage ? `ctx ${Math.round(usage.contextPct ?? 0)}% · ${money(usage.costUsd)}` : ''}</Text>
      </Box>
    ),
  )
  return <Box flexDirection="column">{parts}</Box>
}

function barAlt(focus: { project: string; worktree: string | null; branches: { side: string; branch: string | null; commits: number }[] } | null, ticket: { key: string; status: string; summary: string } | null, usage: { contextPct: number | null; costUsd: number | null } | null): string {
  const who = ticket ? `${ticket.key} ${ticket.status}: ${ticket.summary}` : (focus?.project ?? 'this session')
  const branches = (focus?.branches ?? []).map(b => `${b.side} ${b.branch ?? 'detached'} with ${b.commits} commits`).join('; ')
  return `${who}. ${branches}. Context ${Math.round(usage?.contextPct ?? 0)}%, ${money(usage?.costUsd)}.`
}
