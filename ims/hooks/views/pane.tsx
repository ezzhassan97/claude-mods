/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import type { ImsTab, PrRef, Story, Worktree } from '../../types'
import { fixTunnels } from '../features/env'
import { loadChecklist } from '../features/checklist'
import { refreshStories } from '../features/stories'
import { config } from '../lib/config'
import { ago, plural, trunc } from '../lib/fmt'
import type { Io } from '../lib/io'
import { C, G, kit } from '../lib/ui'
import type { Table } from '../lib/ui'

// The IMS pane: Stories (Jira + PRs + bugs + worktree, one card each),
// Worktrees (every copy, its ports, apps and database), Checklist (the active
// story's requirements) and UAT (verdicts logged while testing on staging).

export const IMS_PANE = 'ims'
const TABS: readonly ImsTab[] = ['stories', 'worktrees', 'checklist', 'uat']

export const IMS_COMMAND = {
  name: 'ims',
  description: 'IMS pane: stories with their PRs and bugs, worktrees, requirements checklist, UAT board',
  argumentHint: '[stories|worktrees|checklist|uat|refresh|story IMS-1234|tunnels]',
  immediate: true,
} as const

type View = { io: Io; E: Table; k: ReturnType<typeof kit>; cols: number; now: number }

function statusColor(status: string, category: string): string {
  const s = status.toLowerCase()
  if (category === 'done' || /ready for deployment|done/.test(s)) return C.ok
  if (/returned|reopen|blocked/.test(s)) return C.bad
  if (/uat|testing|re-test/.test(s)) return C.warn
  if (/review/.test(s)) return C.info
  if (category === 'indeterminate' || /progress/.test(s)) return C.accent
  return C.muted
}

function prText(p: PrRef): { text: string; color: string } {
  const side = p.repo === 'frontend' ? 'FE' : 'BE'
  if (p.state === 'MERGED') return { text: `${side} #${p.number} merged → ${p.base}`, color: C.merged }
  if (p.state === 'CLOSED') return { text: `${side} #${p.number} closed`, color: C.muted }
  const review = p.review === 'APPROVED' ? 'approved' : p.review === 'CHANGES_REQUESTED' ? 'changes requested' : p.isDraft ? 'draft' : 'in review'
  return { text: `${side} #${p.number} ${review}`, color: p.review === 'CHANGES_REQUESTED' ? C.warn : p.review === 'APPROVED' ? C.ok : C.info }
}

async function storiesView({ io, E, k, cols, now }: View): Promise<RenderElement> {
  const { Box, Text, Button, Link } = E
  const [stories, open, trees] = [await io.s.stories.get(), await io.s.openStory.get(), await io.s.worktrees.get()]
  const card = (s: Story): RenderElement => {
    const bugs = s.subs.filter(x => x.kind === 'bug')
    const openBugs = bugs.filter(b => !b.isDone)
    const review = s.subs.find(x => x.kind === 'review')
    const testing = s.subs.find(x => x.kind === 'testing')
    const latest = new Map<string, PrRef>()
    for (const p of s.prs) if (!latest.has(p.repo)) latest.set(p.repo, p)
    const tree = s.worktree ? trees.find(t => t.folder === s.worktree) : undefined
    const isOpen = open === s.key
    return (
      <Box key={`st-${s.key}`} flexDirection="column" marginTop={1}>
        <Box justifyContent="space-between">
          <Box flexShrink={1}>
            <Text color={statusColor(s.status, s.category)}>{s.type === 'Bug' ? G.bad : G.dot}</Text>
            <Button key={`st-btn-${s.key}`} plain label={` ${s.key} ${trunc(s.summary, Math.max(14, cols - s.status.length - 16))}`} onPress={() => void io.s.openStory.set(cur => (cur === s.key ? null : s.key))} />
          </Box>
          <Text color={statusColor(s.status, s.category)}>{` ${s.status}`}</Text>
        </Box>
        <Box paddingLeft={2}>
          <Text dimColor>{`${G.result} `}</Text>
          {latest.size ? (
            [...latest.values()].map((p, i) => {
              const t = prText(p)
              return <Text key={`st-pr-${s.key}-${p.repo}`} color={t.color}>{`${i ? '  ·  ' : ''}${t.text}`}</Text>
            })
          ) : (
            <Text dimColor>no PRs yet</Text>
          )}
        </Box>
        <Box paddingLeft={4}>
          <Text color={openBugs.length ? C.bad : bugs.length ? C.ok : C.muted}>{bugs.length ? `bugs ${openBugs.length} open / ${bugs.length}` : 'no bugs'}</Text>
          {review ? <Text dimColor>{`  ·  review ${review.isDone ? G.ok : G.todo}`}</Text> : null}
          {testing ? <Text dimColor>{`  ·  testing ${testing.isDone ? G.ok : G.todo}`}</Text> : null}
          {tree ? <Text color={tree.beUp || tree.feUp ? C.ok : C.muted}>{`  ·  ${tree.folder}${tree.beUp || tree.feUp ? ' running' : ''}`}</Text> : null}
        </Box>
        {s.lastComment ? (
          <Box paddingLeft={4}>
            <Text wrap="truncate-end">
              <Text bold>{s.lastComment.author.split(' ')[0]}</Text>
              <Text dimColor>{` ${ago(Date.parse(s.lastComment.at), now)}: `}</Text>
              <Text dimColor>{s.lastComment.text}</Text>
            </Text>
          </Box>
        ) : null}
        {isOpen ? (
          <Box flexDirection="column" paddingLeft={4}>
            {openBugs.map(b => (
              <Text key={`st-bug-${b.key}`} color={C.bad} wrap="truncate-end">{`${G.bad} ${b.key} ${b.summary} (${b.status})`}</Text>
            ))}
            {s.prs.map(p => (
              <Link key={`st-link-${p.url}`} href={p.url} label={`${prText(p).text} — open on GitHub`} />
            ))}
            <Box columnGap={2}>
              <Link href={s.url} label="Open in Jira" />
              <Button key={`st-check-${s.key}`} plain dimColor label="load checklist" onPress={() => void loadChecklist(io, s.key).then(() => io.s.tab.set(() => 'checklist'))} />
            </Box>
          </Box>
        ) : null}
      </Box>
    )
  }
  const active = stories.items.filter(s => s.category !== 'done')
  const done = stories.items.filter(s => s.category === 'done')
  const aside = [plural(active.length, 'open story', 'open stories'), stories.isLoading ? 'refreshing…' : stories.at ? `updated ${ago(stories.at, now)}` : ''].filter(Boolean).join(' · ')
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        {k.title('Stories', aside)}
        <Box marginTop={1}>
          <Button key="st-refresh" plain dimColor label="refresh" onPress={() => void refreshStories(io)} />
        </Box>
      </Box>
      {stories.error ? <Text color={C.bad}>{stories.error}</Text> : null}
      {!stories.items.length && stories.isLoading ? k.empty('Loading your stories from Jira…') : null}
      {active.map(card)}
      {done.length ? <Box marginTop={1}><Text dimColor>done this week</Text></Box> : null}
      {done.map(card)}
    </Box>
  )
}

