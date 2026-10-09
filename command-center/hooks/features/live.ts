import type { SessionMeasureInput, ToolCallInput, ToolCallResult } from 'claude-code'

import type { Agent, Beat, Repo, Status, Todo, Touch, Usage } from '../../types'
import { config } from '../lib/config'
import { basename, clean, lines, money, pct } from '../lib/fmt'
import { git, json } from '../lib/io'
import type { Io } from '../lib/io'

// The live session: usage, tasks, agents, touched files, repo status and
// status (working / waiting / idle). It also writes this session's heartbeat
// to ~/.claude/command-center/sessions/<id>.json and reads every other
// session's, which is how the Sessions tab sees all projects at once.
// Plain handlers: register.tsx wires each event once and calls these.

export const me = { home: '', id: '', root: '', cwd: '', title: '', dir: '', startedAt: 0, lastPrompt: '' }

/** The turn being run, for the receipt under the answer. */
export const turn = { tools: 0, edits: 0, added: 0, removed: 0, files: new Set<string>(), startedAt: 0 }

const BEAT_MS = 10_000
const STALE_MS = 45_000 // three missed beats: the session's process is gone
const SHOW_ENDED_MS = 30 * 60_000
const DONE = new Set(['completed', 'failed', 'killed'])
const alerted = new Set<string>()

type RawUsage = Pick<SessionMeasureInput, 'context' | 'cost' | 'rateLimits'>

const toUsage = (u: RawUsage): Usage => ({
  contextPct: u.context.percent ?? null,
  contextTokens: u.context.tokens ?? null,
  window: u.context.window ?? null,
  costUsd: u.cost?.usd ?? null,
  limits: u.rateLimits.map(r => ({ kind: r.kind, percent: r.percentUsed, resetsAt: r.resetsAt ?? null })),
})

const chime = (io: Io): void => {
  if (config.isChiming) io.chime()
}

// ---- session start / end

export async function onStart(io: Io): Promise<void> {
  const session = await io.session()
  me.home = await io.home()
  me.id = session.id
  me.cwd = session.cwd
  me.root = session.root
  me.dir = `${me.home}/.claude/command-center/sessions`
  me.startedAt = (await io.usage())?.startedAt ?? (await io.now())
  void boot(io)
}

async function boot(io: Io): Promise<void> {
  await io.run(['mkdir', '-p', me.dir])
  await refreshUsage(io)
  await refreshRepo(io)
  await beat(io)
  io.every(BEAT_MS, () => void beat(io))
  io.every(30_000, () => void refreshRepo(io))
  io.every(3_000, () => void refreshAgents(io))
}

export async function onEnd(io: Io): Promise<void> {
  if (!me.id || !me.dir) return
  const now = await io.now()
  const mine = json<Beat>(await io.read(`${me.dir}/${me.id}.json`).catch(() => ''))
  if (mine) await io.write(`${me.dir}/${me.id}.json`, JSON.stringify({ ...mine, status: 'ended', updatedAt: now })).catch(() => undefined)
}

// ---- usage: pushed after each turn and when a limit moves

export async function onMeasure(io: Io, e: SessionMeasureInput): Promise<void> {
  const usage = toUsage(e)
  await io.s.usage.set(() => usage)
  thresholds(io, usage)
}

export async function refreshUsage(io: Io): Promise<void> {
  const u = await io.usage()
  if (u) await io.s.usage.set(() => toUsage(u))
}

function thresholds(io: Io, u: Usage): void {
  const once = (key: string, text: string): void => {
    if (alerted.has(key)) return
    alerted.add(key)
    io.toast(text, 8000)
  }
  if (u.contextPct != null && u.contextPct >= config.contextAlert) once('ctx', `✻ Context ${pct(u.contextPct)} full — /compact soon to keep quality up`)
  if (u.costUsd != null && config.budget > 0) {
    for (const mark of [50, 80, 100]) {
      if (u.costUsd >= (config.budget * mark) / 100) once(`cost${mark}`, `✻ ${money(u.costUsd)} spent — ${mark}% of this session's ${money(config.budget)} budget`)
    }
  }
  for (const limit of u.limits) {
    if (limit.percent >= 80) once(`limit-${limit.kind}`, `✻ ${limit.kind.replace('_', '-')} usage limit at ${pct(limit.percent)}`)
  }
}

