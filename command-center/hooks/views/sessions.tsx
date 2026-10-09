/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import type { Status } from '../../types'
import { me } from '../features/live'
import { ago, money, pct, trunc } from '../lib/fmt'
import { C, G, level } from '../lib/ui'
import type { View } from './pane'

// Sessions: every Claude Code session on this machine, any project — the ones
// waiting for you first, then working, then idle. Fed by heartbeat files.

const LOOK: Record<Status, { glyph: string; color: string; word: string }> = {
  waiting: { glyph: G.wait, color: C.warn, word: 'needs you' },
  working: { glyph: G.half, color: C.accent, word: 'working' },
  idle: { glyph: G.ring, color: C.muted, word: 'idle' },
  ended: { glyph: G.ring, color: C.muted, word: 'closed' },
}

export async function sessionsView({ io, E, k, cols, now }: View): Promise<RenderElement> {
  const { Box, Text } = E
  const sessions = await io.s.sessions.get()
  const live = sessions.filter(s => s.status !== 'ended')
  const waiting = live.filter(s => s.status === 'waiting').length
  const spent = live.reduce((sum, s) => sum + (s.costUsd ?? 0), 0)
  const aside = [`${live.length} live`, waiting ? `${waiting} need you` : '', spent ? `${money(spent)} across them` : ''].filter(Boolean).join(' · ')
  const right = 22

  return (
    <Box flexDirection="column">
      {k.title('Sessions', aside)}
      {sessions.length === 0 ? k.empty('No sessions yet.') : null}
      {sessions.map(s => {
        const look = LOOK[s.status]
        const isMe = s.id === me.id
        const detail =
          s.status === 'waiting' ? s.waitingFor ?? 'waiting for you'
          : s.task ?? s.title
        return (
          <Box key={`s-${s.id}`} flexDirection="column" marginTop={1}>
            <Box justifyContent="space-between">
              <Box flexShrink={1}>
                <Text color={look.color}>{look.glyph}</Text>
                <Text bold dimColor={s.status === 'ended'}>{` ${trunc(s.project, 22)}`}</Text>
                {s.branch ? <Text dimColor>{`  ${trunc(s.branch, Math.max(8, cols - right - s.project.length - 8))}`}</Text> : null}
                {isMe ? <Text color={C.accent}>{'  this one'}</Text> : null}
              </Box>
              <Box flexShrink={0}>
                {s.contextPct != null ? <Text color={level(s.contextPct)}>{pct(s.contextPct)}</Text> : null}
                {s.costUsd != null ? <Text dimColor>{`  ${money(s.costUsd)}`}</Text> : null}
                <Text dimColor>{`  ${ago(s.updatedAt, now)}`}</Text>
              </Box>
            </Box>
            <Box paddingLeft={2}>
              <Text color={s.status === 'waiting' ? C.warn : undefined} dimColor={s.status !== 'waiting'} wrap="truncate-end">
                {`${G.result} ${look.word}${detail ? ` · ${detail}` : ''}${s.progress ? `  ${G.done} ${s.progress.done}/${s.progress.total}` : ''}${s.agents ? `  ${G.half} ${s.agents}` : ''}`}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