function treeRow({ E, cols }: View, t: Worktree): RenderElement {
  const { Box, Text } = E
  const port = (p: number | null, up: boolean, label: string): RenderElement => (
    <Text>
      <Text dimColor>{`${label}${p ?? '?'} `}</Text>
      <Text color={up ? C.ok : C.muted}>{up ? G.dot : G.ring}</Text>
    </Text>
  )
  return (
    <Box key={`wt-${t.folder}`} flexDirection="column" marginTop={1}>
      <Box justifyContent="space-between">
        <Text bold wrap="truncate-end">{trunc(t.folder, Math.max(12, cols - 26))}</Text>
        <Box flexShrink={0} columnGap={1}>
          {port(t.fePort, t.feUp, 'fe :')}
          {port(t.bePort, t.beUp, 'be :')}
        </Box>
      </Box>
      <Box paddingLeft={2}>
        <Text dimColor wrap="truncate-end">{`${G.result} ${t.branch ?? 'no branch'}`}</Text>
      </Box>
      <Box paddingLeft={4}>
        {t.dbPort != null ? <Text color={t.dbPort === config.mysqlTunnel ? C.warn : C.ok}>{t.dbPort === config.mysqlTunnel ? 'db staging' : `db local :${t.dbPort}`}</Text> : <Text dimColor>no db</Text>}
        <Text color={t.dirty ? C.warn : C.muted}>{`  ·  ${t.dirty ? `${t.dirty} unsaved` : 'clean'}`}</Text>
        {t.isUat ? <Text color={C.info}>{'  ·  UAT copy (read-only) — /uat-end removes it'}</Text> : null}
      </Box>
    </Box>
  )
}

async function worktreesView(view: View): Promise<RenderElement> {
  const { io, E, k, now } = view
  const { Box, Text, Button } = E
  const [trees, env] = [await io.s.worktrees.get(), await io.s.env.get()]
  const work = trees.filter(t => !t.isUat)
  const uat = trees.filter(t => t.isUat)
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        {k.title('Worktrees', `${plural(work.length, 'copy', 'copies')}${uat.length ? ` · ${uat.length} UAT` : ''}${env ? ` · checked ${ago(env.checkedAt, now)}` : ''}`)}
        <Box marginTop={1}>
          <Button key="wt-tunnels" plain dimColor label="restart tunnels" onPress={() => void fixTunnels(io)} />
        </Box>
      </Box>
      {env ? (
        <Box>
          <Text dimColor>{'tunnels  '}</Text>
          <Text color={env.mysql.up ? C.ok : C.bad}>{`MySQL :${env.mysql.port} ${env.mysql.up ? 'up' : 'down'}`}</Text>
          <Text color={env.mongo.up ? C.ok : C.bad}>{`  Mongo :${env.mongo.port} ${env.mongo.up ? 'up' : 'down'}`}</Text>
          <Text color={env.redis ? C.ok : C.bad}>{`  Redis ${env.redis ? 'up' : 'down'}`}</Text>
        </Box>
      ) : null}
      {trees.length === 0 ? k.empty('No worktrees. /ims-start <folder> <branch> creates one.') : null}
      {work.map(t => treeRow(view, t))}
      {uat.map(t => treeRow(view, t))}
    </Box>
  )
}