// ---- status: working / waiting for you / idle

async function setStatus(io: Io, status: Status, waitingFor: string | null = null): Promise<void> {
  await io.s.status.set(() => status)
  await io.s.waitingFor.set(() => waitingFor)
  void beat(io)
}

export function onPrompt(text: string): void {
  me.lastPrompt = clean(text, 160)
  if (!me.title && text.trim() && !text.startsWith('/')) me.title = clean(text, 80)
}

export async function onTurnStart(io: Io): Promise<void> {
  turn.tools = 0
  turn.edits = 0
  turn.added = 0
  turn.removed = 0
  turn.files = new Set()
  turn.startedAt = await io.now()
  void setStatus(io, 'working')
}

export async function onTurnComplete(io: Io, agentId: string | undefined, usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined): Promise<void> {
  if (agentId) {
    if (!usage) return
    const tokensIn = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    await io.s.agents.set(list => list.map(a => (a.id === agentId ? { ...a, tokensIn: a.tokensIn + tokensIn, tokensOut: a.tokensOut + (usage.output_tokens ?? 0) } : a)))
    return
  }
  void setStatus(io, 'idle')
  void refreshUsage(io)
}

export async function onNotification(io: Io, type: string, message: string): Promise<void> {
  if (type !== 'permission_prompt' && type !== 'elicitation_dialog') return
  await setStatus(io, 'waiting', clean(message, 120))
  chime(io)
}

// ---- every tool call: touched files, todos, agent activity, the receipt

export async function beforeTool(io: Io, e: ToolCallInput): Promise<void> {
  if (String(e.tool) !== 'AskUserQuestion') return
  await setStatus(io, 'waiting', 'a question for you')
  chime(io)
}

export async function afterTool(io: Io, e: ToolCallInput, ran: ToolCallResult): Promise<void> {
  const tool = String(e.tool)
  const input = e as unknown as Record<string, unknown>
  if (tool === 'AskUserQuestion') void setStatus(io, 'working')
  if (e.agentId) {
    const id = e.agentId
    await io.s.agents.set(list => list.map(a => (a.id === id ? { ...a, tools: a.tools + 1, lastTool: tool } : a)))
  } else {
    turn.tools += 1
  }
  if (ran.deny !== undefined || ran.isError === true) return

  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    const todos: Todo[] = (input.todos as Todo[]).map(t => ({
      content: clean(String(t.content), 200),
      status: t.status,
      activeForm: t.activeForm ? clean(String(t.activeForm), 200) : undefined,
    }))
    await io.s.todos.set(() => todos)
  }

  const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null
  if (!path || !['Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return
  const isRead = tool === 'Read'
  let added = 0
  let removed = 0
  if (tool === 'Edit') {
    added = lines(String(input.new_string ?? ''))
    removed = lines(String(input.old_string ?? ''))
  } else if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const edit of input.edits as { old_string?: string; new_string?: string }[]) {
      added += lines(edit.new_string)
      removed += lines(edit.old_string)
    }
  } else if (tool === 'Write') {
    added = lines(String(input.content ?? ''))
  }
  if (!isRead && !e.agentId) {
    turn.edits += 1
    turn.added += added
    turn.removed += removed
    turn.files.add(path)
  }
  const at = await io.now()
  await io.s.touched.set(list => {
    const old = list.find(t => t.path === path)
    const next: Touch = old
      ? { ...old, reads: old.reads + (isRead ? 1 : 0), edits: old.edits + (isRead ? 0 : 1), added: old.added + added, removed: old.removed + removed, at }
      : { path, reads: isRead ? 1 : 0, edits: isRead ? 0 : 1, created: tool === 'Write', added, removed, at }
    return [next, ...list.filter(t => t.path !== path)].slice(0, 400)
  })
}

// ---- subagents: the engine's list, merged with what was counted here

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
        description: clean(info.description, 120),
        status: info.status,
        tools: prior?.tools ?? 0,
        lastTool: prior?.lastTool ?? null,
        tokensIn: prior?.tokensIn ?? 0,
        tokensOut: prior?.tokensOut ?? 0,
        startedAt: prior?.startedAt ?? now,
        endedAt: DONE.has(info.status) ? (prior?.endedAt ?? now) : null,
      }
    })
    return JSON.stringify(merged) === JSON.stringify(old) ? old : merged
  })
}

