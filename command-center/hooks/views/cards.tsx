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
import { drawKnow, drawNextHead, drawNextRow, drawReplay, drawRule, NEXT_ROW_HEIGHT } from './draw'

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
  // Every card is the same frame: the drawing, then its buttons inside, bottom right.
  const inner = w - 40
  const card = (key: string, picture: RenderElement, buttons: RenderElement[], rows: RenderElement[] = []): RenderElement => (
    <Box key={key} flexDirection="column" alignSelf="flex-start" borderStyle="round" borderColor="inactive" paddingX={1} marginTop={1} width={Svg ? undefined : Math.min(cols, 100)}>
      {picture}
      {rows}
      {buttons.length ? (
        <Box justifyContent="flex-end" columnGap={1} marginTop={rows.length ? 1 : 0}>
          {buttons}
        </Box>
      ) : null}
    </Box>
  )

  if (toggles.know && !after.dismissed.includes('know') && (isLoading || after.know.length)) {
    cards.push(
      card(
        'know',
        Svg ? <Svg width={inner} source={drawKnow(after.know, inner, isLoading)} alt={`You should know: ${after.know.join(' ')}`} /> : <Box flexDirection="column">{isLoading ? <Text dimColor>💡 You should know · thinking…</Text> : after.know.map((k, i) => <Text key={`k-${i}`} color="warning" wrap="wrap">{`💡 ${k}`}</Text>)}</Box>,
        isLoading
          ? []
          : [
              <Button key="know-ok" plain dimColor label="Got it" onPress={close('know')} />,
              <Button key="know-more" label="Tell me more" onPress={() => {
                  close('know')()
                  void io.fill(`Tell me more about what I should know from that task: ${after.know.join(' ')}`)
                }} />,
            ],
      ),
    )
  }

  const turnEdits = edits.filter(e => e.turnId === after.turnId)
  if (toggles.replay && turnEdits.length && !after.dismissed.includes('replay')) {
    const first = edits.indexOf(turnEdits[0]!)
    cards.push(
      card(
        'replay',
        Svg ? <Svg width={inner} source={drawReplay({ ...after, edits: turnEdits.length }, [...new Set(turnEdits.map(e => e.path))], inner)} alt={`${turnEdits.length} edits ready to replay`} /> : <Text color="claude">{`▶ ${plural(turnEdits.length, 'edit')} ready to replay · ${dur(after.durationMs)}`}</Text>,
        [
          <Button key="replay-close" plain dimColor label="Dismiss" onPress={close('replay')} />,
          <Button key="replay-go" variant="primary" label="Replay edits" onPress={() => void io.s.panel.set(p => ({ ...p, replay: Math.max(0, first), replayLine: 0 })).then(() => io.togglePane(true))} />,
        ],
      ),
    )
  }

  if (toggles.next && after.next.length && !after.dismissed.includes('next')) {
    cards.push(
      card(
        'next',
        Svg ? <Svg width={inner} source={drawNextHead(inner)} alt="What's next" /> : <Text color="suggestion">What's next · goes into your prompt box, nothing is sent</Text>,
        [<Button key="next-close" label="Dismiss" onPress={close('next')} />],
        after.next.map((n, i) => (
          <Box key={`next-row-${i}`} flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              {Svg ? <Svg isInteractive width={inner - 84} height={NEXT_ROW_HEIGHT} source={drawNextRow(n, i, inner - 84)} alt={`${i + 1}. ${n.label}: ${n.prompt}`} /> : <Text wrap="truncate-end">{`${i + 1}. ${n.label} — ${n.prompt}`}</Text>}
            </Box>
            <Box flexShrink={0} columnGap={1}>
              <Button key={`next-copy-${i}`} plain dimColor label="⧉" onPress={() => void io.copy(n.prompt, surface).then(ok => io.toast(ok ? 'Copied' : "Couldn't copy", 2000))} />
              <Button key={`next-${i}`} plain label="→" onPress={() => void takeNext(io, n)} />
            </Box>
          </Box>
        )),
      ),
    )
  }

  const rule = toggles.reflect ? rules[0] : undefined
  if (rule) {
    const project = `${focus?.root ?? me.root}/CLAUDE.md`
    const name = `${focus?.project ?? 'this project'}/CLAUDE.md`
    cards.push(
      card(
        `rule-${rule.id}`,
        Svg ? <Svg width={inner} source={drawRule(rule, inner, `${trunc(name, 40)} or ~/.claude/CLAUDE.md`)} alt={`Save this as a rule? ${rule.rule}`} /> : <Text color="success" wrap="wrap">{`Save this as a rule? “${rule.rule}”`}</Text>,
        [
          <Button key="rule-skip" plain dimColor label="Don't save" onPress={() => void dropRule(io, rule.id)} />,
          <Button key="rule-global" label="Save for all projects" onPress={() => void saveRule(io, rule, `${home}/.claude/CLAUDE.md`, '~/.claude/CLAUDE.md')} />,
          <Button key="rule-project" variant="primary" label="Save for this project" onPress={() => void saveRule(io, rule, project, name)} />,
        ],
      ),
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
