import type { After, Agent, Beat, Branch, Deploy, Edit, Env, Focus, Github, Goal, Kit, Pr, Rule, Status, Ticket, Touch, Usage } from '../../types'
import { ago, basename, dirname, dur, money, plural, tokens } from '../lib/fmt'
import { Canvas, esc, FONT, INK, loadInk, MONO, SANS, statusInk, width } from '../lib/svg'
import type { Seg } from '../lib/svg'

// Every desktop drawing of the command center, as pure functions from state
// to one SVG string: the bar above the prompt, the three cards (after a turn,
// reflect) and each section of the side panel. Buttons are not drawn
// here; the views put real Buttons beside or under these pictures.

const SIDE_LABEL: Record<Branch['side'], string> = { frontend: 'FE', backend: 'BE', repo: '⎇' }

/** The PR of one branch, by head branch and repository. */
export const prFor = (b: Branch, prs: Pr[]): Pr | undefined =>
  prs.find(p => p.head === b.branch && (!b.remote || p.repo.toLowerCase() === b.remote.toLowerCase()))

export function prLook(p: Pr): { text: string; color: string } {
  const n = `#${p.number}`
  const fresh = p.newComments ? ` · ${p.newComments} new` : ''
  if (p.state === 'MERGED') return { text: `${n} merged`, color: INK.purple }
  if (p.state === 'CLOSED') return { text: `${n} closed`, color: INK.gray }
  if (p.mergeable === 'CONFLICTING') return { text: `${n} conflicts${fresh}`, color: INK.red }
  if (p.review === 'CHANGES_REQUESTED') return { text: `${n} changes requested${fresh}`, color: INK.amber }
  if (p.checks === 'fail') return { text: `${n} checks failing${fresh}`, color: INK.red }
  if (p.isDraft) return { text: `${n} draft${fresh}`, color: INK.gray }
  if (p.review === 'APPROVED') return { text: `${n} approved${fresh}`, color: INK.green }
  return { text: `${n} in review${fresh}`, color: INK.blue }
}

const usageSegs = (u: Usage | null): Seg[] =>
  u
    ? [
        { t: 'ctx', cls: 'm', size: 11.5 },
        { t: `${Math.round(u.contextPct ?? 0)}%`, color: loadInk(u.contextPct), bold: true, size: 11.5, gap: 4 },
        { t: '·', cls: 'm', size: 11.5, gap: 5 },
        { t: u.contextTokens ? tokens(u.contextTokens) : '—', cls: 's', size: 11.5, gap: 5 },
        { t: '·', cls: 'm', size: 11.5, gap: 5 },
        { t: money(u.costUsd), cls: 's', size: 11.5, gap: 5 },
      ]
    : []

export type BarInput = {
  focus: Focus | null
  env: Env | null
  ticket: Ticket | null
  github: Github
  usage: Usage | null
  status: Status
  title: string
  progress: { done: number; total: number } | null
}

/** The bar above the prompt: who this session is (line 1) and each branch (one line each). */
export function drawBar(d: BarInput, w: number): string {
  const c = new Canvas(w, 12, { bar: true }).space(3)
  const working = d.status === 'working'
  const waiting = d.status === 'waiting'
  const head: Seg = { dot: waiting ? INK.amber : working ? INK.clay : d.ticket ? statusInk(d.ticket.status, d.ticket.category) : INK.gray, live: working || waiting }
  const left: Seg[] = d.ticket
    ? [head, { t: d.ticket.key, bold: true, size: 13 }, { t: d.ticket.status, pill: statusInk(d.ticket.status, d.ticket.category), size: 11 }, { t: d.ticket.summary, grow: true, size: 13 }]
    : [head, { t: d.focus?.project ?? 'this session', bold: true, size: 13 }, { t: d.title, grow: true, size: 13, cls: 's' }]
  const right: Seg[] = []
  if (d.focus?.worktree) right.push({ t: d.focus.worktree, cls: 's', size: 11.5, mono: true })
  if (d.env?.dbMode) {
    const down = !d.env.mysql || !d.env.mongo || !d.env.redis
    right.push({ t: down ? 'tunnel down' : `DB ${d.env.dbMode}`, pill: down ? INK.red : d.env.dbMode === 'staging' ? INK.amber : INK.green, size: 11 })
  }
  if (d.progress && d.progress.total) {
    right.push({ bar: { w: 40, pct: d.progress.done / d.progress.total, color: d.progress.done === d.progress.total ? INK.green : INK.clay }, size: 11.5 })
    right.push({ t: `${d.progress.done}/${d.progress.total}`, cls: 's', size: 11.5, gap: 5 })
  }
  c.line(left, right, 21)

  const branches = d.focus?.branches ?? []
  if (!branches.length) c.line([{ t: 'no git branch in view', cls: 'm', size: 12 }], usageSegs(d.usage), 18)
  branches.forEach((b, i) => {
    const pr = prFor(b, d.github.focus)
    const look = pr ? prLook(pr) : null
    const segs: Seg[] = [
      { t: SIDE_LABEL[b.side], pill: b.side === 'frontend' ? INK.teal : b.side === 'backend' ? INK.purple : INK.gray, size: 10.5, bold: true },
      { t: b.branch ?? '(detached)', mono: true, size: 12, cls: 't', grow: true },
      { t: plural(b.commits, 'commit'), cls: 's', size: 11.5 },
    ]
    if (b.unpushed) segs.push({ t: `↑${b.unpushed} unpushed`, color: INK.amber, size: 11.5, gap: 6 })
    if (b.dirty) segs.push({ t: `${b.dirty} uncommitted`, color: INK.amber, size: 11.5, gap: 6 })
    segs.push(look ? { t: look.text, pill: look.color, size: 11 } : { t: 'no PR', cls: 'm', size: 11.5 })
    c.line(segs, i === 0 ? usageSegs(d.usage) : [], 18)
  })
  c.space(4)
  return c.svg()
}

