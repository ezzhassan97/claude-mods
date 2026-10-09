import type { ToolCallInput, ToolCallResult } from 'claude-code'

import { basename, dirname, plural } from '../lib/fmt'
import { git } from '../lib/io'
import type { Io } from '../lib/io'

// Impact (blast radius of an edit): after an edit lands in a code file, count
// the files that import it; the Files section shows "used by N" beside it and
// an edit to widely shared code gets a one-time heads-up.
// ponytail: import-text search (git grep), not a module graph; path aliases
// match by file stem only. Good enough to flag shared code.

const CODE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|py)$/
const ERE = /[.^$*+?()[\]{}|\\]/g
const warned = new Set<string>()

export async function dependents(io: Io, path: string): Promise<{ files: string[]; modules: string[] } | null> {
  const top = await git(io, dirname(path), 'rev-parse', '--show-toplevel')
  if (!top.ok) return null
  const root = top.out
  const file = basename(path).replace(/\.[^.]+$/, '')
  const stem = (file === 'index' || file === '__init__' ? basename(dirname(path)) : file).replace(ERE, '\\$&')
  const js = `(from|import|require)[^'"]*['"]([^'"]*/)?${stem}(\\.[a-zA-Z]+)?['"]`
  const py = `^[[:space:]]*(from|import)[[:space:]]+([[:alnum:]_.]*\\.)?${stem}([[:space:]]|\\.|$)`
  const found = await git(io, root, 'grep', '-l', '-E', '-e', js, '-e', py, '--', '.', ':!*.lock', ':!*.min.js')
  const files = found.out.split('\n').filter(Boolean).map(rel => `${root}/${rel}`).filter(p => p !== path)
  const modules = [...new Set(files.map(f => f.slice(root.length + 1).split('/').slice(0, -1).slice(0, 3).join('/') || '.'))]
  return { files, modules }
}

export function impactAfterTool(io: Io, e: ToolCallInput, ran: ToolCallResult): void {
  const path = (e as unknown as { file_path?: unknown }).file_path
  if (!['Edit', 'Write', 'MultiEdit'].includes(String(e.tool)) || typeof path !== 'string' || !CODE.test(path)) return
  if (ran.deny !== undefined || ran.isError === true) return
  void (async () => {
    const found = await dependents(io, path)
    if (!found) return
    await io.s.touched.set(list => list.map(t => (t.path === path ? { ...t, dependents: found.files.length } : t)))
    if (!warned.has(path) && (found.files.length >= 8 || found.modules.length >= 3)) {
      warned.add(path)
      io.toast(`▲ Shared file: ${basename(path)} is used by ${plural(found.files.length, 'file')} in ${plural(found.modules.length, 'module')}`, 7000)
    }
  })()
}
