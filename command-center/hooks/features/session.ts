import type { SessionMeasureInput, ToolCallInput, ToolCallResult, TurnUsage } from 'claude-code'

import type { Activity, Agent, Beat, Edit, Status, Touch, Usage } from '../../types'
import { basename, clean, lines, pct } from '../lib/fmt'
import { json } from '../lib/io'
import type { Io } from '../lib/io'

// The live session: usage, status (working / waiting / idle), subagents with
// their own token counts, the files touched, every edit (for Replay), what
// Claude is doing right now, and a heartbeat file per session in
// ~/.claude/command-center/sessions so each session can see the others.

export const me = { home: '', id: '', root: '', cwd: '', title: '', dir: '', startedAt: 0, lastPrompt: '', lastAsk: '' }

/** The turn being run: counts for the card after it. */
export const turn = { id: '', tools: 0, files: new Set<string>(), added: 0, removed: 0, startedAt: 0, costAtStart: null as number | null }

const DONE = new Set(['completed', 'failed', 'killed'])
const alerted = new Set<string>()
let editId = 0

type RawUsage = Pick<SessionMeasureInput, 'context' | 'cost' | 'rateLimits'>

const toUsage = (u: RawUsage): Usage => ({
  contextPct: u.context.percent ?? null,
  contextTokens: u.context.tokens ?? null,
  window: u.context.window ?? null,
  costUsd: u.cost?.usd ?? null,
  limits: u.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt ?? null })),
})

export async function sessionStart(io: Io): Promise<void> {
  const session = await io.session()
  me.home = await io.home()
  me.id = session.id
  me.cwd = session.cwd
  me.root = session.root
  me.dir = `${me.home}/.claude/command-center/sessions`
  me.startedAt = (await io.usage())?.startedAt ?? (await io.now())
  const history = await io.messages().catch(() => [])
  const asked = history.filter(m => m.role === 'user' && isTyped(m.text))
  if (asked[0]) me.title = clean(asked[0].text, 80)
  if (asked.length) me.lastPrompt = clean(asked[asked.length - 1]!.text, 160)
  await io.run(['mkdir', '-p', me.dir])
  await refreshUsage(io)
  await beat(io)
  io.every(10_000, () => void beat(io))
  io.every(3_000, () => void refreshAgents(io))
}

export async function sessionEnd(io: Io): Promise<void> {
  if (!me.id) return
  const mine = json<Beat>(await io.read(`${me.dir}/${me.id}.json`).catch(() => ''))
  if (mine) await io.write(`${me.dir}/${me.id}.json`, JSON.stringify({ ...mine, status: 'ended', updatedAt: await io.now() })).catch(() => undefined)
}

export async function refreshUsage(io: Io): Promise<void> {
  const u = await io.usage()
  if (u) await io.s.usage.set(() => toUsage(u))
}

export async function measured(io: Io, e: RawUsage): Promise<void> {
  const u = toUsage(e)
  await io.s.usage.set(() => u)
  const once = (key: string, text: string): void => {
    if (alerted.has(key)) return
    alerted.add(key)
    io.toast(text, 8000)
  }
  if (u.contextPct != null && u.contextPct >= 85) once('ctx', `✻ Context ${pct(u.contextPct)} full — /compact soon to keep quality up`)
  for (const l of u.limits) if (l.percent >= 80) once(`limit-${l.kind}`, `✻ ${l.kind.replace('_', '-')} usage limit at ${pct(l.percent)}`)
}

// ---- status

export async function setStatus(io: Io, status: Status, waitingFor: string | null = null): Promise<void> {
  await io.s.status.set(() => status)
  await io.s.waitingFor.set(() => waitingFor)
  void beat(io)
}

/** A prompt the person typed: not a command, a system note or "[Request interrupted…]". */
const isTyped = (text: string): boolean => !!text.trim() && !/^\s*[/<[]/.test(text)

export function prompted(text: string): void {
  if (!isTyped(text)) return
  me.lastPrompt = clean(text, 160)
  me.lastAsk = text.slice(0, 2000)
  if (!me.title) me.title = clean(text, 80)
}

export async function turnStarted(io: Io, turnId: string): Promise<void> {
  turn.id = turnId
  turn.tools = 0
  turn.files = new Set()
  turn.added = 0
  turn.removed = 0
  turn.startedAt = await io.now()
  turn.costAtStart = (await io.usage())?.cost?.usd ?? null
  await setStatus(io, 'working')
}

export async function turnEnded(io: Io): Promise<void> {
  await io.s.activity.set(() => null)
  await setStatus(io, 'idle')
  await refreshUsage(io)
}

// ---- subagents: the engine's list, plus tokens counted per model request

export async function agentSpawned(io: Io, id: string, model: string, type: string, description: string): Promise<void> {
  const now = await io.now()
  await io.s.agents.set(list => [
    ...list.filter(a => a.id !== id),
    { id, name: type, type, model, description: clean(description, 120), status: 'running', tools: 0, lastTool: null, tokens: 0, contextTokens: 0, costUsd: 0, startedAt: now, endedAt: null },
  ])
}

export async function agentStep(io: Io, agentId: string, usage: TurnUsage | null): Promise<void> {
  if (!usage) return
  const context = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.output_tokens ?? 0)
  await io.s.agents.set(list => list.map(a => (a.id === agentId ? { ...a, tokens: a.tokens + context, contextTokens: context } : a)))
}

