/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import type { After } from '../../types'
import { takeNext } from '../features/after'
import { dropRule, saveRule } from '../features/reflect'
import { me } from '../features/session'
import { dur, plural, trunc } from '../lib/fmt'
import type { Io } from '../lib/io'
import { drawKnow, drawNextHead, drawNextRow, drawReplay, drawRule } from './draw'

// The cards of the task just finished, drawn under Claude's last reply in the
// conversation, each its own card with its own buttons: you should know,
// replay, what's next, and a rule to save (reflect). The reply itself is the
// engine's own drawing (`own`), untouched.

type Table = Elements[RenderSurface]

/** Whether this reply block is the last one of the finished task: its text ends the answer. */
export function isLastBlock(text: string, anchor: string): boolean {
  const block = squash(text)
  return block.length > 0 && anchor.length > 0 && anchor.endsWith(block.slice(-anchor.length))
}

export const squash = (text: string): string => text.replace(/\s+/g, ' ').trim()

export async function cardsView(io: Io, E: Table, surface: RenderSurface, cols: number, own: RenderElement, after: After): Promise<RenderElement> {
  const { Box, Text, Button } = E
  const Svg = surface === 'desktop' && 'Svg' in E ? (E as Elements['desktop']).Svg : null
  // ponytail: ~8px a column in the desktop transcript; cards cap at 760px so they read as cards, not banners.
  const w = Math.max(300, Math.min(760, cols * 8 - 24))
  const [toggles, edits, rules, focus, home] = [await io.s.toggles.get(), await io.s.edits.get(), await io.s.rules.get(), await io.s.focus.get(), await io.home()]
  const close = (card: 'know' | 'next' | 'replay') => (): void => void io.s.after.set(a => (a ? { ...a, dismissed: [...a.dismissed, card] } : a))
  const isLoading = after.state === 'loading'
  const cards: RenderElement[] = []

  if (toggles.know && !after.dismissed.includes('know') && (isLoading || after.know.length)) {
    cards.push(
      <Box key="know" flexDirection="column" marginTop={1}>
        {Svg ? <Svg width={w} source={drawKnow(after.know, w, isLoading)} alt={`You should know: ${after.know.join(' ')}`} /> : <Box flexDirection="column">{isLoading ? <Text dimColor>💡 You should know · thinking…</Text> : after.know.map((k, i) => <Text key={`k-${i}`} color="warning" wrap="wrap">{`💡 ${k}`}</Text>)}</Box>}
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
    cards.push(
      <Box key="replay" flexDirection="column" marginTop={1}>
        {Svg ? <Svg width={w} source={drawReplay({ ...after, edits: turnEdits.length }, [...new Set(turnEdits.map(e => e.path))], w)} alt={`${turnEdits.length} edits ready to replay`} /> : <Text color="claude">{`▶ ${plural(turnEdits.length, 'edit')} ready to replay · ${dur(after.durationMs)}`}</Text>}
        <Box columnGap={1}>
          <Button key="replay-go" variant="primary" label="Replay edits" onPress={() => void io.s.panel.set(p => ({ ...p, replay: Math.max(0, first), replayLine: 0 })).then(() => io.togglePane(true))} />
          <Button key="replay-close" plain dimColor label="Dismiss" onPress={close('replay')} />
        </Box>
      </Box>,
    )
  }

  if (toggles.next && after.next.length && !after.dismissed.includes('next')) {
    // A framed box is the card, so each option's small button sits inside it.
    cards.push(
      <Box key="next" flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1} marginTop={1} width={Svg ? undefined : Math.min(cols, 100)}>
        {Svg ? <Svg width={w - 40} source={drawNextHead(w - 40)} alt="What's next" /> : <Text color="suggestion">What's next · goes into your prompt box, nothing is sent</Text>}
        {after.next.map((n, i) => (
          <Box key={`next-row-${i}`} flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              {Svg ? <Svg width={w - 130} source={drawNextRow(n, i, w - 130)} alt={`${i + 1}. ${n.label}: ${n.prompt}`} /> : <Text wrap="truncate-end">{`${i + 1}. ${n.label} — ${n.prompt}`}</Text>}
            </Box>
            <Box flexShrink={0}>
              <Button key={`next-${i}`} label="Use" onPress={() => void takeNext(io, n)} />
            </Box>
          </Box>
        ))}
        <Box justifyContent="flex-end">
          <Button key="next-close" plain dimColor label="Dismiss" onPress={close('next')} />
        </Box>
      </Box>,
    )
  }

  const rule = toggles.reflect ? rules[0] : undefined
  if (rule) {
    const project = `${focus?.root ?? me.root}/CLAUDE.md`
    const name = `${focus?.project ?? 'this project'}/CLAUDE.md`
    cards.push(
      <Box key={`rule-${rule.id}`} flexDirection="column" marginTop={1}>
        {Svg ? <Svg width={w} source={drawRule(rule, w, `${trunc(name, 40)} or ~/.claude/CLAUDE.md`)} alt={`Save this as a rule? ${rule.rule}`} /> : <Text color="success" wrap="wrap">{`Save this as a rule? “${rule.rule}”`}</Text>}
        <Box columnGap={1} flexWrap="wrap">
          <Button key="rule-project" variant="primary" label="Save for this project" onPress={() => void saveRule(io, rule, project, name)} />
          <Button key="rule-global" label="Save for all projects" onPress={() => void saveRule(io, rule, `${home}/.claude/CLAUDE.md`, '~/.claude/CLAUDE.md')} />
          <Button key="rule-skip" plain dimColor label="Don't save" onPress={() => void dropRule(io, rule.id)} />
        </Box>
      </Box>,
    )
  }

  if (!cards.length) return own
  return (
    <Box flexDirection="column">
      {own}
      {cards}
    </Box>
  )
}
