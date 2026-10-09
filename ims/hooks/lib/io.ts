import type { PluginState, RenderSurface } from 'claude-code'

// The IMS pack's one door to the engine, built from `$` in register.tsx.

export type Cell<T> = { get: () => Promise<T>; set: (change: (value: T) => T) => Promise<void> }
export type Cells = { [K in keyof PluginState['ims']]: Cell<PluginState['ims'][K]> }

export type Ran = { ok: boolean; out: string; err: string; code: number }

export type Io = {
  run: (argv: readonly string[], init?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number }) => Promise<Ran>
  exists: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  dirs: (path: string) => Promise<string[]>
  now: () => Promise<number>
  toast: (text: string, ms?: number) => void
  ask: (question: string, options: string[], header: string) => Promise<string>
  copy: (text: string, surface: RenderSurface) => Promise<boolean>
  /** Calls a Jira tool on the Atlassian connector the session already has. */
  jira: (tool: string, args: Record<string, unknown>) => Promise<unknown>
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

export const git = (io: Io, cwd: string, ...args: string[]): Promise<Ran> => io.run(['git', '-C', cwd, ...args])

export const isOpen = async (io: Io, port: number): Promise<boolean> =>
  (await io.run(['nc', '-z', '-G', '1', '127.0.0.1', String(port)], { timeoutMs: 3000 })).ok

/** `key=value` from a dotenv file's text, never a commented line. Only ports are ever read. */
export const envValue = (text: string, key: string): string | null =>
  new RegExp(`^${key}=['"]?([^'"\\s#]*)`, 'm').exec(text)?.[1] ?? null
