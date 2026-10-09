import type { AgentInfo, CommandInfo, FsEntry, ModelCompleteResult, ModelForkResult, PluginState, RenderSurface, SessionMessage, SessionUsage } from 'claude-code'

// The one door to the engine. register.tsx builds it from `$` (the engine
// follows `$` only within the file that receives it, and reads state atoms
// only where they are declared); every feature and view takes `io` and stays
// plain, testable code.

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
  /** Waits inside a `$` call, which costs a hook none of its own time budget. */
  pause: (ms: number) => Promise<void>
  home: () => Promise<string>
  session: () => Promise<{ id: string; root: string; cwd: string }>
  messages: () => Promise<SessionMessage[]>
  usage: () => Promise<SessionUsage | null>
  agents: () => Promise<AgentInfo[] | null>
  commands: () => Promise<CommandInfo[] | null>
  fork: (prompt: string) => Promise<ModelForkResult | null>
  complete: (system: string, prompt: string) => Promise<ModelCompleteResult | null>
  /** A tool on a connected MCP server, found by its name suffix (`__getJiraIssue`). */
  /** Calls the tool on each connected server that has it, in turn, until `accept` takes the answer (the last one otherwise). */
  mcp: (toolSuffix: string, args: Record<string, unknown>, accept?: (result: unknown) => boolean) => Promise<unknown>
  suggest: (text: string) => void
  fill: (text: string) => Promise<boolean>
  toast: (text: string, ms?: number) => void
  debug: (text: string) => void
  copy: (text: string, surface: RenderSurface) => Promise<boolean>
  togglePane: (open?: boolean) => Promise<void>
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  s: Cells
}

export function json<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

// GIT_OPTIONAL_LOCKS=0: reading never rewrites the index or takes its lock, so the
// plugin's polling can't collide with your own git commands.
export const git = (io: Io, cwd: string, ...args: string[]): Promise<Ran> => io.run(['git', '-C', cwd, ...args], { env: { GIT_OPTIONAL_LOCKS: '0' } })

/** True when something listens on 127.0.0.1:<port>. */
export const isOpen = async (io: Io, port: number): Promise<boolean> =>
  (await io.run(['nc', '-z', '-G', '1', '127.0.0.1', String(port)], { timeoutMs: 3000 })).ok

/** `owner/name` from a git remote URL. */
export const repoOf = (url: string): string | null => /[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null

/** `key=value` from a dotenv file's text. Only ports are ever read. */
export const envValue = (text: string, key: string): string | null => new RegExp(`^${key}=['"]?([^'"\\s#]*)`, 'm').exec(text)?.[1] ?? null

// ---- GitHub: every account `gh` is logged into, each used per command with
// its own GH_TOKEN (never by switching the global account).

export type GhAccount = { user: string; token: string }
let accounts: { at: number; list: GhAccount[] } | null = null
const owners = new Map<string, GhAccount>()

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

/** The account that can see `owner/name`, remembered per owner. */
export async function accountFor(io: Io, repo: string): Promise<GhAccount | null> {
  const owner = repo.split('/')[0] ?? ''
  const known = owners.get(owner)
  if (known) return known
  for (const account of await ghAccounts(io)) {
    if ((await gh(io, account, ['api', `repos/${repo}`, '--jq', '.full_name'])).ok) {
      owners.set(owner, account)
      return account
    }
  }
  return null
}