/** You should know: what a finished task left that you could easily miss. */
export function drawKnow(know: string[], w: number, isLoading: boolean): string {
  const c = new Canvas(w, 0, { icon: 'bulb', ink: INK.amber, bare: true }).space(12)
  c.label('You should know', isLoading ? 'checking the task you just finished…' : 'about the task you just finished', INK.amber)
  if (isLoading) c.text('Looking for risks, side effects and decisions left to you…', { cls: 'm', size: 12.5, lines: 1 })
  for (const k of know.slice(0, 3)) c.text(k, { size: 13.5, lines: 3, bullet: INK.amber })
  c.space(8)
  return c.svg()
}

/** What's next, the card's head: icon badge and title (the card itself is a framed box). */
export function drawNextHead(w: number): string {
  const c = new Canvas(w, 0, { icon: 'next', ink: INK.blue, bare: true }).space(12)
  c.label("What's next", 'it goes into your prompt box, nothing is sent', INK.blue)
  return c.space(Math.max(4, 46 - c.height)).svg() // room for the icon badge
}

/** One suggestion row: its number, label and the prompt it writes. */
export function drawNextRow(n: { label: string; prompt: string }, i: number, w: number): string {
  const c = new Canvas(w, 54)
  c.line([{ t: String(i + 1), color: INK.blue, bold: true, size: 12.5 }, { t: n.label, bold: true, size: 13 }, { t: n.prompt === n.label ? '' : n.prompt, cls: 'm', size: 12, grow: true }], [], 30)
  return c.svg()
}

/** Replay: the edits of the task you just finished, ready to step through. */
export function drawReplay(a: After, files: string[], w: number): string {
  const c = new Canvas(w, 0, { icon: 'play', ink: INK.clay, bare: true }).space(12)
  const stats = [dur(a.durationMs), a.tools ? plural(a.tools, 'tool') : '', a.costUsd != null ? money(a.costUsd) : ''].filter(Boolean).join(' · ')
  c.label('Replay', stats, INK.clay)
  c.line([{ t: `${plural(a.edits, 'edit')} ready to replay`, bold: true, size: 14 }, { t: `+${a.added} −${a.removed}`, cls: 's', size: 12.5 }], [], 24)
  c.text(files.map(f => basename(f)).join(' · '), { cls: 's', size: 12, lines: 1 })
  c.space(6)
  return c.svg()
}

/** A correction you made, offered as a rule. */
export function drawRule(r: Rule, w: number, target: string): string {
  const c = new Canvas(w, 0, { icon: 'bookmark', ink: INK.green, bare: true }).space(12)
  c.label('Save this as a rule?', `${Math.round(r.confidence * 100)}% sure`, INK.green)
  c.text(`“${r.rule}”`, { size: 14.5, lines: 3 })
  c.text(`From what you said: “${r.quote}”`, { cls: 's', size: 12, lines: 2 })
  c.text(`Goes to ${target}`, { cls: 'm', size: 11.5, lines: 1 })
  c.space(6)
  return c.svg()
}

/** One switch of the Controls section: its name, what it does, and its state. */
export function drawToggle(name: string, what: string, isOn: boolean, w: number): string {
  // the switch itself is a real button beside this drawing (a drawing can't be pressed)
  const c = new Canvas(w, 2)
  c.line([{ t: name, bold: true, size: 13, cls: isOn ? 't' : 's' }], [], 22)
  c.text(what, { cls: isOn ? 's' : 'm', size: 12, lines: 2 })
  return c.svg()
}

// ---- the side panel's sections

