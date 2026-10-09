import type { After, Agent, Beat, Branch, Deploy, Edit, Env, Focus, Github, Goal, Held, Pr, Rule, Status, Ticket, Touch, Usage } from '../../types'
import { ago, basename, dirname, dur, money, plural, tokens } from '../lib/fmt'
import { Canvas, INK, loadInk, statusInk } from '../lib/svg'
import type { Seg } from '../lib/svg'

// Every desktop drawing of the command center, as pure functions from state
// to one SVG string: the bar above the prompt, the three cards (after a turn,
// reflect, guard) and each section of the side panel. Buttons are not drawn
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
  const c = new Canvas(w, 12, { bar: true }, true).space(3)
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
  const c = new Canvas(w, 0, { icon: 'bulb', ink: INK.amber }, true).space(12)
  c.label('You should know', isLoading ? 'checking the task you just finished…' : 'about the task you just finished', INK.amber)
  if (isLoading) c.text('Looking for risks, side effects and decisions left to you…', { cls: 'm', size: 12.5, lines: 1 })
  for (const k of know.slice(0, 3)) c.text(k, { size: 13.5, lines: 3, bullet: INK.amber })
  c.space(8)
  return c.svg()
}

/** What's next: a header for the suggestion buttons under it (they only fill the prompt box). */
export function drawNext(w: number): string {
  const c = new Canvas(w, 14, { bar: true }, true).space(4)
  c.label("What's next", 'click one, or press 1–3: it goes into your prompt box, nothing is sent', INK.blue)
  return c.space(2).svg()
}

/** Replay: the edits of the task you just finished, ready to step through. */
export function drawReplay(a: After, files: string[], w: number): string {
  const c = new Canvas(w, 0, { icon: 'play', ink: INK.clay }, true).space(12)
  const stats = [dur(a.durationMs), a.tools ? plural(a.tools, 'tool') : '', a.costUsd != null ? money(a.costUsd) : ''].filter(Boolean).join(' · ')
  c.label('Replay', stats, INK.clay)
  c.line([{ t: `${plural(a.edits, 'edit')} ready to replay`, bold: true, size: 14 }, { t: `+${a.added} −${a.removed}`, cls: 's', size: 12.5 }], [], 24)
  c.text(files.map(f => basename(f)).join(' · '), { cls: 's', size: 12, lines: 1 })
  c.space(6)
  return c.svg()
}

/** A correction you made, offered as a rule. */
export function drawRule(r: Rule, w: number, target: string): string {
  const c = new Canvas(w, 0, { icon: 'bookmark', ink: INK.green }, true).space(12)
  c.label('Save this as a rule?', `${Math.round(r.confidence * 100)}% sure`, INK.green)
  c.text(`“${r.rule}”`, { size: 14.5, lines: 3 })
  c.text(`From what you said: “${r.quote}”`, { cls: 's', size: 12, lines: 2 })
  c.text(`Goes to ${target}`, { cls: 'm', size: 11.5, lines: 1 })
  c.space(6)
  return c.svg()
}

/** A risky command held until you answer. */
export function drawHeld(h: Held, w: number): string {
  const c = new Canvas(w, 0, { icon: h.title === 'Recursive delete' ? 'trash' : 'shield', ink: INK.red }, true).space(12)
  c.label(`Held · ${h.title}`, 'waiting for you', INK.red)
  c.line([{ t: h.command, mono: true, size: 13, bold: true, grow: true }], [], 22)
  c.text(h.summary, { color: INK.red, size: 14, lines: 2 })
  if (h.note) c.text(h.note, { cls: 's', size: 12, lines: 2 })
  for (const l of h.lines.slice(0, 6)) c.line([{ t: l.name, mono: true, size: 12, cls: 't', grow: true }], [{ t: l.detail, cls: 's', size: 11.5 }], 19)
  if (h.lines.length > 6) c.text(`+${h.lines.length - 6} more`, { cls: 'm', size: 11.5, lines: 1 })
  c.space(6)
  return c.svg()
}

/** One switch of the Controls section: its name, what it does, and its state. */
export function drawToggle(name: string, what: string, isOn: boolean, w: number): string {
  const c = new Canvas(w, 2)
  const sw = isOn ? INK.green : INK.gray
  c.raw(
    `<rect x="${w - 40}" y="6" width="34" height="20" rx="10" fill="${sw}" fill-opacity="${isOn ? 1 : 0.35}"/>` +
      `<circle cx="${isOn ? w - 16 : w - 30}" cy="16" r="7.5" fill="#fff"/>`,
    0,
  )
  c.line([{ t: name, bold: true, size: 13 }, { t: isOn ? 'on' : 'off', pill: isOn ? INK.green : INK.gray, size: 10.5 }], [{ t: '', size: 10, gap: 0 }, { t: '', size: 10, gap: 36 }], 22)
  c.text(what, { cls: 's', size: 12, lines: 2, reserve: 52 })
  return c.svg()
}

// ---- the side panel's sections

