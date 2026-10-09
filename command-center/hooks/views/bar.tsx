/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { takeNext } from '../features/after'
import { decide } from '../features/guard'
import { dropRule, saveRule } from '../features/reflect'
import { me } from '../features/session'
import { dur, money, plural, trunc } from '../lib/fmt'
import type { Io } from '../lib/io'
import { drawBar, drawHeld, drawKnow, drawNext, drawReplay, drawRule, prFor, prLook } from './draw'

// The band above the prompt. From the top: whatever other plugins draw there
// (Anthropic's built-in "You should know" notes), a held command (guard), a
// rule to save (reflect), then the cards of the task just finished, each its
// own (you should know, replay, what's next), and last the fixed bar:
// this session's ticket, branches, environment, PRs, progress and usage, with
// the one button that opens the side panel. Desktop draws pictures; the
// terminal draws the same facts as text.

type Table = Elements[RenderSurface]

export const barWidth = (cols: number): number => Math.max(300, Math.min(1500, cols * 8 - 118))

export async function bandView(io: Io, E: Table, surface: RenderSurface, props: { isWorking: boolean; bodyColumns: number }, below: RenderElement): Promise<RenderElement> {
  const { Box, Text, Button } = E
  const Svg = surface === 'desktop' && 'Svg' in E ? (E as Elements['desktop']).Svg : null
  const [held, rules, after, toggles, focus, env, ticket, github, usage, status, edits, home] = [
    await io.s.held.get(), await io.s.rules.get(), await io.s.after.get(), await io.s.toggles.get(), await io.s.focus.get(), await io.s.env.get(),
    await io.s.ticket.get(), await io.s.github.get(), await io.s.usage.get(), await io.s.status.get(), await io.s.edits.get(), await io.home(),
  ]
  const w = barWidth(props.bodyColumns)
  const parts: RenderElement[] = [below]

  if (held) {
    parts.push(
      <Box key="held" flexDirection="column" marginBottom={1}>
        {Svg ? <Svg width={w} source={drawHeld(held, w)} alt={`Held: ${held.command} — ${held.summary}`} /> : <Text color="error" wrap="wrap">{`⚠ ${held.title}: ${held.command} — ${held.summary}`}</Text>}
        <Box columnGap={1}>
          <Button key="held-run" variant="primary" hotkey="1" label={held.title === 'Recursive delete' && held.lines.length ? `Delete ${plural(held.lines.length, 'file')}` : 'Run it'} onPress={() => void decide(io, 'run')} />
          <Button key="held-cancel" hotkey="2" autoFocus label="Cancel" onPress={() => void decide(io, 'cancel')} />
        </Box>
      </Box>,
    )
  }

  const rule = toggles.reflect ? rules[0] : undefined
  if (rule) {
    const project = `${focus?.root ?? me.root}/CLAUDE.md`
    parts.push(
      <Box key={`rule-${rule.id}`} flexDirection="column" marginBottom={1}>
        {Svg ? <Svg width={w} source={drawRule(rule, w, `${trunc(focus?.project ?? 'this project', 30)}/CLAUDE.md or ~/.claude/CLAUDE.md`)} alt={`Save this as a rule? ${rule.rule}`} /> : <Text color="success" wrap="wrap">{`Save this as a rule? “${rule.rule}”`}</Text>}
        <Box columnGap={1} flexWrap="wrap">
          <Button key="rule-project" variant="primary" label="Save for this project" onPress={() => void saveRule(io, rule, project, `${focus?.project ?? 'this project'}/CLAUDE.md`)} />
          <Button key="rule-global" label="Save for all projects" onPress={() => void saveRule(io, rule, `${home}/.claude/CLAUDE.md`, '~/.claude/CLAUDE.md')} />
          <Button key="rule-reword" label="Reword" onPress={() => void dropRule(io, rule.id).then(() => io.fill(`Save this rule to CLAUDE.md: ${rule.rule}`))} />
          <Button key="rule-skip" plain dimColor label="Don't save" onPress={() => void dropRule(io, rule.id)} />
        </Box>
      </Box>,
    )
  }

  // The cards of the task just finished, each on its own: you should know, replay, what's next.
  if (after && after.state !== 'hidden' && !props.isWorking) {
    const close = (card: 'know' | 'next' | 'replay') => (): void => void io.s.after.set(a => (a ? { ...a, dismissed: [...a.dismissed, card] } : a))
    const isLoading = after.state === 'loading'
    if (toggles.know && !after.dismissed.includes('know') && (isLoading || after.know.length)) {
      parts.push(
        <Box key={`know-${after.turnId}`} flexDirection="column" marginBottom={1}>
          {Svg ? <Svg width={w} source={drawKnow(after.know, w, isLoading)} alt={`You should know: ${after.know.join(' ')}`} /> : <Box flexDirection="column">{after.know.map((k, i) => <Text key={`k-${i}`} color="warning" wrap="wrap">{`💡 ${k}`}</Text>)}</Box>}
          {isLoading ? null : (
            <Box columnGap={1}>
              <Button key="know-more" label="Tell me more" onPress={() => {
                  close('know')()
                  void io.fill(`Tell me more about what I should know from that task: ${after.know.join(' ')}`)
                }} />
              <Button key="know-ok" plain dimColor label="Got it" onPress={close('know')} />
            </Box>
          )}
        </Box>,
      )
    }
    const turnEdits = edits.filter(e => e.turnId === after.turnId)
    if (toggles.replay && turnEdits.length && !after.dismissed.includes('replay')) {
      const first = edits.indexOf(turnEdits[0]!)
      parts.push(
        <Box key={`replay-${after.turnId}`} flexDirection="column" marginBottom={1}>
          {Svg ? <Svg width={w} source={drawReplay({ ...after, edits: turnEdits.length }, [...new Set(turnEdits.map(e => e.path))], w)} alt={`${turnEdits.length} edits ready to replay`} /> : <Text color="claude">{`▶ ${plural(turnEdits.length, 'edit')} ready to replay · ${dur(after.durationMs)}`}</Text>}
          <Box columnGap={1}>
            <Button key="replay-go" variant="primary" label="Replay edits" onPress={() => void io.s.panel.set(p => ({ ...p, replay: Math.max(0, first) })).then(() => io.togglePane(true))} />
            <Button key="replay-close" plain dimColor label="Dismiss" onPress={close('replay')} />
          </Box>
        </Box>,
      )
    }
    if (toggles.next && after.next.length && !after.dismissed.includes('next')) {
      parts.push(
        <Box key={`next-${after.turnId}`} flexDirection="column" marginBottom={1}>
          {Svg ? <Svg width={w} source={drawNext(after.next, w)} alt={`What's next: ${after.next.map(n => n.label).join(', ')}`} /> : <Text color="suggestion">What's next</Text>}
          <Box columnGap={1} flexWrap="wrap">
            {after.next.map((n, i) => (
              <Button key={`next-${i}`} hotkey={String(i + 1)} label={n.label} onPress={() => void takeNext(io, n)} />
            ))}
            <Button key="next-close" plain dimColor label="Dismiss" onPress={close('next')} />
          </Box>
        </Box>,
      )
    }
  }

  const done = ticket?.requirements.filter(r => r.state !== 'open').length ?? 0
  const progress = ticket?.requirements.length ? { done, total: ticket.requirements.length } : null
  const title = ticket?.summary ?? (me.lastPrompt || me.title)
  const open = (): void => void io.togglePane()
  parts.push(
    Svg ? (
      <Box key="bar" flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={1}>
        <Box flexShrink={1}>
          <Svg width={w} source={drawBar({ focus, env, ticket, github, usage, status, title, progress }, w)} alt={barAlt(focus, ticket, usage)} />
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