/** The top of Overview: usage tiles, the session's goal with its steps, the worktree and its environment. */
export function drawOverview(d: Pick<BarInput, 'focus' | 'env' | 'usage'> & { startedAt: number; now: number; goal: Goal | null }, w: number): string {
  const c = new Canvas(w, 2)
  c.tiles([
    { label: 'Context', value: d.usage?.contextPct != null ? `${Math.round(d.usage.contextPct)}%` : '—', color: loadInk(d.usage?.contextPct) },
    { label: 'Tokens', value: d.usage?.contextTokens ? tokens(d.usage.contextTokens) : '—' },
    { label: 'Cost', value: money(d.usage?.costUsd) },
    { label: 'Time', value: dur(Math.max(0, d.now - d.startedAt)) },
  ])
  if (d.goal) {
    const done = d.goal.steps.filter(x => x.done).length
    c.label('Goal', `${done} of ${d.goal.steps.length} steps`, INK.clay)
    c.text(d.goal.title, { size: 14, lines: 2 })
    c.progress(done / d.goal.steps.length, done === d.goal.steps.length ? INK.green : INK.clay, 5)
    for (const step of d.goal.steps) c.line([{ t: step.done ? '✓' : '○', color: step.done ? INK.green : INK.gray, bold: true, size: 12 }, { t: step.text, size: 12, cls: step.done ? 's' : 't', grow: true }], [], 19)
    c.space(6)
  }
  if (d.focus?.worktree || d.env) {
    const segs: Seg[] = []
    if (d.focus?.worktree) segs.push({ t: d.focus.worktree, mono: true, size: 12, cls: 's' })
    if (d.env?.fe) segs.push({ t: `fe :${d.env.fe.port}`, cls: 'm', size: 11.5 }, { dot: d.env.fe.up ? INK.green : INK.gray, gap: 3 })
    if (d.env?.be) segs.push({ t: `be :${d.env.be.port}`, cls: 'm', size: 11.5 }, { dot: d.env.be.up ? INK.green : INK.gray, gap: 3 })
    const right: Seg[] = d.env
      ? [
          { t: 'MySQL', cls: 'm', size: 11 }, { dot: d.env.mysql ? INK.green : INK.red, gap: 3 },
          { t: 'Mongo', cls: 'm', size: 11 }, { dot: d.env.mongo ? INK.green : INK.red, gap: 3 },
          { t: 'Redis', cls: 'm', size: 11 }, { dot: d.env.redis ? INK.green : INK.red, gap: 3 },
          ...(d.env.dbMode ? [{ t: `DB ${d.env.dbMode}`, pill: d.env.dbMode === 'staging' ? INK.amber : INK.green, size: 11 } as Seg] : []),
        ]
      : []
    c.line(segs, right, 22)
  }
  return c.svg()
}

/** Other sessions open in this folder: what each is on and doing, its context and cost. */
export function drawSessions(beats: Beat[], w: number, now: number): string {
  const c = new Canvas(w, 2)
  for (const s of beats) {
    const doing = s.status === 'waiting' ? (s.waitingFor ?? 'needs you') : s.status === 'working' ? 'working' : `idle · ${ago(s.updatedAt, now)} ago`
    c.line(
      [{ dot: s.status === 'waiting' ? INK.amber : s.status === 'working' ? INK.clay : INK.gray, live: s.status !== 'idle' }, { t: s.title, size: 12.5, bold: true, grow: true }],
      [{ t: s.contextPct != null ? `ctx ${Math.round(s.contextPct)}%` : '', color: loadInk(s.contextPct), size: 11 }, { t: money(s.costUsd), cls: 'm', size: 11 }],
      21,
    )
    c.line([{ t: '', size: 11 }, { t: s.ticket ?? s.branch ?? '', cls: 'm', size: 11, mono: true, gap: 15 }, { t: doing, color: s.status === 'waiting' ? INK.amber : undefined, cls: s.status === 'waiting' ? undefined : 's', size: 11.5, grow: true }, ...(s.agents ? [{ t: plural(s.agents, 'agent'), cls: 'm', size: 11 } as Seg] : [])], [], 19)
    c.space(4)
  }
  return c.svg()
}

const AGENT_INK: Record<string, string> = { running: INK.clay, pending: INK.gray, waiting: INK.amber, idle: INK.gray, completed: INK.green, failed: INK.red, killed: INK.gray }

