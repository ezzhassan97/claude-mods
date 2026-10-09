/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import type { Io } from '../lib/io'

import type { GitMark, Touch } from '../../types'
import { me } from '../features/live'
import { plural, trunc } from '../lib/fmt'
import { C, G } from '../lib/ui'
import type { View } from './pane'

// Files: the project as a tree. "Touched" (the default) shows only what this
// session read, edited or created plus what git says changed, folders folded
// to their path; "All" is the full tree, folders opened on demand. Each file
// carries how it was touched, the lines it gained and lost, and its git code.

const JUNK = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache', 'coverage', '.DS_Store', '.vite-worktree-cache', '.old-git'])
const SHOWN_DOTS = new Set(['.claude', '.github', '.claude-plugin', '.worktrees'])
const MAX_ROWS = 220

type Node = { name: string; path: string; dirs: Map<string, Node>; files: { name: string; path: string }[] }

const GIT_LOOK: Record<string, { text: string; color: string }> = {
  M: { text: 'M', color: C.warn },
  A: { text: 'A', color: C.ok },
  D: { text: 'D', color: C.bad },
  R: { text: 'R', color: C.info },
  '??': { text: 'U', color: C.ok },
}

async function list(io: Io, dir: string): Promise<void> {
  if ((await io.s.listing.get())[dir]) return
  const entries = await io.list(dir).catch(() => [])
  const kept = entries
    .filter(e => !JUNK.has(e.name) && (!e.name.startsWith('.') || SHOWN_DOTS.has(e.name)))
    .map(e => ({ name: e.name, isDir: e.kind === 'dir' }))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  await io.s.listing.set(l => ({ ...l, [dir]: kept }))
}

async function toggle(io: Io, dir: string): Promise<void> {
  const isOpen = (await io.s.tree.get()).open.includes(dir)
  if (!isOpen) await list(io, dir)
  await io.s.tree.set(t => ({ ...t, open: isOpen ? t.open.filter(d => d !== dir) : [...t.open, dir] }))
}

async function showAll(io: Io, root: string): Promise<void> {
  await io.s.tree.set(t => ({ ...t, mode: 'all' as const }))
  await list(io, root)
}

