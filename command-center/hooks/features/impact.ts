import type { ToolCallInput, ToolCallResult } from 'claude-code'

import type { ImpactRow } from '../../types'
import { config } from '../lib/config'
import { basename, dirname, plural } from '../lib/fmt'
import { git } from '../lib/io'
import type { Io } from '../lib/io'
import { me } from './live'

// Impact (blast radius): after an edit lands in a code file, find the files
// that import it, and the modules they sit in. An edit to a file many modules
// share gets a one-time heads-up. For a branch, the same over every file it
// changes against its base — the paragraph a PR's reviewer notes want.
// ponytail: import-text search (git grep), not a real module graph; aliases
// like `@/utils` match by file stem only. Good enough to flag shared code.

const CODE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py)$/
const ERE_SPECIAL = /[.^$*+?()[\]{}|\\]/g

async function dependents(io: Io, path: string): Promise<{ root: string; files: string[] } | null> {
  const top = await git(io, dirname(path), 'rev-parse', '--show-toplevel')
  if (!top.ok) return null
  const root = top.out
  const file = basename(path).replace(/\.[^.]+$/, '')
  const stem = (file === 'index' || file === '__init__' ? basename(dirname(path)) : file).replace(ERE_SPECIAL, '\\$&')
  const js = `(from|import|require)[^'"]*['"]([^'"]*/)?${stem}(\\.[a-zA-Z]+)?['"]`
  const py = `^[[:space:]]*(from|import)[[:space:]]+([[:alnum:]_.]*\\.)?${stem}([[:space:]]|\\.|$)`
  const found = await git(io, root, 'grep', '-l', '-E', '-e', js, '-e', py, '--', '.', ':!*.lock', ':!*.min.js')
  const files = found.out
    .split('\n')
    .filter(Boolean)
    .map(rel => `${root}/${rel}`)
    .filter(p => p !== path)
  return { root, files }
}

function modulesOf(root: string, files: string[]): string[] {
  const set = new Set<string>()
  for (const file of files) {
    const parts = file.slice(root.length + 1).split('/')
    set.add(parts.slice(0, Math.min(3, parts.length - 1)).join('/') || '.')
  }
  return [...set].sort()
}

async function measure(io: Io, path: string, source: ImpactRow['source']): Promise<ImpactRow | null> {
  const found = await dependents(io, path)
  if (!found) return null
  return { path, dependents: found.files, modules: modulesOf(found.root, found.files), source }
}

const warned = new Set<string>()

export function impactAfterTool(io: Io, e: ToolCallInput, ran: ToolCallResult): void {
  const tool = String(e.tool)
  const path = (e as unknown as { file_path?: unknown }).file_path
  if (!config.isImpact || !['Edit', 'Write', 'MultiEdit'].includes(tool) || typeof path !== 'string' || !CODE.test(path)) return
  if (ran.deny !== undefined || ran.isError === true) return
  void (async () => {
    const row = await measure(io, path, 'edit')
    if (!row) return
    await io.s.impact.set(list => [row, ...list.filter(r => r.path !== path || r.source !== 'edit')].slice(0, 100))
    if (!warned.has(path) && (row.dependents.length >= config.impactWarn || row.modules.length >= 3)) {
      warned.add(path)
      io.toast(`▲ Shared file: ${basename(path)} is used by ${plural(row.dependents.length, 'file')} in ${plural(row.modules.length, 'module')}`, 7000)
    }
  })()
}

/** Measure every code file the session's branch changes against its base. */
export async function measureBranch(io: Io): Promise<void> {
  const repo = await io.s.repo.get()
  if (!repo?.base || !repo.branch) {
    io.toast('No branch with a base to compare here')
    return
  }
  io.toast(`Measuring ${repo.branch} against ${repo.base}…`)
  const diff = await git(io, repo.root, 'diff', '--name-only', `${repo.base}...HEAD`)
  const changed = diff.out.split('\n').filter(f => CODE.test(f)).slice(0, 40).map(f => `${repo.root}/${f}`)
  const rows: ImpactRow[] = []
  for (const path of changed) {
    const row = await measure(io, path, 'branch')
    if (row) rows.push(row)
  }
  rows.sort((a, b) => b.dependents.length - a.dependents.length)
  await io.s.impact.set(list => [...list.filter(r => r.source === 'edit'), ...rows])
}

/** Markdown for a PR's reviewer notes. */
export async function impactSummary(io: Io): Promise<string> {
  const rows = (await io.s.impact.get()).filter(r => r.dependents.length > 0)
  if (!rows.length) return 'No shared files changed: every edited file is used only where it lives.'
  const root = (await io.s.repo.get())?.root ?? me.root
  const lines = rows
    .slice(0, 12)
    .map(r => `- \`${r.path.startsWith(`${root}/`) ? r.path.slice(root.length + 1) : basename(r.path)}\` — used by ${plural(r.dependents.length, 'file')} in ${plural(r.modules.length, 'module')}${r.modules.length ? ` (${r.modules.slice(0, 4).join(', ')})` : ''}`)
  return ['**Blast radius**', ...lines].join('\n')
}
