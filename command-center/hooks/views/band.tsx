/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import { me } from '../features/live'
import { take } from '../features/next'
import { attention } from '../features/prs'
import { config } from '../lib/config'
import { money, pct } from '../lib/fmt'
import type { Io } from '../lib/io'
import { C, G, kit, level } from '../lib/ui'
import type { Table } from '../lib/ui'

// The band above the prompt: one compact status line (branch, context, cost,
// tasks, agents, PRs, sessions that need you) and, after a turn, the
// next-step suggestions. Whatever other plugins draw there (the built-in
// "You should know" notes, the IMS environment line) stays above it.

export async function bandView(io: Io, E: Table, props: { isWorking: boolean; bodyColumns: number }, below: RenderElement, open: () => void): Promise<RenderElement> {
  const { Box, Text, Button } = E
  const k = kit(E)
  const usage = await io.s.usage.get()
  const repo = await io.s.repo.get()
  const todos = await io.s.todos.get()
  const agents = await io.s.agents.get()
  const prs = await io.s.prs.get()
  const sessions = await io.s.sessions.get()
  const steps = await io.s.steps.get()
  const cols = props.bodyColumns

  const parts: RenderElement[] = []
  const add = (part: RenderElement): void => {
    if (parts.length) parts.push(k.sep())
    parts.push(part)
  }

  add(<Text color={C.accent}>{G.brand}</Text>)
  if (repo?.branch) {
    add(
      <Text>
        <Text>{repo.branch}</Text>
        {repo.ahead ? <Text color={C.info}>{` ${G.up}${repo.ahead}`}</Text> : null}
        {repo.behind ? <Text color={C.warn}>{` ${G.down}${repo.behind}`}</Text> : null}
        {repo.dirty ? <Text color={C.warn}>{` ±${repo.dirty}`}</Text> : null}
      </Text>,
    )
  }
  if (usage?.contextPct != null) {
    add(
      <Text>
        <Text dimColor>ctx </Text>
        {cols >= 70 ? k.meter(usage.contextPct, 5) : null}
        <Text color={level(usage.contextPct)}>{` ${pct(usage.contextPct)}`}</Text>
      </Text>,
    )
  }
  if (usage?.costUsd != null) {
    const spent = config.budget > 0 ? (usage.costUsd / config.budget) * 100 : null
    add(<Text color={spent == null ? C.muted : level(spent, 50, 90)}>{money(usage.costUsd)}</Text>)
  }
  const done = todos.filter(t => t.status === 'completed').length
  if (todos.length) add(<Text color={done === todos.length ? C.ok : C.text}>{`${G.done} ${done}/${todos.length}`}</Text>)
  const running = agents.filter(a => !a.endedAt).length
  if (running) add(<Text color={C.accent}>{`${G.half} ${running} agent${running === 1 ? '' : 's'}`}</Text>)
  const openPrs = prs.items.filter(p => p.state === 'OPEN').length
  const hot = prs.items.filter(attention).length
  if (openPrs || hot) {
    add(
      <Text>
        <Text dimColor>PRs </Text>
        <Text>{openPrs}</Text>
        {hot ? <Text color={C.warn}>{` ${G.warn}${hot}`}</Text> : null}
      </Text>,
    )
  }
  const waiting = sessions.filter(s => s.status === 'waiting' && s.id !== me.id).length
  if (waiting) add(<Text color={C.warn} bold>{`${G.wait} ${waiting} waiting`}</Text>)

  const line = (
    <Box justifyContent="space-between" width={cols}>
      <Box flexShrink={1} overflow="hidden">
        <Text wrap="truncate-end">{parts}</Text>
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        <Button key="cc-open" plain dimColor label="cc ▸" onPress={open} />
      </Box>
    </Box>
  )

  const offer =
    props.isWorking ? null
    : steps.kind === 'offer' ? (
      <Box flexDirection="column">
        <Text dimColor>next</Text>
        {steps.items.map((item, index) => (
          <Box key={`next-${index}`} marginLeft={2}>
            <Button hotkey={String(index + 1)} plain label={item.label} onPress={() => void take(io, item)} />
          </Box>
        ))}
      </Box>
    )
    : steps.kind === 'loading' ? <Text dimColor>next steps…</Text>
    : null

  return (
    <Box flexDirection="column">
      {below}
      {offer}
      {line}
    </Box>
  )
}