async function refreshAgents(io: Io): Promise<void> {
  const list = await io.agents()
  if (!list) return
  const now = await io.now()
  await io.s.agents.set(old => {
    const merged: Agent[] = list.map(info => {
      const prior = old.find(a => a.id === info.id)
      return {
        id: info.id,
        name: info.name ?? info.type,
        type: info.type,
        model: prior?.model ?? null,
        description: clean(info.description, 120),
        status: info.status,
        tools: prior?.tools ?? 0,
        lastTool: prior?.lastTool ?? null,
        tokens: prior?.tokens ?? 0,
        contextTokens: prior?.contextTokens ?? 0,
        costUsd: 0,
        startedAt: prior?.startedAt ?? now,
        endedAt: DONE.has(info.status) ? (prior?.endedAt ?? now) : null,
      }
    })
    return JSON.stringify(merged) === JSON.stringify(old) ? old : merged
  })
}

// ---- every tool call: what Claude is doing, touched files, edits for Replay

const VERB: Record<string, NonNullable<Activity>['verb']> = { Read: 'reading', Edit: 'editing', MultiEdit: 'editing', NotebookEdit: 'editing', Write: 'writing', Bash: 'running', Grep: 'searching', Glob: 'searching' }

export async function toolStarted(io: Io, e: ToolCallInput): Promise<void> {
  const tool = String(e.tool)
  if (tool === 'AskUserQuestion') await setStatus(io, 'waiting', 'a question for you')
  if (e.agentId || !VERB[tool]) return
  const input = e as unknown as Record<string, unknown>
  const target = String(input.file_path ?? input.notebook_path ?? input.command ?? input.pattern ?? '')
  const verb = VERB[tool]
  if (verb && target) {
    const at = await io.now()
    await io.s.activity.set(() => ({ verb, target: clean(target, 200), at }))
  }
}

export async function toolEnded(io: Io, e: ToolCallInput, ran: ToolCallResult): Promise<void> {
  const tool = String(e.tool)
  const input = e as unknown as Record<string, unknown>
  if (tool === 'AskUserQuestion') void setStatus(io, 'working')
  if (e.agentId) {
    const id = e.agentId
    await io.s.agents.set(list => list.map(a => (a.id === id ? { ...a, tools: a.tools + 1, lastTool: tool } : a)))
    return
  }
  turn.tools += 1
  if (ran.deny !== undefined || ran.isError === true) return
  const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null
  if (!path || !['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return
  const isRead = tool === 'Read'
  const changes: { before: string; after: string }[] =
    tool === 'Edit' ? [{ before: String(input.old_string ?? ''), after: String(input.new_string ?? '') }]
    : tool === 'MultiEdit' && Array.isArray(input.edits) ? (input.edits as { old_string?: string; new_string?: string }[]).map(x => ({ before: x.old_string ?? '', after: x.new_string ?? '' }))
    : tool === 'Write' ? [{ before: '', after: String(input.content ?? '') }]
    : []
  const added = changes.reduce((n, c) => n + lines(c.after), 0)
  const removed = changes.reduce((n, c) => n + lines(c.before), 0)
  const at = await io.now()
  if (!isRead) {
    turn.files.add(path)
    turn.added += added
    turn.removed += removed
    const fresh: Edit[] = changes.map(c => ({ id: ++editId, turnId: turn.id, path, tool, before: c.before.slice(0, 6000), after: c.after.slice(0, 6000), added: lines(c.after), removed: lines(c.before), at }))
    await io.s.edits.set(list => [...list, ...fresh].slice(-80))
  }
  await io.s.touched.set(list => {
    const old = list.find(t => t.path === path)
    const next: Touch = old
      ? { ...old, reads: old.reads + (isRead ? 1 : 0), edits: old.edits + (isRead ? 0 : 1), added: old.added + added, removed: old.removed + removed, at }
      : { path, reads: isRead ? 1 : 0, edits: isRead ? 0 : 1, created: tool === 'Write', added, removed, at, dependents: null }
    return [next, ...list.filter(t => t.path !== path)].slice(0, 300)
  })
}

// ---- heartbeats: write mine, read everyone's

let last: { project?: string; branch?: string | null; ticket?: string | null } = {}

export async function beat(io: Io, extra: { project?: string; branch?: string | null; ticket?: string | null } = last): Promise<void> {
  if (!me.id || !me.dir) return
  last = extra
  const now = await io.now()
  const [usage, agents, status, waitingFor] = [await io.s.usage.get(), await io.s.agents.get(), await io.s.status.get(), await io.s.waitingFor.get()]
  const mine: Beat = {
    id: me.id,
    project: extra.project ?? basename(me.root),
    root: me.root,
    branch: extra.branch ?? null,
    ticket: extra.ticket ?? null,
    title: me.lastPrompt || me.title || 'New session',
    status,
    waitingFor,
    contextPct: usage?.contextPct ?? null,
    costUsd: usage?.costUsd ?? null,
    agents: agents.filter(a => !a.endedAt).length,
    updatedAt: now,
  }
  await io.write(`${me.dir}/${me.id}.json`, JSON.stringify(mine)).catch(() => undefined)
  const beats: Beat[] = []
  for (const entry of await io.list(me.dir).catch(() => [])) {
    if (!entry.name.endsWith('.json') || entry.name === `${me.id}.json`) continue
    const path = `${me.dir}/${entry.name}`
    if (entry.mtimeMs && now - entry.mtimeMs > 24 * 3600_000) {
      void io.run(['rm', '-f', path])
      continue
    }
    const one = json<Beat>(await io.read(path).catch(() => ''))
    if (!one || one.status === 'ended' || now - one.updatedAt > 45_000) continue
    beats.push(one)
  }
  const rank: Record<Status, number> = { waiting: 0, working: 1, idle: 2, ended: 3 }
  beats.sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt)
  await io.s.sessions.set(old => (JSON.stringify(old) === JSON.stringify(beats) ? old : beats))
}
