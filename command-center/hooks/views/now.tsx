/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import { me } from '../features/live'
import { config } from '../lib/config'
import { ago, basename, dur, money, pct, tokens, trunc } from '../lib/fmt'
import { C, G, level } from '../lib/ui'
import type { View } from './pane'

// Now: this session at a glance — where it is, what it has used, what it is
// doing (tasks), who is helping (subagents), and what the guard stopped.

const AGENT_GLYPH: Record<string, { glyph: string; color: string }> = {
  running: { glyph: G.half, color: C.accent },
  pending: { glyph: G.ring, color: C.muted },
  waiting: { glyph: G.wait, color: C.warn },
  idle: { glyph: G.ring, color: C.muted },
  completed: { glyph: G.ok, color: C.ok },
  failed: { glyph: G.bad, color: C.bad },
  killed: { glyph: G.bad, color: C.muted },
}

export async function nowView({ io, E, k, cols, now }: View): Promise<RenderElement> {
  const { Box, Text } = E
  const [usage, repo, todos, agents, blocked, status, waitingFor] = await Promise.all([
    io.s.usage.get(), io.s.repo.get(), io.s.todos.get(), io.s.agents.get(), io.s.blocked.get(), io.s.status.get(), io.s.waitingFor.get(),
  ])
  const budget = config.budget
  const meterCells = Math.max(6, Math.min(16, cols - 34))

  const where = (
    <Box marginTop={1}>
      <Text bold>{basename(repo?.root ?? me.root)}</Text>
      {repo?.branch ? <Text dimColor>{`  ${G.branch} `}</Text> : null}
      {repo?.branch ? <Text>{repo.branch}</Text> : <Text dimColor>  not a git repo</Text>}
      {repo?.ahead ? <Text color={C.info}>{` ${G.up}${repo.ahead}`}</Text> : null}
      {repo?.behind ? <Text color={C.warn}>{` ${G.down}${repo.behind}`}</Text> : null}
      {repo?.dirty ? <Text color={C.warn}>{` ±${repo.dirty}`}</Text> : null}
      {repo?.base && repo.baseBehind ? <Text dimColor>{`  ${repo.base} +${repo.baseBehind} since branch`}</Text> : null}
    </Box>
  )

  const state =
    status === 'waiting' ? <Text color={C.warn} bold>{`${G.wait} waiting for you${waitingFor ? ` — ${trunc(waitingFor, cols - 20)}` : ''}`}</Text>
    : status === 'working' ? <Text color={C.accent}>{`${G.half} working`}</Text>
    : <Text dimColor>{`${G.ring} idle`}</Text>

  const meters = (
    <Box flexDirection="column" marginTop={1}>
      {k.field(
        'Context',
        <Text>
          {k.meter(usage?.contextPct, meterCells)}
          <Text color={level(usage?.contextPct)}>{`  ${pct(usage?.contextPct)}`}</Text>
          {usage?.contextTokens && usage.window ? <Text dimColor>{`  ${tokens(usage.contextTokens)} / ${tokens(usage.window)}`}</Text> : null}
        </Text>,
      )}
      {k.field(
        'Spend',
        <Text>
          {Number.isFinite(budget) && budget > 0 ? k.meter(((usage?.costUsd ?? 0) / budget) * 100, meterCells) : null}
          <Text>{`  ${money(usage?.costUsd)}`}</Text>
          {Number.isFinite(budget) && budget > 0 ? <Text dimColor>{` of ${money(budget)}`}</Text> : null}
        </Text>,
      )}
      {(usage?.limits ?? []).map(l =>
        k.field(
          l.kind === 'five_hour' ? '5h limit' : l.kind === 'seven_day' ? '7d limit' : trunc(l.kind, 8),
          <Text>
            {k.meter(l.percent, meterCells, level(l.percent, 70, 90))}
            <Text color={level(l.percent, 70, 90)}>{`  ${pct(l.percent)}`}</Text>
            {l.resetsAt ? <Text dimColor>{`  resets ${ago(now, Date.parse(l.resetsAt)).replace('now', 'soon')}`}</Text> : null}
          </Text>,
        ),
      )}
    </Box>
  )

  const done = todos.filter(t => t.status === 'completed').length
  const tasks = todos.length ? (
    <Box flexDirection="column">
      {k.title('Tasks', `${done}/${todos.length}`)}
      {todos.slice(0, 12).map((t, i) => (
        <Box key={`todo-${i}`} paddingLeft={1}>
          <Text color={t.status === 'completed' ? C.ok : t.status === 'in_progress' ? C.accent : C.muted}>
            {t.status === 'completed' ? G.done : t.status === 'in_progress' ? G.half : G.todo}
          </Text>
          <Text dimColor={t.status === 'completed'} strikethrough={t.status === 'completed'} wrap="truncate-end">
            {` ${t.status === 'in_progress' ? (t.activeForm ?? t.content) : t.content}`}
          </Text>
        </Box>
      ))}
      {todos.length > 12 ? k.empty(`+${todos.length - 12} more`) : null}
    </Box>
  ) : null

  const live = agents.filter(a => !a.endedAt)
  const recent = agents.filter(a => a.endedAt && now - a.endedAt < 15 * 60_000)
  const shown = [...live, ...recent].slice(0, 10)
  const helpers = shown.length ? (
    <Box flexDirection="column">
      {k.title('Agents', `${live.length} running${recent.length ? ` · ${recent.length} done` : ''}`)}
      {shown.map(a => {
        const look = AGENT_GLYPH[a.status] ?? { glyph: G.ring, color: C.muted }
        const stats = [a.tools ? `${a.tools} tools` : '', a.tokensOut ? `${tokens(a.tokensIn + a.tokensOut)} tok` : '', dur((a.endedAt ?? now) - a.startedAt)].filter(Boolean).join(' · ')
        return (
          <Box key={`agent-${a.id}`} flexDirection="column" paddingLeft={1}>
            <Box>
              <Text color={look.color}>{look.glyph}</Text>
              <Text bold>{` ${trunc(a.name, 18)}`}</Text>
              <Text wrap="truncate-end">{`  ${a.description}`}</Text>
            </Box>
            <Box paddingLeft={2}>
              <Text dimColor wrap="truncate-end">{`${G.result} ${stats}${a.lastTool && !a.endedAt ? ` · ${a.lastTool}` : ''}`}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  ) : null

  const guard = blocked.length ? (
    <Box flexDirection="column">
      {k.title('Guard', `${blocked.length} held`)}
      {blocked.slice(0, 4).map((b, i) => (
        <Box key={`guard-${i}`} paddingLeft={1}>
          <Text color={b.outcome === 'proceeded' ? C.ok : b.outcome === 'blocked' ? C.bad : C.warn}>
            {b.outcome === 'proceeded' ? G.ok : G.bad}
          </Text>
          <Text bold>{` ${b.rule}`}</Text>
          <Text dimColor wrap="truncate-end">{`  ${b.outcome} ${ago(b.at, now)} · ${b.command}`}</Text>
        </Box>
      ))}
    </Box>
  ) : null

  return (
    <Box flexDirection="column">
      {where}
      <Box>{state}</Box>
      {meters}
      {tasks}
      {helpers}
      {guard}
      {!tasks && !helpers ? k.empty('No tasks or agents yet — they show here as Claude works.') : null}
    </Box>
  )
}