export function drawAgents(agents: Agent[], w: number, now: number): string {
  const c = new Canvas(w, 2)
  for (const a of agents) {
    const ink = AGENT_INK[a.status] ?? INK.gray
    const isRunning = !a.endedAt
    const ctxPct = a.contextTokens ? Math.min(100, (a.contextTokens / (/haiku/i.test(a.model ?? '') ? 200_000 : 1_000_000)) * 100) : 0
    c.line([{ dot: ink, live: isRunning }, { t: a.description || a.name, bold: true, size: 13, grow: true }], [{ t: dur((a.endedAt ?? now) - a.startedAt), cls: 's', size: 11.5 }], 22)
    c.line(
      [{ t: '', gap: 0, size: 10 }, { t: [a.type, a.model?.replace(/^claude-/, '')].filter(Boolean).join(' · '), cls: 'm', size: 11.5, grow: true }],
      [{ t: `${a.tools} tools · ctx ${Math.round(ctxPct)}% · ${tokens(a.tokens)} · ≈${money(a.costUsd)}`, cls: 's', size: 11.5 }],
      18,
    )
    c.progress(isRunning ? Math.max(0.04, ctxPct / 100) : 1, isRunning ? INK.clay : ink, 4)
  }
  return c.svg()
}

export function drawFiles(input: { activity: { verb: string; target: string } | null; branch: string | null; changed: number; touched: Touch[]; root: string }, w: number): string {
  const c = new Canvas(w, 2)
  if (input.activity) {
    c.label('Right now', '', INK.purple)
    c.line([{ t: `Claude is ${input.activity.verb}`, size: 13 }, { t: basename(input.activity.target), bold: true, size: 13, grow: true }], [], 22)
    const where = dirname(input.activity.target)
    if (where && where !== '/') c.text(`in ${where.startsWith(`${input.root}/`) ? where.slice(input.root.length + 1) : where}`, { cls: 'm', size: 11.5, lines: 1 })
  }
  if (input.branch) c.line([{ t: '⎇', cls: 's', mono: true }, { t: input.branch, mono: true, size: 12 }], [{ t: input.changed ? `${input.changed} changed` : 'clean', cls: input.changed ? 's' : 'm', size: 11.5 }], 22)
  for (const t of input.touched.slice(0, 14)) {
    const kind = t.created ? { g: 'new', c: INK.green } : t.edits ? { g: 'edited', c: INK.clay } : { g: 'read', c: INK.purple }
    const rel = t.path.startsWith(`${input.root}/`) ? t.path.slice(input.root.length + 1) : t.path
    const right: Seg[] = []
    if (t.added) right.push({ t: `+${t.added}`, color: INK.green, size: 11.5 })
    if (t.removed) right.push({ t: `−${t.removed}`, color: INK.red, size: 11.5, gap: 4 })
    if (t.dependents != null && t.dependents > 0) right.push({ t: `used by ${t.dependents}`, ...(t.dependents >= 8 ? { color: INK.amber } : { cls: 'm' as const }), size: 11.5 })
    right.push({ t: kind.g, pill: kind.c, size: 10.5 })
    c.line([{ t: basename(rel), size: 12.5 }, { t: dirname(rel) === '/' ? '' : dirname(rel), cls: 'm', size: 11.5, grow: true }], right, 20)
  }
  if (input.touched.length > 14) c.text(`+${input.touched.length - 14} more`, { cls: 'm', size: 11.5, lines: 1 })
  return c.svg()
}

/** One pull request, as a compact card. */
export function drawPr(p: Pr, w: number, now: number): string {
  const c = new Canvas(w, 2)
  const look = prLook(p)
  const short = p.repo.split('/')[1] ?? p.repo
  c.line([{ t: look.text, pill: look.color, size: 11 }, { t: p.title, grow: true, size: 13 }], [{ t: short, cls: 'm', size: 11.5 }], 22)
  const drift = [p.vsBase ? `↑${p.vsBase.ahead} ↓${p.vsBase.behind} vs ${p.base}` : `into ${p.base}`, p.vsMain?.behind ? `main +${p.vsMain.behind}${p.vsMain.forkedAt ? ` since ${p.vsMain.forkedAt.slice(5, 10)}` : ''}` : ''].filter(Boolean).join(' · ')
  c.line([{ t: drift, cls: 's', size: 11.5, grow: true }], [{ t: p.checks === 'pass' ? '✓ checks' : p.checks === 'fail' ? '✗ checks' : p.checks === 'pending' ? '◌ checks' : '', color: p.checks === 'pass' ? INK.green : p.checks === 'fail' ? INK.red : INK.amber, size: 11.5 }, { t: `+${p.additions} −${p.deletions}`, cls: 'm', size: 11.5 }], 19)
  for (const o of p.othersCommits) c.line([{ t: `${o.author} pushed ${plural(o.count, 'commit')} to your branch`, color: INK.purple, size: 11.5 }], [], 19)
  if (p.conflictFiles?.length) c.text(`conflicts: ${p.conflictFiles.join(', ')}`, { color: INK.red, size: 11.5, lines: 2 })
  if (p.state === 'MERGED' && p.deploy) {
    const ok = p.deploy.conclusion === 'success'
    const bad = p.deploy.conclusion === 'failure'
    c.line([{ t: `merged into ${p.base}${p.mergedBy ? ` by ${p.mergedBy}` : ''}`, cls: 's', size: 11.5 }, { t: ok ? 'deployed' : bad ? 'deploy failed' : 'deploying', pill: ok ? INK.green : bad ? INK.red : INK.amber, size: 10.5 }], [], 19)
  }
  if (p.lastComment) c.text(`${p.lastComment.author} · ${ago(Date.parse(p.lastComment.at), now)}: ${p.lastComment.text}`, { cls: 's', size: 11.5, lines: 2 })
  return c.svg()
}