// ---- the session's git repository

async function refreshRepo(io: Io): Promise<void> {
  const top = await git(io, me.root, 'rev-parse', '--show-toplevel')
  if (!top.ok) {
    await io.s.repo.set(() => null)
    return
  }
  const root = top.out
  const status = await git(io, root, 'status', '--porcelain=v1', '-b', '--untracked-files=normal')
  const [head = '', ...rest] = status.out.split('\n')
  const branch = /^## (?:No commits yet on )?([^.\s]+)/.exec(head)?.[1] ?? null
  const marks = rest.filter(Boolean).map(line => ({ code: line.slice(0, 2).trim() || '?', path: `${root}/${line.slice(3).replace(/^.* -> /, '')}` }))
  const base = (await git(io, root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).out || null
  let baseAhead = 0
  let baseBehind = 0
  if (base && branch && `origin/${branch}` !== base) {
    const [left, right] = (await git(io, root, 'rev-list', '--left-right', '--count', `${base}...HEAD`)).out.split(/\s+/).map(Number)
    baseBehind = left ?? 0
    baseAhead = right ?? 0
  }
  const repo: Repo = {
    root,
    branch,
    upstream: /\.\.\.(\S+)/.exec(head)?.[1] ?? null,
    ahead: Number(/ahead (\d+)/.exec(head)?.[1] ?? 0),
    behind: Number(/behind (\d+)/.exec(head)?.[1] ?? 0),
    dirty: marks.length,
    base,
    baseAhead,
    baseBehind,
  }
  await io.s.repo.set(old => (JSON.stringify(old) === JSON.stringify(repo) ? old : repo))
  await io.s.git.set(old => (JSON.stringify(old) === JSON.stringify(marks) ? old : marks))
}

// ---- heartbeats: write mine, read everyone's

async function beat(io: Io): Promise<void> {
  if (!me.id || !me.dir) return
  const now = await io.now()
  const [usage, agents, todos, status, waitingFor, repo] = await Promise.all([
    io.s.usage.get(), io.s.agents.get(), io.s.todos.get(), io.s.status.get(), io.s.waitingFor.get(), io.s.repo.get(),
  ])
  const active = todos.find(t => t.status === 'in_progress')
  const mine: Beat = {
    id: me.id,
    cwd: me.cwd,
    project: basename(repo?.root ?? me.root),
    branch: repo?.branch ?? null,
    title: me.title || 'New session',
    task: active ? (active.activeForm ?? active.content) : me.lastPrompt || null,
    progress: todos.length ? { done: todos.filter(t => t.status === 'completed').length, total: todos.length } : null,
    status,
    waitingFor,
    contextPct: usage?.contextPct ?? null,
    costUsd: usage?.costUsd ?? null,
    agents: agents.filter(a => !DONE.has(a.status)).length,
    startedAt: me.startedAt,
    updatedAt: now,
  }
  await io.write(`${me.dir}/${me.id}.json`, JSON.stringify(mine)).catch(() => undefined)

  const beats: Beat[] = []
  for (const entry of await io.list(me.dir).catch(() => [])) {
    if (!entry.name.endsWith('.json')) continue
    const path = `${me.dir}/${entry.name}`
    if (entry.mtimeMs && now - entry.mtimeMs > 24 * 3600_000) {
      void io.run(['rm', '-f', path])
      continue
    }
    const one = entry.name === `${me.id}.json` ? mine : json<Beat>(await io.read(path).catch(() => ''))
    if (!one) continue
    const shown: Beat = one.status !== 'ended' && now - one.updatedAt > STALE_MS ? { ...one, status: 'ended' } : one
    if (shown.status === 'ended' && now - shown.updatedAt > SHOW_ENDED_MS) continue
    beats.push(shown)
  }
  const rank: Record<Status, number> = { waiting: 0, working: 1, idle: 2, ended: 3 }
  beats.sort((a, b) => rank[a.status] - rank[b.status] || b.updatedAt - a.updatedAt)
  await io.s.sessions.set(old => (JSON.stringify(old) === JSON.stringify(beats) ? old : beats))
}
