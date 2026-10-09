/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import type { Pr } from '../../types'
import { attention, checkConflicts, markSeen, refreshPrs } from '../features/prs'
import { ago, plural, trunc } from '../lib/fmt'
import { C, G } from '../lib/ui'
import type { View } from './pane'

// PRs: one card per pull request, the ones that need you on top. A card says
// where the branch came from, how far it has drifted, what reviewers said,
// whether someone else pushed to it, if it would conflict, and once merged,
// whether the deploy that followed went green. Press a card for its details.

function look(p: Pr): { glyph: string; color: string; word: string } {
  if (p.state === 'MERGED') return { glyph: G.merged, color: C.merged, word: 'merged' }
  if (p.state === 'CLOSED') return { glyph: G.bad, color: C.muted, word: 'closed' }
  if (p.mergeable === 'CONFLICTING') return { glyph: G.bad, color: C.bad, word: 'conflicts' }
  if (p.review === 'CHANGES_REQUESTED') return { glyph: G.wait, color: C.warn, word: 'changes requested' }
  if (p.checks === 'fail') return { glyph: G.bad, color: C.bad, word: 'checks failing' }
  if (p.isDraft) return { glyph: G.draft, color: C.muted, word: 'draft' }
  if (p.review === 'APPROVED') return { glyph: G.dot, color: C.ok, word: 'approved' }
  return { glyph: G.ring, color: C.info, word: p.reviewers.length ? `waiting on ${p.reviewers.join(', ')}` : 'waiting for review' }
}

const CHECK = { pass: { g: G.ok, c: C.ok }, fail: { g: G.bad, c: C.bad }, pending: { g: G.half, c: C.warn }, none: { g: '', c: C.muted } } as const

export async function prsView({ io, E, k, cols, now }: View): Promise<RenderElement> {
  const { Box, Text, Button, Link } = E
  const [prs, open] = await Promise.all([io.s.prs.get(), io.s.openPr.get()])
  const live = prs.items.filter(p => p.state === 'OPEN').length
  const merged = prs.items.length - live
  const aside = [plural(live, 'open'), merged ? `${merged} merged this week` : '', prs.isLoading ? 'refreshing…' : prs.at ? `updated ${ago(prs.at, now)}` : ''].filter(Boolean).join(' · ')

  const card = (p: Pr): RenderElement => {
    const l = look(p)
    const isOpen = open === p.url
    const short = p.repo.split('/')[1] ?? p.repo
    const check = CHECK[p.checks]
    const drift: string[] = []
    if (p.vsBase) drift.push(`${G.up}${p.vsBase.ahead} ${G.down}${p.vsBase.behind} vs ${p.base}`)
    if (p.vsMain && p.vsMain.behind) drift.push(`main +${p.vsMain.behind}${p.vsMain.forkedAt ? ` since ${p.vsMain.forkedAt.slice(5, 10)}` : ''}`)
    const others = p.othersCommits.map(o => `${o.author} pushed ${plural(o.count, 'commit')}`).join(', ')

    return (
      <Box key={`pr-${p.url}`} flexDirection="column" marginTop={1}>
        <Box justifyContent="space-between">
          <Box flexShrink={1}>
            <Text color={l.color}>{l.glyph}</Text>
            <Button
              key={`pr-open-${p.number}-${short}`}
              plain
              label={` #${p.number} ${trunc(p.title, Math.max(16, cols - short.length - 12))}`}
              onPress={() => {
                void io.s.openPr.set(cur => (cur === p.url ? null : p.url))
                if (p.newComments) void markSeen(io, p.url)
              }}
            />
          </Box>
          <Text dimColor>{` ${trunc(short, 24)}`}</Text>
        </Box>
        <Box paddingLeft={2}>
          <Text dimColor wrap="truncate-end">
            {`${G.result} ${p.base} ${G.arrow} ${p.head}${drift.length ? `  ${G.sep} ${drift.join(` ${G.sep} `)}` : ''}`}
          </Text>
        </Box>
        <Box paddingLeft={4}>
          <Text color={l.color}>{l.word}</Text>
          {check.g ? <Text color={check.c}>{`  ${check.g} checks`}</Text> : null}
          {p.comments ? <Text dimColor>{`  ${G.comment} ${p.comments}`}</Text> : null}
          {p.newComments ? <Text color={C.warn} bold>{` (${p.newComments} new)`}</Text> : null}
          {p.ticket ? <Text dimColor>{`  ${p.ticket}`}</Text> : null}
        </Box>
        {others ? (
          <Box paddingLeft={4}>
            <Text color={C.perm} wrap="truncate-end">{`${G.edit} ${others}`}</Text>
          </Box>
        ) : null}
        {p.state === 'MERGED' ? (
          <Box paddingLeft={4}>
            <Text dimColor>{`merged ${p.mergedAt ? ago(Date.parse(p.mergedAt), now) : ''} ago${p.mergedBy ? ` by ${p.mergedBy}` : ''} into ${p.base}`}</Text>
            {p.deploy ? (
              <Text color={p.deploy.conclusion === 'success' ? C.ok : p.deploy.conclusion === 'failure' ? C.bad : C.warn}>
                {`  ${p.deploy.conclusion === 'success' ? G.ok : p.deploy.conclusion === 'failure' ? G.bad : G.half} ${p.deploy.conclusion === 'success' ? 'deployed' : p.deploy.conclusion === 'failure' ? 'deploy failed' : 'deploying'}`}
              </Text>
            ) : null}
          </Box>
        ) : null}
        {p.mergeable === 'CONFLICTING' ? (
          <Box paddingLeft={4}>
            {p.conflictFiles ? (
              <Text color={C.bad} wrap="truncate-end">{p.conflictFiles.length ? `conflicts: ${p.conflictFiles.join(', ')}` : 'no conflicts on a fresh check'}</Text>
            ) : (
              <Button key={`pr-conf-${p.number}-${short}`} plain dimColor label="which files conflict?" onPress={() => void checkConflicts(io, p.url)} />
            )}
          </Box>
        ) : null}
        {isOpen ? (
          <Box flexDirection="column" paddingLeft={4}>
            {p.lastComment ? (
              <Text wrap="wrap">
                <Text bold>{p.lastComment.author}</Text>
                <Text dimColor>{` ${ago(Date.parse(p.lastComment.at), now)} ago: `}</Text>
                <Text>{p.lastComment.text}</Text>
              </Text>
            ) : (
              <Text dimColor>No comments yet.</Text>
            )}
            <Text dimColor>{`+${p.additions} −${p.deletions} in ${plural(p.changedFiles, 'file')} · via ${p.account}`}</Text>
            <Link href={p.url} label="Open on GitHub" />
          </Box>
        ) : null}
      </Box>
    )
  }

  const hot = prs.items.filter(attention)
  const rest = prs.items.filter(p => !attention(p))
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        {k.title('Pull requests', aside)}
        <Box marginTop={1}>
          <Button key="pr-refresh" plain dimColor label="refresh" onPress={() => void refreshPrs(io)} />
        </Box>
      </Box>
      {prs.error ? <Text color={C.bad}>{prs.error}</Text> : null}
      {!prs.items.length && !prs.isLoading && !prs.error ? k.empty('No open or recently merged PRs.') : null}
      {!prs.items.length && prs.isLoading ? k.empty('Loading your PRs from GitHub…') : null}
      {hot.length ? <Text color={C.warn}>{`${G.warn} needs you`}</Text> : null}
      {hot.map(card)}
      {hot.length && rest.length ? <Box marginTop={1}><Text dimColor>everything else</Text></Box> : null}
      {rest.map(card)}
    </Box>
  )
}
