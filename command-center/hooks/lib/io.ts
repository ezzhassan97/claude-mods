import type { AgentInfo, CommandInfo, FsEntry, ModelForkResult, PluginState, RenderSurface, SessionUsage } from 'claude-code'

// The one door to the engine. register.tsx builds it from `$` (the engine
// follows `$` only within the file that receives it); every feature and view
// takes `io` and stays plain, testable code.

export type Cell<T> = { get: () => Promise<T>; set: (change: (value: T) => T) => Promise<void> }
export type Cells = { [K in keyof PluginState['command-center']]: Cell<PluginState['command-center'][K]> }

export type Ran = { ok: boolean; out: string; err: string; code: number }
export type RunInit = { cwd?: string; env?: Record<string, string>; timeoutMs?: number; stdin?: string }

export type Io = {
  run: (argv: readonly string[], init?: RunInit) => Promise<Ran>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  list: (path: string) => Promise<FsEntry[]>
  now: () => Promise<number>
  every: (ms: number, fn: () => void) => void
  home: () => Promise<string>
  /** The plugin's session state, one cell per key of the contract (types/). */
  s: Cells
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  toast: (text: string, ms?: number) => void
  debug: (text: string) => void
  ask: (question: string, options: string[], header: string) => Promise<string>
  copy: (text: string, surface: RenderSurface) => Promise<boolean>
  chime: () => void
  usage: () => Promise<SessionUsage | null>
  agents: () => Promise<AgentInfo[] | null>
  commands: () => Promise<CommandInfo[] | null>
  fork: (prompt: string) => Promise<ModelForkResult | null>
  suggest: (text: string) => void
  fill: (text: string) => Promise<boolean>
  openPane: (id: string, title: string, columns?: number) => Promise<void>
  session: () => Promise<{ id: string; root: string; cwd: string }>
}

export function json<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

export const git = (io: Io, cwd: string, ...args: string[]): Promise<Ran> => io.run(['git', '-C', cwd, ...args])

/** True when something listens on 127.0.0.1:<port>. */
export const isOpen = async (io: Io, port: number): Promise<boolean> =>
  (await io.run(['nc', '-z', '-G', '1', '127.0.0.1', String(port)], { timeoutMs: 3000 })).ok

// ---- GitHub: every account `gh` is logged into, each used per command with
// its own GH_TOKEN (never by switching the global account).

export type GhAccount = { user: string; token: string }
let accounts: { at: number; list: GhAccount[] } | null = null

export async function ghAccounts(io: Io): Promise<GhAccount[]> {
  const now = await io.now()
  if (accounts && now - accounts.at < 10 * 60_000) return accounts.list
  const status = await io.run(['gh', 'auth', 'status', '--hostname', 'github.com'])
  const users = [...`${status.out}\n${status.err}`.matchAll(/account (\S+)/g)].map(m => m[1] ?? '')
  const list: GhAccount[] = []
  for (const user of [...new Set(users)].filter(Boolean)) {
    const token = await io.run(['gh', 'auth', 'token', '--hostname', 'github.com', '--user', user])
    if (token.ok && token.out) list.push({ user, token: token.out })
  }
  accounts = { at: now, list }
  return list
}

export const gh = (io: Io, account: GhAccount, args: string[], cwd?: string): Promise<Ran> =>
  io.run(['gh', ...args], { env: { GH_TOKEN: account.token }, cwd, timeoutMs: 30_000 })
