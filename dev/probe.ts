// Runs the command center's real feature code against real repos and GitHub,
// through a stand-in for the engine (Node child_process / fs, in-memory
// state), then draws the bar and panel from that data into real.html.
// Run: npx -y tsx dev/probe.ts <ims-root> <transcript.jsonl> [jira-fixture.json]
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'

import type { Cells, Io } from '../command-center/hooks/lib/io'
import { refreshTicket } from '../command-center/hooks/features/jira'
import { refreshFocusPrs } from '../command-center/hooks/features/prs'
import { me } from '../command-center/hooks/features/session'
import { notice, refreshEnv, refreshFocus, ws } from '../command-center/hooks/features/workspace'
import { drawBar, drawJira, drawOverview, drawPr } from '../command-center/hooks/views/draw'

const [imsRoot = '', transcript = '', jiraFixture = ''] = process.argv.slice(2)
const state: Record<string, unknown> = { github: { focus: [], mine: [], deploys: [], at: 0, isLoading: false, error: null }, focus: null, env: null, ticket: null, worktrees: [], usage: { contextPct: 34, contextTokens: 68400, window: 200000, costUsd: 1.2, limits: [] } }
const store: Record<string, unknown> = {}
const s = new Proxy({}, { get: (_, key: string) => ({ get: async () => state[key], set: async (f: (v: unknown) => unknown) => void (state[key] = f(state[key])) }) }) as Cells

const io: Io = {
  run: async (argv, init = {}) => {
    const r = spawnSync(argv[0]!, argv.slice(1), { cwd: init.cwd, env: { ...process.env, ...init.env }, encoding: 'utf8', timeout: init.timeoutMs ?? 20_000 })
    return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), code: r.status ?? -1 }
  },
  exists: async p => fs.existsSync(p),
  read: async p => fs.readFileSync(p, 'utf8'),
  write: async (p, t) => fs.writeFileSync(p, t),
  list: async p => fs.readdirSync(p, { withFileTypes: true }).map(d => ({ name: d.name, kind: d.isDirectory() ? 'dir' : d.isFile() ? 'file' : 'other', size: 0, mtimeMs: 0, isLink: d.isSymbolicLink() })),
  now: async () => Date.now(),
  every: () => undefined,
  pause: ms => new Promise(r => setTimeout(r, ms)),
  home: async () => process.env.HOME ?? '',
  session: async () => ({ id: 'probe', root: imsRoot, cwd: imsRoot }),
  messages: async () => [],
  usage: async () => null,
  agents: async () => [],
  commands: async () => [],
  fork: async () => null,
  complete: async () => null,
  mcp: async () => (jiraFixture ? JSON.parse(fs.readFileSync(jiraFixture, 'utf8')) : null),
  suggest: () => undefined,
  fill: async () => true,
  toast: t => console.log('toast:', t),
  debug: () => undefined,
  copy: async () => true,
  togglePane: async () => undefined,
  storeGet: async k => store[k],
  storeSet: async (k, v) => void (store[k] = v),
  s,
}

const t0 = Date.now()
me.root = imsRoot
ws.imsRoot = imsRoot
for (const line of fs.readFileSync(transcript, 'utf8').split('\n')) notice(line)
await refreshFocus(io)
await refreshEnv(io)
await refreshTicket(io)
await refreshFocusPrs(io)
const focus = state.focus as Parameters<typeof drawBar>[0]['focus']
console.log('took', Date.now() - t0, 'ms')
console.log('focus', JSON.stringify({ worktree: focus?.worktree, ticket: focus?.ticket, branches: focus?.branches.map(b => ({ side: b.side, branch: b.branch, remote: b.remote, commits: b.commits, unpushed: b.unpushed, behind: b.behindBase, dirty: b.dirty })) }, null, 1))
console.log('env', JSON.stringify(state.env))
const g = state.github as { focus: { repo: string; number: number; state: string; review: string | null; newComments: number }[]; deploys: unknown[]; error: string | null }
console.log('prs', JSON.stringify(g.focus.map(p => ({ repo: p.repo, n: p.number, state: p.state, review: p.review }))), 'deploys', g.deploys.length, 'error', g.error)
const ticket = state.ticket as { key: string; status: string; requirements: { text: string }[]; error: string | null } | null
console.log('ticket', ticket?.key, ticket?.status, 'requirements', ticket?.requirements.length, ticket?.error ?? '')

const d = { focus, env: state.env as never, ticket: state.ticket as never, github: state.github as never, usage: state.usage as never, status: 'idle' as const, title: '', progress: ticket?.requirements.length ? { done: 1, total: ticket.requirements.length } : null }
const blocks: [string, string][] = [
  ['Bar (real data)', drawBar(d, 780)],
  ['Overview (real data)', drawOverview({ ...d, startedAt: Date.now() - 47 * 60_000, now: Date.now(), goal: null }, 560)],
  ...(state.ticket ? [['Jira (real data)', drawJira(state.ticket as never, 560, Date.now())] as [string, string]] : []),
  ...(state.github as { focus: never[] }).focus.map(p => ['GitHub (real data)', drawPr(p, 560, Date.now())] as [string, string]),
]
fs.writeFileSync(new URL('./preview.html', import.meta.url), `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;font:13px -apple-system,sans-serif;background:#faf9f5;color:#1f1e1d}@media (prefers-color-scheme:dark){body{background:#1f1e1d;color:#ecebe6}}h3{font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.55;margin:22px 0 6px}.f{display:inline-block;border:1px dashed rgba(128,128,128,.35);border-radius:10px;padding:8px}</style>${blocks.map(([t, svg]) => `<h3>${t}</h3><div class="f">${svg}</div>`).join('')}`)
console.log('wrote dev/preview.html')