async function checklistView({ io, E, k, cols }: View): Promise<RenderElement> {
  const { Box, Text } = E
  const list = await io.s.checklist.get()
  if (!list) return <Box flexDirection="column">{k.title('Checklist')}{k.empty('No active story. Mention IMS-1234 in a prompt, or press "load checklist" on a story.')}</Box>
  const done = list.items.filter(r => r.state !== 'open').length
  const look = { open: { g: G.todo, c: C.muted }, done: { g: G.done, c: C.accent }, tested: { g: G.ok, c: C.ok }, waived: { g: '~', c: C.muted } } as const
  return (
    <Box flexDirection="column">
      {k.title(`${list.key} ${trunc(list.summary, Math.max(10, cols - 24))}`, `${done}/${list.items.length}`)}
      {list.items.length ? <Box marginTop={1}>{k.meter((done / list.items.length) * 100, Math.min(30, cols - 4), done === list.items.length ? C.ok : C.accent)}</Box> : null}
      {list.items.length === 0 ? k.empty('The story has no Requirements section.') : null}
      {list.items.map(r => (
        <Box key={`rq-${r.id}`} paddingLeft={1}>
          <Text color={look[r.state].c}>{look[r.state].g}</Text>
          <Text dimColor={r.state === 'waived'} wrap="wrap">{` ${r.id}. ${r.text}`}</Text>
          {r.state !== 'open' ? <Text color={look[r.state].c}>{`  ${r.state}`}</Text> : null}
        </Box>
      ))}
    </Box>
  )
}

async function uatView({ io, E, k }: View): Promise<RenderElement> {
  const { Box, Text } = E
  const all = await io.s.uat.get()
  const keys = [...new Set(all.map(r => r.key))]
  const look = { pass: { g: G.ok, c: C.ok }, fail: { g: G.bad, c: C.bad }, blocked: { g: G.wait, c: C.warn } } as const
  return (
    <Box flexDirection="column">
      {k.title('UAT', keys.length ? plural(all.length, 'verdict') : '')}
      {keys.length === 0 ? k.empty('Nothing logged. During /uat-start, Claude logs each requirement it tests here.') : null}
      {keys.map(key => {
        const rows = all.filter(r => r.key === key)
        const fails = rows.filter(r => r.result === 'fail').length
        return (
          <Box key={`uat-${key}`} flexDirection="column" marginTop={1}>
            <Box>
              <Text bold>{key}</Text>
              <Text color={fails ? C.bad : C.ok}>{`  ${rows.length - fails}/${rows.length} pass`}</Text>
            </Box>
            {rows.map((r, i) => (
              <Box key={`uat-${key}-${i}`} paddingLeft={1}>
                <Text color={look[r.result].c}>{look[r.result].g}</Text>
                <Text wrap="truncate-end">{` ${r.requirement}`}</Text>
                {r.bug ? <Text color={C.bad}>{`  ${r.bug}`}</Text> : null}
              </Box>
            ))}
          </Box>
        )
      })}
    </Box>
  )
}

export async function imsPaneView(io: Io, E: Table, cols: number): Promise<RenderElement> {
  const { Box, Text } = E
  const k = kit(E)
  const tab = await io.s.tab.get()
  const stories = await io.s.stories.get()
  const trees = await io.s.worktrees.get()
  const list = await io.s.checklist.get()
  const uat = await io.s.uat.get()
  const view: View = { io, E, k, cols, now: await io.now() }
  const bugs = stories.items.reduce((n, s) => n + s.subs.filter(x => x.kind === 'bug' && !x.isDone).length, 0)
  const items: { id: ImsTab; label: string; badge?: string }[] = [
    { id: 'stories', label: 'Stories', badge: bugs ? `${G.bad}${bugs}` : stories.items.length ? String(stories.items.filter(s => s.category !== 'done').length) : undefined },
    { id: 'worktrees', label: 'Worktrees', badge: trees.length ? String(trees.filter(t => !t.isUat).length) : undefined },
    { id: 'checklist', label: 'Checklist', badge: list ? `${list.items.filter(r => r.state !== 'open').length}/${list.items.length}` : undefined },
    { id: 'uat', label: 'UAT', badge: uat.length ? String(uat.length) : undefined },
  ]
  const body = tab === 'worktrees' ? await worktreesView(view) : tab === 'checklist' ? await checklistView(view) : tab === 'uat' ? await uatView(view) : await storiesView(view)
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={C.accent} bold>{'IMS '}</Text>
        {k.tabs(tab, items, id => void io.s.tab.set(() => id))}
      </Box>
      {body}
    </Box>
  )
}

export { TABS as IMS_TABS }
