/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Elements, RenderElement, RenderSurface } from 'claude-code'

import { CONTROLS, flip } from '../features/controls'
import { checkConflicts, markSeen, refreshFocusPrs, refreshMine } from '../features/prs'
import { refreshTicket } from '../features/jira'
import { refreshKit } from '../features/skills'
import { refreshAll } from '../features/refresh'
import { me } from '../features/session'
import { fixTunnels, pickWorktree } from '../features/workspace'
import { basename, money, plural, trunc } from '../lib/fmt'
import type { Io } from '../lib/io'
import type { Seg } from '../lib/svg'
import { INK, statusInk } from '../lib/svg'
import { diffPage, drawAgents, drawCommits, drawDeploys, drawFiles, drawGraph, drawJira, drawKit, drawOverview, drawPr, drawPrList, drawRow, drawSessions, drawToggle, prFor, prLook } from './draw'

// The side panel: one panel with tabs (Overview, Sessions, Agents, Files, GitHub,
// Jira, Vercel when the branch deploys there, Controls); only the selected
// tab's content shows. Replay takes the panel over until "Back".

type Table = Elements[RenderSurface]

export async function panelView(io: Io, E: Table, surface: RenderSurface, cols: number, rows: number): Promise<RenderElement> {
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

  // ---- Replay takes the whole panel. The diff shows as many lines as fit, so
  // the buttons under it are always in view; ▲ ▼ page through a longer one.
  if (panel.replay != null && edits[panel.replay]) {
    const current = edits[panel.replay]!
    const turnEdits = edits.filter(e => e.turnId === current.turnId)
    const at = turnEdits.indexOf(current)
    const root = focus?.root ?? me.root
    const room = Math.max(6, rows - 5)
    const page = diffPage(current, root, panel.replayLine, room)
    const go = (i: number): void => void io.s.panel.set(p => ({ ...p, replay: edits.indexOf(turnEdits[Math.max(0, Math.min(turnEdits.length - 1, i))]!), replayLine: 0 }))
    const scrollTo = (line: number): void => void io.s.panel.set(p => ({ ...p, replayLine: Math.max(0, line) }))
    const rel = current.path.startsWith(`${root}/`) ? current.path.slice(root.length + 1) : current.path
    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold wrap="truncate-end">{`Edit ${at + 1} of ${turnEdits.length} · ${basename(current.path)}`}</Text>
          <Button key="replay-back" plain dimColor label="← Back" onPress={() => void io.s.panel.set(p => ({ ...p, replay: null }))} />
        </Box>
        <Text dimColor wrap="truncate-end">{`${rel} · ${current.tool} · +${current.added} −${current.removed}`}</Text>
        <Box marginTop={1}>
          <Code source={page.source} format="diff" wrap="truncate-end" />
        </Box>
        <Box columnGap={1} flexWrap="wrap">
          <Button key="replay-prev" hotkey="p" label="◀ Previous" onPress={() => go(at - 1)} />
          <Button key="replay-next" hotkey="n" variant="primary" autoFocus label="Next ▶" onPress={() => go(at + 1)} />
          {page.total > room ? <Button key="replay-up" plain dimColor label="▲" onPress={() => scrollTo(panel.replayLine - room)} /> : null}
          {page.total > room ? <Button key="replay-down" plain dimColor label="▼" onPress={() => scrollTo(Math.min(page.total - 1, panel.replayLine + room))} /> : null}
          {page.total > room ? <Text dimColor>{`lines ${page.from + 1}–${page.to} of ${page.total}`}</Text> : null}
        </Box>
      </Box>
    )
  }

  // Tabs: one row at the top, only the selected tab's content below.
  const available = ['overview', 'github', 'jira', 'agents', 'files', 'sessions', 'skills', ...(github.deploys.length ? ['deploys'] : []), 'controls']
  const active = available.includes(panel.tab) ? panel.tab : 'overview'
  const isOpen = (id: string): boolean => id === active
  const tabs: { id: string; label: string }[] = []
  const header = (id: string, label: string, aside = ''): RenderElement => {
    tabs.push({ id, label })
    return id === active ? (
      <Box key={`h-${id}`} justifyContent="space-between" marginTop={1}>
        <Text bold>{label}</Text>
        {aside ? <Text dimColor>{aside}</Text> : null}
      </Box>
    ) : (
      <Box key={`h-${id}`} />
    )
  }
  const picture = (svg: string, alt: string, fallback: string[]): RenderElement =>
    Svg ? <Svg source={svg} alt={alt} /> : <Box flexDirection="column">{fallback.map((l, i) => <Text key={`fb-${i}`} wrap="truncate-end" dimColor={i > 0}>{l}</Text>)}</Box>

  const sections: RenderElement[] = []
  const done = ticket?.requirements.filter(r => r.state !== 'open').length ?? 0
  const progress = ticket?.requirements.length ? { done, total: ticket.requirements.length } : null
  // Other sessions open in this folder (a heartbeat without a folder: by project name).
  const others = sessions.filter(o => (o.root ? o.root === me.root : o.project === basename(me.root)))

  const waiting = others.filter(o => o.status === 'waiting').length
  const running = agents.filter(a => !a.endedAt).length
  const changed = touched.filter(t => t.edits).length
  const hot = github.mine.filter(p => p.state === 'OPEN' && (p.review === 'CHANGES_REQUESTED' || p.mergeable === 'CONFLICTING' || p.newComments)).length
  const kit = await io.s.kit.get()

  // Overview: the session at a glance, then one row per tab; › opens that tab.
  sections.push(header('overview', 'Overview', status === 'working' ? 'working' : status === 'waiting' ? 'needs you' : 'idle'))
  if (isOpen('overview')) {
    sections.push(
      picture(
        drawOverview({ focus, env, usage, startedAt: me.startedAt, now, goal: await io.s.goal.get() }, w),
        'Session overview',
        [`${ticket ? `${ticket.key} ${ticket.status} · ` : ''}${focus?.project ?? ''}`, ...(focus?.branches ?? []).map(b => `${b.side}: ${b.branch} · ${plural(b.commits, 'commit')}${b.unpushed ? ` ↑${b.unpushed}` : ''}`), `ctx ${Math.round(usage?.contextPct ?? 0)}% · ${money(usage?.costUsd)}`],
      ),
    )
    const rows: { tab: string; label: string; left: Seg[]; right: Seg[]; text: string }[] = []
    if (focus?.ticket || ticket) {
      rows.push({ tab: 'jira', label: 'Jira', left: ticket?.summary ? [{ t: ticket.key, bold: true, size: 12 }, { t: ticket.status, pill: statusInk(ticket.status, ticket.category), size: 10 }, { t: ticket.summary, size: 12, cls: 's', grow: true }] : [{ t: focus?.ticket ?? '', bold: true, size: 12 }, { t: ticket?.error ? "couldn't load" : 'loading…', color: ticket?.error ? INK.red : undefined, cls: 'm', size: 11.5 }], right: progress ? [{ t: `${progress.done}/${progress.total} done`, cls: 's', size: 11 }] : [], text: `${ticket?.key ?? focus?.ticket} ${ticket?.status ?? ''}` })
    }
    for (const b of focus?.branches ?? []) {
      const pr = prFor(b, github.focus)
      rows.push({ tab: 'github', label: b.side === 'frontend' ? 'Frontend' : b.side === 'backend' ? 'Backend' : 'Branch', left: [{ t: b.branch ?? '(detached)', mono: true, size: 11.5, grow: true }], right: [{ t: plural(b.commits, 'commit'), cls: 's', size: 11 }, ...(b.unpushed ? [{ t: `↑${b.unpushed}`, color: INK.amber, size: 11 } as Seg] : []), ...(pr ? [{ t: prLook(pr).text, pill: prLook(pr).color, size: 10 } as Seg] : [{ t: 'no PR', cls: 'm', size: 10.5 } as Seg])], text: `${b.side} ${b.branch}` })
    }
    rows.push({ tab: 'agents', label: 'Agents', left: [{ t: agents.length ? `${running} running · ${agents.length - running} done` : 'none yet', cls: agents.length ? 't' : 'm', size: 12, grow: true }], right: [], text: `${running} agents running` })
    rows.push({ tab: 'files', label: 'Files', left: [{ t: activity ? `${activity.verb} ${basename(activity.target)}` : touched.length ? `last: ${basename(touched[0]!.path)}` : 'nothing touched yet', cls: touched.length ? 't' : 'm', size: 12, grow: true }], right: touched.length ? [{ t: `${plural(touched.length, 'touched')} · ${changed} changed`, cls: 's', size: 11 }] : [], text: `${touched.length} files touched` })
    rows.push({ tab: 'sessions', label: 'Sessions', left: [{ t: others.length ? plural(others.length, 'other session') : 'only this one here', cls: others.length ? 't' : 'm', size: 12 }, ...(waiting ? [{ t: `${waiting} need${waiting === 1 ? 's' : ''} you`, pill: INK.amber, size: 10 } as Seg] : [])], right: [], text: `${others.length} other sessions` })
    if (kit) rows.push({ tab: 'skills', label: 'Skills', left: [{ t: kit.used.length ? kit.used.slice(0, 3).map(u => (u.count > 1 ? `${u.name} ×${u.count}` : u.name)).join(' · ') : 'none used yet', cls: kit.used.length ? 't' : 'm', size: 12, grow: true }], right: [{ t: plural(kit.plugins.length, 'plugin'), cls: 's', size: 11 }], text: `${kit.used.length} skills used` })
    sections.push(
      <Box key="ov-rows" flexDirection="column" marginTop={1}>
        {rows.map(r => (
          <Box key={`ov-${r.tab}-${r.text}`} flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              {Svg ? <Svg width={w - 44} source={drawRow(r.label, r.left, r.right, w - 44)} alt={`${r.label}: ${r.text}`} /> : <Text wrap="truncate-end">{`${r.label}: ${r.text}`}</Text>}
            </Box>
            <Button key={`ov-go-${r.tab}-${r.text}`} plain dimColor label="›" onPress={() => void io.s.panel.set(p => ({ ...p, tab: r.tab }))} />
          </Box>
        ))}
      </Box>,
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

  // Sessions
  sections.push(header('sessions', 'Sessions', others.length ? `${plural(others.length, 'other session')} in ${basename(me.root)}` : ''))
  if (isOpen('sessions')) {
    if (others.length) sections.push(picture(drawSessions(others, w, now), `${others.length} other sessions`, others.map(o => `${o.status === 'waiting' ? '!' : o.status === 'working' ? '◐' : '·'} ${o.title} · ${o.ticket ?? o.branch ?? ''} · ${o.status}`)))
    else sections.push(<Text key="sessions-empty" dimColor wrap="wrap">{`No other session is open in ${basename(me.root)}. Sessions show here once they have loaded the command center (new ones do; open ones after /reload-plugins).`}</Text>)
  }

  // Skills & plugins
  sections.push(header('skills', 'Skills & plugins', kit ? `${plural(kit.plugins.length, 'plugin')} on · ${plural(kit.projectSkills.length + kit.globalSkills.length, 'skill')}` : ''))
  if (isOpen('skills')) {
    if (kit) sections.push(picture(drawKit(kit, w), 'Skills and plugins', [`Used: ${kit.used.map(u => `${u.name} ×${u.count}`).join(', ') || 'none'}`, `Project skills: ${kit.projectSkills.map(x => x.name).join(', ') || 'none'}`, `Plugins: ${kit.plugins.map(p => p.name).join(', ')}`]))
    else sections.push(<Text key="kit-loading" dimColor italic>Reading skills and plugins…</Text>)
    sections.push(<Button key="kit-refresh" plain dimColor label="refresh" onPress={() => void refreshKit(io)} />)
  }

  // Agents
  sections.push(header('agents', 'Agents', agents.length ? `${running} running · ${agents.length - running} done` : ''))
  if (isOpen('agents') && !agents.length) sections.push(<Text key="agents-empty" dimColor wrap="wrap">No agents in this session yet. When Claude hands work to a subagent, it shows here with its task, model, tools, tokens and time.</Text>)
  {
    if (isOpen('agents') && agents.length) sections.push(picture(drawAgents([...agents].sort((a, b) => Number(!!a.endedAt) - Number(!!b.endedAt) || b.startedAt - a.startedAt).slice(0, 10), w, now), `${agents.length} agents`, agents.map(a => `${a.endedAt ? '✓' : '◐'} ${a.description} · ${a.tools} tools`)))
  }

  // Files
  sections.push(header('files', 'Files', `${plural(touched.length, 'touched')}${changed ? ` · ${changed} changed` : ''}`))
  if (isOpen('files')) {
    if (activity || touched.length) {
      sections.push(picture(drawFiles({ activity, branch: focus?.branches[0]?.branch ?? null, changed: gitMarks, touched, root: focus?.root ?? me.root }, w), 'Files this session touched', touched.slice(0, 12).map(t => `${t.created ? '+' : t.edits ? '✎' : '·'} ${basename(t.path)} +${t.added} −${t.removed}${t.dependents ? ` · used by ${t.dependents}` : ''}`)))
    } else sections.push(<Text key="files-empty" dimColor italic>Nothing touched yet. Files appear as Claude reads and edits them.</Text>)
    if (toggles.replay && edits.length) sections.push(<Button key="files-replay" plain dimColor label={`▶ replay the last ${plural(edits.filter(e => e.turnId === edits[edits.length - 1]!.turnId).length, 'edit')}`} onPress={() => void io.s.panel.set(p => ({ ...p, replay: edits.findIndex(e => e.turnId === edits[edits.length - 1]!.turnId) }))} />)
  }

  // GitHub
  sections.push(header('github', 'GitHub', `${plural(github.focus.length, 'PR')} here${github.mine.length ? ` · ${github.mine.filter(p => p.state === 'OPEN').length} open overall` : ''}${hot ? ` · ${hot} need you` : ''}`))
  if (isOpen('github')) {
    if (!focus?.branches.length) sections.push(<Text key="gh-none" dimColor italic>No git branch in view for this session.</Text>)
    for (const b of focus?.branches ?? []) {
      const pr = prFor(b, github.focus)
      sections.push(
        <Box key={`br-${b.root}`} flexDirection="column" marginTop={1}>
          {picture(drawGraph(b, pr, w, me.startedAt), `${b.side} ${b.branch}: ${b.commits} commits, ${b.behindBase} new on ${b.base}${pr ? `, ${prLook(pr).text}` : ''}`, [`${b.side}: ${b.branch} · ${plural(b.commits, 'commit')} · main +${b.behindBase}`])}
          {b.log.length ? picture(drawCommits(b, w, now, me.startedAt), `${b.log.length} commits`, b.log.slice(0, 12).map(k => `${k.isPushed ? '●' : '○'} ${k.subject} · ${k.sha}`)) : null}
          {pr ? picture(drawPr(pr, w, now), `${pr.repo} #${pr.number}: ${prLook(pr).text}`, [`${prLook(pr).text} ${pr.title}`, pr.lastComment ? `${pr.lastComment.author}: ${pr.lastComment.text}` : '']) : null}
          {pr ? (
            <Box columnGap={2} flexWrap="wrap">
              <Link href={pr.url} label={`Open #${pr.number} on GitHub`} />
              {pr.mergeable === 'CONFLICTING' && !pr.conflictFiles ? <Button key={`pr-conf-${pr.number}`} plain dimColor label="which files conflict?" onPress={() => void checkConflicts(io, pr.url)} /> : null}
              {pr.newComments ? <Button key={`pr-seen-${pr.number}`} plain dimColor label="mark comments read" onPress={() => void markSeen(io, pr.url)} /> : null}
            </Box>
          ) : null}
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
  sections.push(header('jira', 'Jira', ticket ? `${ticket.key} · ${ticket.status}` : (focus?.ticket ?? '')))
  if (isOpen('jira') && !focus?.ticket && !ticket) sections.push(<Text key="jira-empty" dimColor wrap="wrap">No Jira ticket for this session: its branch names none (an IMS branch like IMS-2423-… does). Start work with /ims-start and the story, requirements, bugs and comments show here.</Text>)
  if (focus?.ticket || ticket) {
    if (isOpen('jira')) {
      if (ticket?.error) {
        sections.push(
          <Box key="jira-err" flexDirection="column">
            <Text color="error" wrap="wrap">{`Couldn't load ${ticket.key}: ${ticket.error}`}</Text>
            <Button key="jira-retry" label="Retry" onPress={() => void refreshTicket(io)} />
          </Box>,
        )
      }
      if (ticket?.summary) {
        sections.push(picture(drawJira(ticket, w, now), `${ticket.key} ${ticket.status}`, [`${ticket.key} ${ticket.status} · ${ticket.summary}`, ...ticket.requirements.map(r => `${r.state === 'open' ? '○' : '✓'} ${r.text}`)]))
        sections.push(<Link key="jira-link" href={ticket.url} label="Open in Jira" />)
      } else if (!ticket?.error) sections.push(<Text key="jira-loading" dimColor italic>Loading the ticket…</Text>)
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
  }

  const badge: Record<string, string> = {
    sessions: waiting ? ` ${waiting}!` : others.length ? ` ${others.length}` : '',
    agents: running ? ` ${running}` : '',
    files: changed ? ` ${changed}` : '',
    github: hot ? ` ${hot}!` : github.focus.length ? ` ${github.focus.length}` : '',
    jira: ticket?.requirements.length ? ` ${done}/${ticket.requirements.length}` : '',
  }
  return (
    <Box flexDirection="column">
      <Box key="tabs" flexWrap="wrap" columnGap={1}>
        {[...tabs].sort((a, b) => available.indexOf(a.id) - available.indexOf(b.id)).map((t, i) => (
          <Button key={`tab-${t.id}`} hotkey={String(i + 1)} plain={t.id === active ? undefined : true} variant={t.id === active ? 'primary' : undefined} dimColor={t.id === active ? undefined : true} label={`${t.label}${badge[t.id] ?? ''}`} onPress={() => void io.s.panel.set(p => ({ ...p, tab: t.id }))} />
        ))}
      </Box>
      {sections}
    </Box>
  )
}
