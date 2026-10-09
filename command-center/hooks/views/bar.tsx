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
import { drawBar, drawHeld, drawKnow, drawNextHead, drawNextRow, drawReplay, drawRule, prFor, prLook } from './draw'

// The band above the prompt. From the top: whatever other plugins draw there
// (Anthropic's built-in "You should know" notes), a held command (guard), a
// rule to save (reflect), then the cards of the task just finished, each its
// own (you should know, replay, what's next), and last the fixed bar:
// this session's ticket, branches, environment, PRs, progress and usage, with
// the one button that opens the side panel. Desktop draws pictures; the
// terminal draws the same facts as text.

type Table = Elements[RenderSurface]

// The desktop draws a band column about 8.25px wide (measured from screenshots of
// the app). Cards take the band's full width; the bar leaves room for its button.
// ponytail: a measured constant; recalibrate if the app changes its font.
const PX_PER_COLUMN = 8.25
export const cardWidth = (cols: number): number => Math.max(300, Math.min(1800, Math.floor(cols * PX_PER_COLUMN) - 6))
// ponytail: rows estimated per card (desktop ~18px a row); recalibrate if cards still scroll.
const BAR_ROWS = 5
export const barWidth = (cols: number): number => Math.max(260, cardWidth(cols) - 104)

export async function bandView(io: Io, E: Table, surface: RenderSurface, props: { isWorking: boolean; bodyColumns: number; maxRows: number }, below: RenderElement): Promise<RenderElement> {
  const { Box, Text, Button } = E
  const Svg = surface === 'desktop' && 'Svg' in E ? (E as Elements['desktop']).Svg : null
  const [held, rules, after, toggles, focus, env, ticket, github, usage, status, edits, home] = [
    await io.s.held.get(), await io.s.rules.get(), await io.s.after.get(), await io.s.toggles.get(), await io.s.focus.get(), await io.s.env.get(),
    await io.s.ticket.get(), await io.s.github.get(), await io.s.usage.get(), await io.s.status.get(), await io.s.edits.get(), await io.home(),
  ]
  const w = cardWidth(props.bodyColumns)
  const bw = barWidth(props.bodyColumns)
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
  // The band is as tall as the app allows (props.maxRows, about half the window) and
  // scrolls past that, so a card shows whole while it fits and folds to one line after.
  if (after && after.state !== 'hidden' && !props.isWorking) {
    const close = (card: 'know' | 'next' | 'replay') => (): void => void io.s.after.set(a => (a ? { ...a, dismissed: [...a.dismissed, card] } : a))
    const isLoading = after.state === 'loading'
    let budget = props.maxRows - BAR_ROWS - (parts.length - 1) * 8
    const fits = (rows: number): boolean => (budget -= rows) >= 0
    const cards: RenderElement[] = []

    if (toggles.next && after.next.length && !after.dismissed.includes('next')) {
      // A framed box is the card, so each row's small button sits inside it.
      fits(after.next.length * 2 + 4)
      cards.push(
        <Box key={`next-${after.turnId}`} flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1} marginBottom={1}>
          {Svg ? <Svg width={w - 40} source={drawNextHead(w - 40)} alt="What's next" /> : <Text color="suggestion">What's next · it goes into your prompt box, nothing is sent</Text>}
          {after.next.map((n, i) => (
            <Box key={`next-row-${i}`} flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={1}>
              <Box flexShrink={1}>
                {Svg ? <Svg width={w - 130} source={drawNextRow(n, i, w - 130)} alt={`${i + 1}. ${n.label}: ${n.prompt}`} /> : <Text wrap="truncate-end">{`${i + 1}. ${n.label} — ${n.prompt}`}</Text>}
              </Box>
              <Box flexShrink={0}>
                <Button key={`next-${i}`} hotkey={String(i + 1)} label="Use" onPress={() => void takeNext(io, n)} />
              </Box>
            </Box>
          ))}
          <Box justifyContent="flex-end">
            <Button key="next-close" plain dimColor label="Dismiss" onPress={close('next')} />
          </Box>
        </Box>,
      )
    }

    if (toggles.know && !after.dismissed.includes('know') && (isLoading || after.know.length)) {
      const more = (): void => {
        close('know')()
        void io.fill(`Tell me more about what I should know from that task: ${after.know.join(' ')}`)
      }
      const full = after.know.length * 2 + 5
      cards.unshift(
        fits(full) ? (
          <Box key={`know-${after.turnId}`} flexDirection="column" marginBottom={1}>
            {Svg ? <Svg width={w} source={drawKnow(after.know, w, isLoading)} alt={`You should know: ${after.know.join(' ')}`} /> : <Box flexDirection="column">{after.know.map((k, i) => <Text key={`k-${i}`} color="warning" wrap="wrap">{`💡 ${k}`}</Text>)}</Box>}
            {isLoading ? null : (
              <Box columnGap={1}>
                <Button key="know-more" label="Tell me more" onPress={more} />
                <Button key="know-ok" plain dimColor label="Got it" onPress={close('know')} />
              </Box>
            )}
          </Box>
        ) : (
          <Box key={`know-${after.turnId}`} columnGap={1} marginBottom={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}><Text color="warning" wrap="truncate-end">{isLoading ? '💡 You should know · thinking…' : `💡 ${plural(after.know.length, 'thing')} to know · ${after.know[0]}`}</Text></Box>
            {isLoading ? null : <Button key="know-more" label="Tell me more" onPress={more} />}
            {isLoading ? null : <Button key="know-ok" plain dimColor label="Got it" onPress={close('know')} />}
          </Box>
        ),
      )
    }

    const turnEdits = edits.filter(e => e.turnId === after.turnId)
    if (toggles.replay && turnEdits.length && !after.dismissed.includes('replay')) {
      const first = edits.indexOf(turnEdits[0]!)
      const go = (): void => void io.s.panel.set(p => ({ ...p, replay: Math.max(0, first) })).then(() => io.togglePane(true))
      const at = after.know.length && toggles.know && !after.dismissed.includes('know') ? 1 : 0
      cards.splice(at, 0,
        fits(6) ? (
          <Box key={`replay-${after.turnId}`} flexDirection="column" marginBottom={1}>
            {Svg ? <Svg width={w} source={drawReplay({ ...after, edits: turnEdits.length }, [...new Set(turnEdits.map(e => e.path))], w)} alt={`${turnEdits.length} edits ready to replay`} /> : <Text color="claude">{`▶ ${plural(turnEdits.length, 'edit')} ready to replay · ${dur(after.durationMs)}`}</Text>}
            <Box columnGap={1}>
              <Button key="replay-go" variant="primary" label="Replay edits" onPress={go} />
              <Button key="replay-close" plain dimColor label="Dismiss" onPress={close('replay')} />
            </Box>
          </Box>
        ) : (
          <Box key={`replay-${after.turnId}`} columnGap={1} marginBottom={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}><Text color="claude" wrap="truncate-end">{`▶ ${plural(turnEdits.length, 'edit')} ready to replay · ${dur(after.durationMs)}`}</Text></Box>
            <Button key="replay-go" label="Replay" onPress={go} />
            <Button key="replay-close" plain dimColor label="Dismiss" onPress={close('replay')} />
          </Box>
        ),
      )
    }
    parts.push(...cards)
  }

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