export function drawPrList(prs: Pr[], w: number): string {
  const c = new Canvas(w, 2)
  for (const p of prs.slice(0, 12)) {
    const look = prLook(p)
    c.line([{ dot: look.color }, { t: `${p.repo.split('/')[1]} #${p.number}`, cls: 's', size: 11.5 }, { t: p.title, grow: true, size: 12 }], [{ t: look.text.replace(/^#\d+ /, ''), color: look.color, size: 11 }], 19)
  }
  return c.svg()
}

export function drawJira(t: Ticket, w: number, now: number): string {
  const c = new Canvas(w, 2)
  c.line([{ dot: statusInk(t.status, t.category) }, { t: t.key, bold: true, size: 13 }, { t: t.status, pill: statusInk(t.status, t.category), size: 11 }, { t: t.type, cls: 'm', size: 11.5 }], [], 22)
  c.text(t.summary, { size: 13.5, lines: 2 })
  if (t.requirements.length) {
    const done = t.requirements.filter(r => r.state !== 'open').length
    c.space(4).label('Requirements', `${done} of ${t.requirements.length}`)
    c.progress(done / t.requirements.length, done === t.requirements.length ? INK.green : INK.clay, 4)
    for (const r of t.requirements.slice(0, 10)) {
      const mark = r.state === 'tested' ? { g: '✓', c: INK.green } : r.state === 'done' ? { g: '✓', c: INK.clay } : r.state === 'waived' ? { g: '~', c: INK.gray } : { g: '○', c: INK.gray }
      c.line([{ t: mark.g, color: mark.c, size: 12, bold: true }, { t: r.text, size: 12, cls: r.state === 'open' ? 't' : 's', grow: true }], r.state !== 'open' ? [{ t: r.state, color: mark.c, size: 10.5 }] : [], 19)
    }
  }
  const bugs = t.subs.filter(s => s.kind === 'bug')
  const open = bugs.filter(b => !b.isDone)
  if (bugs.length) {
    c.space(4).label('Bugs', `${open.length} open of ${bugs.length}`, open.length ? INK.red : undefined)
    for (const b of open.slice(0, 6)) c.line([{ t: b.key, color: INK.red, size: 11.5, bold: true }, { t: b.summary, size: 12, grow: true }], [{ t: b.status, cls: 'm', size: 11 }], 19)
  }
  const flow = t.subs.filter(s => s.kind === 'review' || s.kind === 'testing')
  if (flow.length) c.line(flow.map(s => ({ t: `${s.kind === 'review' ? 'Code review' : 'Testing'} ${s.isDone ? '✓' : '○'}`, cls: s.isDone ? 't' : 'm', size: 11.5, gap: 14 }) as Seg), [], 20)
  const last = t.comments[t.comments.length - 1]
  if (last) {
    c.space(4).label('Latest comment', `${plural(t.comments.length, 'comment')}`)
    c.text(`${last.author} · ${ago(Date.parse(last.at), now)}: ${last.text}`, { cls: 's', size: 12, lines: 3 })
  }
  return c.svg()
}

export function drawDeploys(deploys: Deploy[], w: number, now: number): string {
  const c = new Canvas(w, 2)
  for (const d of deploys.slice(0, 4)) {
    const s = d.state.toLowerCase()
    const ink = s === 'success' ? INK.green : s === 'failure' || s === 'error' ? INK.red : INK.amber
    c.line([{ dot: ink, live: ink === INK.amber }, { t: d.environment, size: 12.5 }, { t: s === 'success' ? 'ready' : s, pill: ink, size: 10.5 }, { t: d.ref, mono: true, cls: 'm', size: 11.5, grow: true }], [{ t: `${ago(Date.parse(d.at), now)} ago`, cls: 'm', size: 11.5 }], 21)
    if (d.url) c.text(d.url.replace(/^https?:\/\//, ''), { cls: 's', size: 11.5, lines: 1, indent: 14 })
  }
  return c.svg()
}

/** The Replay timeline: every edit of the turn, the current one marked. */
export function unified(e: Edit, root: string): string {
  const rel = e.path.startsWith(`${root}/`) ? e.path.slice(root.length + 1) : basename(e.path)
  const before = e.before ? e.before.split('\n') : []
  const after = e.after ? e.after.split('\n') : []
  return [`--- a/${rel}`, `+++ b/${rel}`, `@@ -1,${before.length} +1,${after.length} @@`, ...before.map(l => `-${l}`), ...after.map(l => `+${l}`)].join('\n')
}

/** One page of an edit's diff, `room` lines from `start`, as a hunk of its own so it still draws as a diff. */
export function diffPage(e: Edit, root: string, start: number, room: number): { source: string; from: number; to: number; total: number } {
  const [minus, plus, , ...body] = unified(e, root).split('\n')
  const from = Math.max(0, Math.min(start, Math.max(0, body.length - room)))
  const lines = body.slice(from, from + room)
  const count = (ls: string[], mark: string): number => ls.filter(l => l.startsWith(mark)).length
  const before = body.slice(0, from)
  const header = `@@ -${count(before, '-') + 1},${count(lines, '-')} +${count(before, '+') + 1},${count(lines, '+')} @@`
  return { source: [minus, plus, header, ...lines].join('\n'), from, to: from + lines.length, total: body.length }
}

const SIDE_INK: Record<string, string> = { frontend: INK.teal, backend: INK.purple, repo: INK.clay }

/**
 * One branch as GitHub Desktop would show it: main as a lane, the branch
 * leaving it where it forked with a dot per commit (hollow = not pushed,
 * filled bright = made in this session), main's commits since then, and
 * staging below with the PR (dashed while open) or the branch already in it.
 */
export function drawGraph(b: Branch, pr: Pr | null | undefined, w: number, sessionStart: number): string {
  const c = new Canvas(w, 2)
  const ink = SIDE_INK[b.side] ?? INK.clay
  const tag = b.side === 'frontend' ? 'FE' : b.side === 'backend' ? 'BE' : '⎇'
  c.line([{ t: tag, pill: ink, size: 10.5 }, { t: b.branch ?? '(detached)', mono: true, bold: true, size: 12.5, grow: true }], pr ? [{ t: prLook(pr).text, pill: prLook(pr).color, size: 10.5 }] : [{ t: 'no PR', cls: 'm', size: 11 }], 24)

  const text = (x: number, y: number, s: string, opts: { anchor?: string; cls?: string; color?: string; size?: number; mono?: boolean } = {}): string =>
    `<text x="${x}" y="${y}" font-family="${opts.mono ? MONO : SANS}" font-size="${(opts.size ?? 11) * FONT}" ${opts.anchor ? `text-anchor="${opts.anchor}"` : ''} ${opts.color ? `fill="${opts.color}"` : `class="${opts.cls ?? 's'}"`}>${esc(s)}</text>`
  const left = 64
  const right = w - 16
  const yMain = 14
  // On main itself there is no branch: main's latest commits, the unpushed ones dashed.
  if (b.branch && b.branch === b.base) {
    const recent = [...b.log].reverse().slice(-12)
    const gap = recent.length > 1 ? Math.min(34, (right - left - 150) / (recent.length - 1)) : 0
    const parts = [text(4, yMain + 4, b.base, { cls: 's' }), `<line x1="${left}" x2="${right}" y1="${yMain}" y2="${yMain}" stroke="${INK.gray}" stroke-opacity=".55" stroke-width="2"/>`]
    recent.forEach((k, i) => {
      const x = left + 14 + gap * i
      const mine = k.at >= sessionStart
      parts.push(k.isPushed ? `<circle cx="${x}" cy="${yMain}" r="4.5" fill="${mine ? ink : INK.gray}" stroke="${mine ? ink : INK.gray}" stroke-width="2"/>` : `<circle cx="${x}" cy="${yMain}" r="4.5" class="card" stroke="${ink}" stroke-width="2" stroke-dasharray="2 2"/>`)
    })
    const unpushed = b.log.filter(k => !k.isPushed).length
    parts.push(text(left + 14 + gap * Math.max(0, recent.length - 1) + 12, yMain - 6, unpushed ? `${unpushed} not pushed` : b.remote ? 'up to date with GitHub' : 'no GitHub remote', { color: unpushed ? INK.amber : undefined, cls: 's', size: 10.5 }))
    c.space(8).raw(parts.join(''), 26)
    c.text(`You're on ${b.base} itself, no feature branch${b.dirty ? ` · ${b.dirty} uncommitted` : ''}`, { cls: 'm', size: 11, lines: 1 })
    return c.svg()
  }
  const yBranch = 46
  const yStaging = 78
  const fork = left + 18
  const parts: string[] = []
  // main
  parts.push(text(4, yMain + 4, b.base ?? 'main', { cls: 's' }), `<line x1="${left}" x2="${right}" y1="${yMain}" y2="${yMain}" stroke="${INK.gray}" stroke-opacity=".55" stroke-width="2"/>`, `<circle cx="${fork}" cy="${yMain}" r="3.5" fill="${INK.gray}"/>`)
  const own = [...b.log].reverse()
  const shown = own.slice(-10)
  const span = Math.max(60, (right - fork - 60) * 0.62)
  const step = shown.length > 1 ? span / (shown.length - 1) : 0
  const x0 = fork + 34
  const tipX = shown.length ? x0 + step * (shown.length - 1) : fork + 18 // no commits: the branch is just its start
  // main since the fork
  if (b.behindBase) {
    const n = Math.min(6, b.behindBase)
    for (let i = 0; i < n; i++) parts.push(`<circle cx="${fork + 24 + i * 12}" cy="${yMain}" r="2.6" fill="${INK.gray}" fill-opacity=".8"/>`)
    parts.push(text(fork + 24 + n * 12 + 2, yMain - 5, `+${b.behindBase} on ${b.base ?? 'main'} since you branched`, { cls: 'm', size: 10 }))
  }
  // the branch
  parts.push(text(4, yBranch + 4, tag === '⎇' ? 'branch' : tag, { color: ink }), `<path d="M${fork} ${yMain} C ${fork} ${yBranch}, ${fork} ${yBranch}, ${fork + 18} ${yBranch} L ${tipX} ${yBranch}" fill="none" stroke="${ink}" stroke-width="2"/>`)
  if (own.length > shown.length) parts.push(text(fork + 20, yBranch - 6, `+${own.length - shown.length} earlier`, { cls: 'm', size: 9.5 }))
  shown.forEach((k, i) => {
    const x = x0 + step * i
    const mine = k.at >= sessionStart
    parts.push(k.isPushed ? `<circle cx="${x}" cy="${yBranch}" r="4.5" fill="${mine ? ink : 'none'}" stroke="${ink}" stroke-width="2"${mine ? '' : ' class="card"'}/>` : `<circle cx="${x}" cy="${yBranch}" r="4.5" class="card" stroke="${ink}" stroke-width="2" stroke-dasharray="2 2"/>`)
  })
  const unpushed = b.log.filter(k => !k.isPushed).length
  parts.push(text(tipX + 10, yBranch + 4, shown.length ? `${plural(b.commits, 'commit')}${unpushed ? ` · ${unpushed} not pushed` : ''}` : `no commits yet${b.dirty ? ` · ${b.dirty} uncommitted` : ''}`, { color: unpushed || (!shown.length && b.dirty) ? INK.amber : undefined, cls: shown.length ? 's' : 'm', size: 10.5 }))
  // staging and the PR
  let h = yBranch + 16
  if (b.staging) {
    const toStaging = pr?.base === 'staging' || b.staging.isIn
    parts.push(text(4, yStaging + 4, 'staging', { cls: 's' }), `<line x1="${left}" x2="${right}" y1="${yStaging}" y2="${yStaging}" stroke="${INK.teal}" stroke-opacity=".55" stroke-width="2"/>`)
    if (toStaging) {
      const merged = b.staging.isIn || pr?.state === 'MERGED'
      parts.push(`<path d="M${tipX} ${yBranch + 5} C ${tipX} ${yStaging}, ${tipX} ${yStaging}, ${tipX + 22} ${yStaging}" fill="none" stroke="${merged ? INK.teal : ink}" stroke-width="2"${merged ? '' : ' stroke-dasharray="4 3"'}/>`, `<circle cx="${tipX + 22}" cy="${yStaging}" r="3.5" fill="${merged ? INK.teal : 'none'}" stroke="${merged ? INK.teal : ink}" stroke-width="1.5"/>`)
      parts.push(text(tipX + 30, yStaging - 5, merged ? 'in staging' : pr ? `PR #${pr.number} open` : '', { color: merged ? INK.teal : undefined, cls: 's', size: 10.5 }))
    } else parts.push(text(tipX + 10, yStaging - 5, b.staging.ahead ? `${plural(b.staging.ahead, 'commit')} not in staging` : 'nothing new for staging', { cls: 'm', size: 10.5 }))
    h = yStaging + 14
  }
  c.raw(parts.join(''), h)
  return c.svg()
}

/** The branch's commits as a rail, newest on top, the ones from this session marked. */
export function drawCommits(b: Branch, w: number, now: number, sessionStart: number): string {
  const c = new Canvas(w, 2)
  const ink = SIDE_INK[b.side] ?? INK.clay
  const rows = b.log.slice(0, 12)
  const top = c.height
  rows.forEach((k, i) => {
    const mine = k.at >= sessionStart
    c.line(
      [{ t: '', size: 11 }, { t: k.subject, size: 12, bold: mine, cls: mine ? 't' : 's', grow: true, gap: 22 }],
      [...(mine ? [{ t: 'this session', pill: ink, size: 9.5 } as Seg] : []), ...(k.isPushed ? [] : [{ t: 'not pushed', pill: INK.amber, size: 9.5 } as Seg]), { t: k.author.split(' ')[0] ?? '', cls: 'm', size: 10.5 }, { t: k.sha, mono: true, cls: 'm', size: 10.5 }, { t: ago(k.at, now), cls: 'm', size: 10.5 }],
      20,
    )
  })
  // the rail: one line through the dots, drawn over the rows' left gutter
  const rail = rows.map((k, i) => {
    const y = top + i * 20 + 10
    return k.isPushed ? `<circle cx="9" cy="${y}" r="3.6" fill="${ink}"/>` : `<circle cx="9" cy="${y}" r="3.6" class="card" stroke="${ink}" stroke-width="1.6"/>`
  })
  if (rows.length) c.overlay(`<line x1="9" x2="9" y1="${top + 10}" y2="${top + (rows.length - 1) * 20 + 10}" stroke="${ink}" stroke-opacity=".5" stroke-width="2"/>${rail.join('')}`)
  if (b.log.length > rows.length) c.text(`+${b.log.length - rows.length} older`, { cls: 'm', size: 11, lines: 1, indent: 22 })
  if (!rows.length) c.text('No commits on this branch yet.', { cls: 'm', size: 11.5, lines: 1 })
  return c.svg()
}

/** One Overview row: a fixed label column, the summary, facts on the right; its tab opens from the button beside it. */
export function drawRow(label: string, left: Seg[], right: Seg[], w: number): string {
  const c = new Canvas(w, 2)
  const first = left[0]
  c.line([{ t: label.toUpperCase(), cls: 'm', size: 9.5, bold: true }, ...(first ? [{ ...first, gap: Math.max(8, 74 - width(label.toUpperCase(), 9.5 * FONT, { bold: true })) }, ...left.slice(1)] : [])], right, 24)
  return c.svg()
}

/** Skills & plugins: what this session used, this project's skills, the plugins on, your global skills. */
export function drawKit(k: Kit, w: number): string {
  const c = new Canvas(w, 2)
  const chips = (items: Seg[], h = 22): void => {
    let row: Seg[] = []
    let used = 0
    for (const it of items) {
      const size = width(it.t ?? '', (it.size ?? 11) * FONT) + 22
      if (row.length && used + size > w - 20) {
        c.line(row, [], h)
        row = []
        used = 0
      }
      row.push(it)
      used += size
    }
    if (row.length) c.line(row, [], h)
  }
  c.label('Used in this session', k.used.length ? `${k.used.reduce((n, u) => n + u.count, 0)} runs` : '', INK.clay)
  if (k.used.length) chips(k.used.map(u => ({ t: u.count > 1 ? `${u.name} ×${u.count}` : u.name, pill: INK.clay, size: 11 })))
  else c.text('No skill or slash command used yet.', { cls: 'm', size: 11.5, lines: 1 })
  c.space(8).label('This project', plural(k.projectSkills.length, 'skill'), INK.blue)
  if (!k.projectSkills.length) c.text('This project has no skills of its own (.claude/skills).', { cls: 'm', size: 11.5, lines: 1 })
  for (const sk of k.projectSkills) {
    c.line([{ t: sk.name, bold: true, size: 12.5 }, { t: sk.description, cls: 's', size: 11.5, grow: true }], sk.where ? [{ t: sk.where, cls: 'm', size: 10.5 }] : [], 21)
  }
  c.space(8).label('Plugins on', `${k.plugins.filter(p => p.scope === 'project').length} for this project · ${k.plugins.filter(p => p.scope === 'user').length} everywhere`, INK.purple)
  for (const p of k.plugins) {
    c.line([{ t: p.name, bold: true, size: 12.5 }, ...(p.scope === 'project' ? [{ t: 'this project', pill: INK.purple, size: 10 } as Seg] : []), { t: p.commands.length ? p.commands.slice(0, 6).map(x => `/${x}`).join('  ') : '', cls: 'm', size: 11, mono: true, grow: true }], [{ t: p.commands.length ? plural(p.commands.length, 'command') : '', cls: 's', size: 10.5 }], 21)
  }
  c.space(8).label('Your global skills', plural(k.globalSkills.length, 'skill'), INK.gray)
  if (k.globalSkills.length) chips(k.globalSkills.map(sk => ({ t: sk.name, pill: INK.gray, size: 10.5 })), 20)
  else c.text('None in ~/.claude/skills.', { cls: 'm', size: 11.5, lines: 1 })
  return c.svg()
}