export function drawOverview(d: BarInput & { agents: Agent[]; startedAt: number; now: number; others: Beat[]; goal: Goal | null }, w: number): string {
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
  if (d.ticket) {
    c.line([{ dot: statusInk(d.ticket.status, d.ticket.category) }, { t: d.ticket.key, bold: true }, { t: d.ticket.status, pill: statusInk(d.ticket.status, d.ticket.category), size: 11 }, { t: d.ticket.summary, grow: true }], [], 22)
  }
  for (const b of d.focus?.branches ?? []) {
    c.line(
      [{ t: SIDE_LABEL[b.side], pill: b.side === 'frontend' ? INK.teal : b.side === 'backend' ? INK.purple : INK.gray, size: 10.5, bold: true }, { t: b.branch ?? '(detached)', mono: true, size: 12, grow: true }],
      [{ t: plural(b.commits, 'commit'), cls: 's', size: 11.5 }, ...(b.unpushed ? [{ t: `↑${b.unpushed} unpushed`, color: INK.amber, size: 11.5 } as Seg] : []), ...(b.dirty ? [{ t: `${b.dirty} uncommitted`, color: INK.amber, size: 11.5 } as Seg] : []), ...(b.behindBase ? [{ t: `${b.behindBase} behind ${b.base ?? 'main'}`, cls: 'm', size: 11.5 } as Seg] : [])],
      21,
    )
    if (b.last && b.commits > 0) c.line([{ t: '', size: 10, gap: 0 }, { t: `last: ${b.last.subject}`, cls: 'm', size: 11.5, grow: true }], [{ t: `${ago(b.last.at, d.now)} ago`, cls: 'm', size: 11.5 }], 18)
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
  const needYou = d.others.filter(s => s.status === 'waiting')
  if (d.others.length) {
    c.line([{ t: `${plural(d.others.length, 'other session')}`, cls: 's', size: 12 }, ...(needYou.length ? [{ t: `${needYou.length} need you`, pill: INK.amber, size: 11 } as Seg] : [])], [], 20)
    for (const s of d.others.slice(0, 4)) {
      c.line(
        [{ dot: s.status === 'waiting' ? INK.amber : s.status === 'working' ? INK.clay : INK.gray, live: s.status !== 'idle' }, { t: s.project, size: 12 }, { t: s.ticket ?? s.branch ?? '', cls: 'm', size: 11.5, mono: true }, { t: s.status === 'waiting' ? (s.waitingFor ?? 'needs you') : s.title, cls: 's', size: 11.5, grow: true }],
        [{ t: s.contextPct != null ? `${Math.round(s.contextPct)}%` : '', color: loadInk(s.contextPct), size: 11 }, { t: money(s.costUsd), cls: 'm', size: 11 }],
        19,
      )
    }
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
export function drawTimeline(edits: Edit[], current: number, w: number, root: string): string {
  const c = new Canvas(w, 2)
  const total = edits.reduce((n, e) => ({ a: n.a + e.added, r: n.r + e.removed }), { a: 0, r: 0 })
  c.label(`${plural(edits.length, 'edit')} in ${plural(new Set(edits.map(e => e.path)).size, 'file')}`, `+${total.a} −${total.r}`)
  edits.forEach((e, i) => {
    const rel = e.path.startsWith(`${root}/`) ? e.path.slice(root.length + 1) : e.path
    const isNow = i === current
    const y = c.y
    c.raw(
      (isNow ? `<rect x="0" y="0" width="${w}" height="24" rx="7" fill="${INK.clay}" fill-opacity=".14"/>` : '') +
        `<circle cx="13" cy="12" r="8.5" ${isNow ? `fill="${INK.clay}"` : 'fill="none" class="ln" stroke-width="1.2"'}/>` +
        `<text x="13" y="16" text-anchor="middle" font-family="ui-sans-serif, -apple-system, sans-serif" font-size="10.5" font-weight="600" ${isNow ? 'fill="#fff"' : 'class="s"'}>${i + 1}</text>`,
      0,
    )
    c.y = y
    c.line([{ t: '', gap: 0, size: 10 }, { t: '', gap: 20, size: 10 }, { t: basename(rel), bold: isNow, size: 12.5 }, { t: dirname(rel) === '/' ? '' : `in ${dirname(rel)}`, cls: 'm', size: 11.5, grow: true }], [{ t: `+${e.added}`, color: INK.green, size: 11.5 }, { t: `−${e.removed}`, color: INK.red, size: 11.5, gap: 5 }], 24)
  })
  return c.svg()
}

/** Unified diff text for one edit, for the engine's own diff renderer. */
export function unified(e: Edit, root: string): string {
  const rel = e.path.startsWith(`${root}/`) ? e.path.slice(root.length + 1) : basename(e.path)
  const before = e.before ? e.before.split('\n') : []
  const after = e.after ? e.after.split('\n') : []
  return [`--- a/${rel}`, `+++ b/${rel}`, `@@ -1,${before.length} +1,${after.length} @@`, ...before.map(l => `-${l}`), ...after.map(l => `+${l}`)].join('\n')
}