export async function filesView({ io, E, k, cols }: View): Promise<RenderElement> {
  const { Box, Text, Button } = E
  const [tree, touched, marks, repo, listing] = await Promise.all([io.s.tree.get(), io.s.touched.get(), io.s.git.get(), io.s.repo.get(), io.s.listing.get()])
  const root = repo?.root ?? me.root
  const byPath = new Map<string, { touch?: Touch; mark?: GitMark }>()
  for (const t of touched) byPath.set(t.path, { ...byPath.get(t.path), touch: t })
  for (const m of marks) byPath.set(m.path, { ...byPath.get(m.path), mark: m })

  const fileRow = (name: string, path: string, depth: number): RenderElement => {
    const info = byPath.get(path)
    const t = info?.touch
    const m = info?.mark
    const glyph = t?.created ? { g: '+', c: C.ok } : t?.edits ? { g: G.edit, c: C.accent } : t?.reads ? { g: '◫', c: C.muted } : m ? { g: G.dot, c: C.muted } : { g: ' ', c: C.muted }
    const git = m ? GIT_LOOK[m.code] ?? { text: m.code, color: C.muted } : null
    const width = Math.max(10, cols - depth * 2 - 18)
    return (
      <Box key={`f-${path}`} justifyContent="space-between" paddingLeft={depth * 2}>
        <Box flexShrink={1}>
          <Text color={glyph.c}>{glyph.g}</Text>
          <Text color={t?.edits ? C.text : undefined} dimColor={!t?.edits && !m}>{` ${trunc(name, width)}`}</Text>
          {t && !t.edits && t.reads > 1 ? <Text dimColor>{` ${t.reads}×`}</Text> : null}
        </Box>
        <Box flexShrink={0}>
          {t?.added ? <Text color={C.ok}>{`+${t.added}`}</Text> : null}
          {t?.removed ? <Text color={C.bad}>{` −${t.removed}`}</Text> : null}
          {git ? <Text color={git.color} bold>{`  ${git.text}`}</Text> : null}
        </Box>
      </Box>
    )
  }

  const rows: RenderElement[] = []

  if (tree.mode === 'touched') {
    const top: Node = { name: '', path: root, dirs: new Map(), files: [] }
    for (const path of byPath.keys()) {
      const inside = path.startsWith(`${root}/`)
      const parts = (inside ? path.slice(root.length + 1) : path.replace(/^\//, '')).split('/')
      let node = top
      let at = inside ? root : ''
      for (const part of parts.slice(0, -1)) {
        at = `${at}/${part}`
        let child = node.dirs.get(part)
        if (!child) {
          child = { name: inside ? part : part, path: at, dirs: new Map(), files: [] }
          node.dirs.set(part, child)
        }
        node = child
      }
      node.files.push({ name: parts[parts.length - 1] ?? path, path })
    }
    const walk = (node: Node, depth: number): void => {
      for (const dir of [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        let shown = dir
        let label = dir.name
        while (shown.files.length === 0 && shown.dirs.size === 1) {
          shown = [...shown.dirs.values()][0]!
          label = `${label}/${shown.name}`
        }
        const count = countFiles(shown)
        rows.push(
          <Box key={`d-${shown.path}`} paddingLeft={depth * 2}>
            <Text dimColor>{`${G.open} `}</Text>
            <Text bold>{`${trunc(label, Math.max(10, cols - depth * 2 - 12))}/`}</Text>
            <Text dimColor>{`  ${count}`}</Text>
          </Box>,
        )
        walk(shown, depth + 1)
      }
      for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) rows.push(fileRow(f.name, f.path, depth))
    }
    walk(top, 0)
  } else {
    const walk = (dir: string, depth: number): void => {
      for (const entry of listing[dir] ?? []) {
        if (rows.length >= MAX_ROWS) return
        const path = `${dir}/${entry.name}`
        if (entry.isDir) {
          const isOpen = tree.open.includes(path)
          rows.push(
            <Box key={`d-${path}`} paddingLeft={depth * 2}>
              <Button key={`dir-${path}`} plain label={`${isOpen ? G.open : G.closed} ${entry.name}/`} onPress={() => void toggle(io, path)} />
            </Box>,
          )
          if (isOpen) walk(path, depth + 1)
        } else {
          rows.push(fileRow(entry.name, path, depth))
        }
      }
    }
    walk(root, 0)
  }

  const edited = touched.filter(t => t.edits).length
  const aside = [plural(touched.length, 'touched'), edited ? `${edited} edited` : '', marks.length ? `${marks.length} changed in git` : ''].filter(Boolean).join(' · ')

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        {k.title('Files', aside)}
        <Box marginTop={1} columnGap={1}>
          <Button key="files-touched" plain label="touched" variant={tree.mode === 'touched' ? 'primary' : undefined} dimColor={tree.mode !== 'touched' ? true : undefined} onPress={() => void io.s.tree.set(t => ({ ...t, mode: 'touched' as const }))} />
          <Button key="files-all" plain label="all" variant={tree.mode === 'all' ? 'primary' : undefined} dimColor={tree.mode !== 'all' ? true : undefined} onPress={() => void showAll(io, root)} />
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {rows.length ? rows : k.empty(tree.mode === 'touched' ? 'Nothing touched yet — files appear as Claude reads and edits them.' : 'Loading…')}
        {rows.length >= MAX_ROWS ? k.empty('…more; open fewer folders') : null}
      </Box>
    </Box>
  )
}

function countFiles(node: Node): number {
  let n = node.files.length
  for (const d of node.dirs.values()) n += countFiles(d)
  return n
}
