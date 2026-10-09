/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { CONTROLS, flip } from '../features/controls'
import { checkConflicts, markSeen, refreshFocusPrs, refreshMine } from '../features/prs'
import { refreshAll } from '../features/refresh'
import { me } from '../features/session'
import { fixTunnels, pickWorktree, ws } from '../features/workspace'
import { basename, money, plural, trunc } from '../lib/fmt'
import type { Io } from '../lib/io'
import { drawAgents, drawDeploys, drawFiles, drawJira, drawOverview, drawPr, drawPrList, drawTimeline, drawToggle, prLook, unified } from './draw'

// The side panel: one panel, sections stacked (Overview, Agents, Files,
// GitHub, Jira, Vercel when the branch deploys there, Controls), each
// folding on its header. Replay takes the panel over until "Back".

type Table = Elements[RenderSurface]

export const PANEL = 'command-center'

export async function panelView(io: Io, E: Table, surface: RenderSurface, cols: number): Promise<RenderElement> {
  const { Box, Text, Button, Link, Code } = E
  const Select = 'Select' in E ? (E as Elements['desktop']).Select : null
  const Svg = surface === 'desktop' && 'Svg' in E ? (E as Elements['desktop']).Svg : null
  const w = Math.max(280, Math.min(900, cols * 8 - 16))
  const now = await io.now()
  const [panel, focus, env, ticket, github, usage, status, agents, touched, edits, activity, sessions, toggles, worktrees, gitMarks] = [
    await io.s.panel.get(), await io.s.focus.get(), await io.s.env.get(), await io.s.ticket.get(), await io.s.github.get(), await io.s.usage.get(), await io.s.status.get(),
    await io.s.agents.get(), await io.s.touched.get(), await io.s.edits.get(), await io.s.activity.get(), await io.s.sessions.get(), await io.s.toggles.get(), await io.s.worktrees.get(),
    (await io.s.focus.get())?.branches.reduce((n, b) => n + b.dirty, 0) ?? 0,
  ]

  // ---- Replay takes the whole panel
  if (panel.replay != null && edits[panel.replay]) {
    const current = edits[panel.replay]!
    const turnEdits = edits.filter(e => e.turnId === current.turnId)
    const at = turnEdits.indexOf(current)
    const root = focus?.root ?? me.root
    const go = (i: number): void => void io.s.panel.set(p => ({ ...p, replay: edits.indexOf(turnEdits[Math.max(0, Math.min(turnEdits.length - 1, i))]!) }))
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold>{`Replay · edit ${at + 1} of ${turnEdits.length}`}</Text>
          <Button key="replay-back" plain dimColor label="← Back" onPress={() => void io.s.panel.set(p => ({ ...p, replay: null }))} />
        </Box>
        {Svg ? <Svg source={drawTimeline(turnEdits, at, w, root)} alt={`${turnEdits.length} edits`} /> : turnEdits.map((e, i) => <Text key={`tl-${e.id}`} bold={i === at} dimColor={i !== at}>{`${i + 1}. ${basename(e.path)}  +${e.added} −${e.removed}`}</Text>)}
        <Box marginTop={1} flexDirection="column">
          <Text bold>{basename(current.path)}</Text>
          <Text dimColor wrap="truncate-end">{`${current.path.startsWith(`${root}/`) ? current.path.slice(root.length + 1) : current.path} · ${current.tool}`}</Text>
        </Box>
        <Code source={unified(current, root)} format="diff" path={basename(current.path)} />
        <Box columnGap={1} marginTop={1}>
          <Button key="replay-prev" hotkey="p" label="Previous edit" onPress={() => go(at - 1)} />
          <Button key="replay-next" hotkey="n" variant="primary" autoFocus label="Next edit" onPress={() => go(at + 1)} />
        </Box>
      </Box>
    )
  }

  const isOpen = (id: string): boolean => !panel.collapsed.includes(id)
  const header = (id: string, label: string, aside = ''): RenderElement => (
    <Box key={`h-${id}`} justifyContent="space-between" marginTop={1}>
      <Button key={`sec-${id}`} plain label={`${isOpen(id) ? '▾' : '▸'} ${label}`} onPress={() => void io.s.panel.set(p => ({ ...p, collapsed: isOpen(id) ? [...p.collapsed, id] : p.collapsed.filter(c => c !== id) }))} />
      {aside ? <Text dimColor>{aside}</Text> : null}
    </Box>
  )
  const picture = (svg: string, alt: string, fallback: string[]): RenderElement =>
    Svg ? <Svg source={svg} alt={alt} /> : <Box flexDirection="column">{fallback.map((l, i) => <Text key={`fb-${i}`} wrap="truncate-end" dimColor={i > 0}>{l}</Text>)}</Box>

  const sections: RenderElement[] = []
  const done = ticket?.requirements.filter(r => r.state !== 'open').length ?? 0
  const progress = ticket?.requirements.length ? { done, total: ticket.requirements.length } : null
  const others = sessions

  // Overview
  sections.push(header('overview', 'Overview', status === 'working' ? 'working' : status === 'waiting' ? 'needs you' : 'idle'))
  if (isOpen('overview')) {
    sections.push(
      picture(
        drawOverview({ focus, env, ticket, github, usage, status, title: ticket?.summary ?? me.title, progress, agents, startedAt: me.startedAt, now, others }, w),
        'Session overview',
        [`${ticket ? `${ticket.key} ${ticket.status} · ` : ''}${focus?.project ?? ''}`, ...(focus?.branches ?? []).map(b => `${b.side}: ${b.branch} · ${plural(b.commits, 'commit')}${b.unpushed ? ` ↑${b.unpushed}` : ''}`), `ctx ${Math.round(usage?.contextPct ?? 0)}% · ${money(usage?.costUsd)}`],
      ),
    )
    const actions: RenderElement[] = []
    if (focus?.isIms) actions.push(<Button key="ov-pick" plain dimColor label={focus.worktree ? 'change worktree' : 'pick the worktree'} onPress={() => void io.s.panel.set(p => ({ ...p, isPicking: !p.isPicking }))} />)
    if (env && (!env.mysql || !env.mongo || !env.redis)) actions.push(<Button key="ov-tunnels" variant="primary" label="Restart tunnels" onPress={() => void fixTunnels(io)} />)
    if (actions.length) sections.push(<Box key="ov-actions" columnGap={1}>{actions}</Box>)
    if (Select && panel.isPicking && worktrees.length) {
      sections.push(
        <Select
          key="ov-select"
          label="Worktree "
          options={[{ value: '', label: 'detect from what the session does' }, ...worktrees.map(f => ({ value: f, label: f }))]}
          value={focus?.isPicked ? (focus.worktree ?? '') : ''}
          onSelect={(v: string) => void pickWorktree(io, v || null).then(() => io.s.panel.set(p => ({ ...p, isPicking: false }))).then(() => refreshAll(io))}
        />,
      )
    }
  }

  // Agents
  const running = agents.filter(a => !a.endedAt).length
  if (agents.length) {
    sections.push(header('agents', 'Agents', `${running} running · ${agents.length - running} done`))
    if (isOpen('agents')) sections.push(picture(drawAgents([...agents].sort((a, b) => Number(!!a.endedAt) - Number(!!b.endedAt) || b.startedAt - a.startedAt).slice(0, 10), w, now), `${agents.length} agents`, agents.map(a => `${a.endedAt ? '✓' : '◐'} ${a.description} · ${a.tools} tools`)))
  }

  // Files
  const changed = touched.filter(t => t.edits).length
  sections.push(header('files', 'Files', `${plural(touched.length, 'touched')}${changed ? ` · ${changed} changed` : ''}`))
  if (isOpen('files')) {
    if (activity || touched.length) {
      sections.push(picture(drawFiles({ activity, branch: focus?.branches[0]?.branch ?? null, changed: gitMarks, touched, root: focus?.root ?? me.root }, w), 'Files this session touched', touched.slice(0, 12).map(t => `${t.created ? '+' : t.edits ? '✎' : '·'} ${basename(t.path)} +${t.added} −${t.removed}${t.dependents ? ` · used by ${t.dependents}` : ''}`)))
    } else sections.push(<Text key="files-empty" dimColor italic>Nothing touched yet. Files appear as Claude reads and edits them.</Text>)
    if (toggles.replay && edits.length) sections.push(<Button key="files-replay" plain dimColor label={`▶ replay the last ${plural(edits.filter(e => e.turnId === edits[edits.length - 1]!.turnId).length, 'edit')}`} onPress={() => void io.s.panel.set(p => ({ ...p, replay: edits.findIndex(e => e.turnId === edits[edits.length - 1]!.turnId) }))} />)
  }

  // GitHub
  const hot = github.mine.filter(p => p.state === 'OPEN' && (p.review === 'CHANGES_REQUESTED' || p.mergeable === 'CONFLICTING' || p.newComments)).length
  sections.push(header('github', 'GitHub', `${plural(github.focus.length, 'PR')} here${github.mine.length ? ` · ${github.mine.filter(p => p.state === 'OPEN').length} open overall` : ''}${hot ? ` · ${hot} need you` : ''}`))
  if (isOpen('github')) {
    if (!github.focus.length) sections.push(<Text key="gh-none" dimColor italic>{focus?.branches.length ? 'No PR for this branch yet.' : 'No branch in view.'}</Text>)
    for (const pr of github.focus) {
      sections.push(
        <Box key={`pr-${pr.url}`} flexDirection="column" marginTop={1}>
          {picture(drawPr(pr, w, now), `${pr.repo} #${pr.number}: ${prLook(pr).text}`, [`${prLook(pr).text} ${pr.title}`, pr.lastComment ? `${pr.lastComment.author}: ${pr.lastComment.text}` : ''])}
          <Box columnGap={2} flexWrap="wrap">
            <Link href={pr.url} label={`Open #${pr.number} on GitHub`} />
            {pr.mergeable === 'CONFLICTING' && !pr.conflictFiles ? <Button key={`pr-conf-${pr.number}`} plain dimColor label="which files conflict?" onPress={() => void checkConflicts(io, pr.url)} /> : null}
            {pr.newComments ? <Button key={`pr-seen-${pr.number}`} plain dimColor label="mark comments read" onPress={() => void markSeen(io, pr.url)} /> : null}
          </Box>
        </Box>,
      )
    }
    const rest = github.mine.filter(p => !github.focus.some(f => f.url === p.url))
    if (rest.length) {
      sections.push(<Button key="gh-all" plain dimColor label={`${panel.showAllPrs ? '▾' : '▸'} your other PRs · ${rest.length}`} onPress={() => void io.s.panel.set(p => ({ ...p, showAllPrs: !p.showAllPrs }))} />)
      if (panel.showAllPrs) sections.push(picture(drawPrList(rest, w), `${rest.length} other PRs`, rest.map(p => `${p.repo.split('/')[1]} #${p.number} ${prLook(p).text.replace(/^#\d+ /, '')} · ${trunc(p.title, 50)}`)))
    }
    sections.push(<Button key="gh-refresh" plain dimColor label={github.isLoading ? 'refreshing…' : 'refresh GitHub'} onPress={() => void refreshFocusPrs(io).then(() => refreshMine(io))} />)
  }

  // Jira
  if (focus?.ticket || ticket) {
    sections.push(header('jira', 'Jira', ticket ? `${ticket.key} · ${ticket.status}` : (focus?.ticket ?? '')))
    if (isOpen('jira')) {
      if (ticket?.error && !ticket.summary) sections.push(<Text key="jira-err" color="error" wrap="wrap">{ticket.error}</Text>)
      if (ticket) {
        sections.push(picture(drawJira(ticket, w, now), `${ticket.key} ${ticket.status}`, [`${ticket.key} ${ticket.status} · ${ticket.summary}`, ...ticket.requirements.map(r => `${r.state === 'open' ? '○' : '✓'} ${r.text}`)]))
        sections.push(<Link key="jira-link" href={ticket.url} label="Open in Jira" />)
      } else sections.push(<Text key="jira-loading" dimColor italic>Loading the ticket…</Text>)
    }
  }

  // Vercel (and any other deployments GitHub knows of for this branch)
  if (github.deploys.length) {
    sections.push(header('deploys', 'Vercel', `${plural(github.deploys.length, 'deployment')}`))
    if (isOpen('deploys')) {
      sections.push(picture(drawDeploys(github.deploys, w, now), 'Deployments', github.deploys.map(d => `${d.environment} ${d.state} ${d.url ?? ''}`)))
      for (const d of github.deploys.filter(x => x.url).slice(0, 2)) sections.push(<Link key={`dep-${d.url}`} href={d.url!} label={`Open ${d.environment.toLowerCase()}`} />)
    }
  }

  // Controls: one row per switch, what it does in plain words, and one button.
  sections.push(header('controls', 'Controls', `${CONTROLS.filter(c => toggles[c.key]).length} of ${CONTROLS.length} on`))
  if (isOpen('controls')) {
    for (const c of CONTROLS) {
      const isOn = toggles[c.key]
      sections.push(
        <Box key={`ctl-${c.key}`} flexDirection="column" marginTop={1}>
          {Svg ? (
            <Svg source={drawToggle(c.name, c.what, isOn, w)} alt={`${c.name}: ${isOn ? 'on' : 'off'}. ${c.what}`} />
          ) : (
            <Box flexDirection="column">
              <Text bold>{`${isOn ? '●' : '○'} ${c.name}`}</Text>
              <Text dimColor wrap="wrap">{c.what}</Text>
            </Box>
          )}
          <Box>
            <Button key={`tg-${c.key}`} plain dimColor={isOn ? true : undefined} label={isOn ? 'Turn off' : 'Turn on'} onPress={() => void flip(io, c.key)} />
          </Box>
        </Box>,
      )
    }
    if (ws.imsRoot) sections.push(<Text key="ims-on" dimColor wrap="wrap">{'Always on in ims-nawy: its rules (PRs into staging, Mazen reviews, no merges, the nawy token, schema changes ask first).'}</Text>)
  }

  return <Box flexDirection="column">{sections}</Box>
}
