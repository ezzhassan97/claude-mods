import type { Kit, KitSkill } from '../../types'
import { clean } from '../lib/fmt'
import { json } from '../lib/io'
import type { Io } from '../lib/io'
import { me } from './session'

// Skills & plugins for this session: the plugins switched on (for all your
// projects, or for this project only), this project's own skills and your
// global ones, and which skills and slash commands the session has used.
// Read-only: switching plugins stays in Claude Code's own /plugin.

const used = new Map<string, number>()

/** Count a skill or slash command the session ran. */
export function noteUse(name: string): boolean {
  const key = name.replace(/^\//, '').trim()
  if (!key || key.length > 80) return false
  used.set(key, (used.get(key) ?? 0) + 1)
  return true
}

/** The command a typed prompt runs: `/name args`, or the transcript's `<command-name>/name</command-name>`. */
export function commandOf(text: string): string | null {
  return /<command-name>\/?([\w:.-]+)<\/command-name>/.exec(text)?.[1] ?? /^\s*\/([\w:.-]+)/.exec(text)?.[1] ?? null
}

/** Count what the session ran before this load (a reload, or a resumed session). */
export async function learnUses(io: Io): Promise<void> {
  used.clear()
  for (const m of await io.messages().catch(() => [])) {
    if (m.role === 'user') {
      const c = commandOf(m.text)
      if (c) noteUse(c)
    }
    for (const t of m.toolUses ?? []) {
      const use = t as { name?: string; input?: { skill?: unknown } }
      if (use.name === 'Skill' && typeof use.input?.skill === 'string') noteUse(use.input.skill)
    }
  }
}

async function skillsIn(io: Io, dir: string, where: string): Promise<KitSkill[]> {
  const found: KitSkill[] = []
  for (const e of await io.list(dir).catch(() => [])) {
    if (e.kind === 'file') continue
    const text = await io.read(`${dir}/${e.name}/SKILL.md`).catch(() => '')
    if (!text) continue
    const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.replace(/^["']|["']$/g, '') ?? ''
    found.push({ name: e.name, description: clean(description, 140), where })
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

export async function refreshKit(io: Io): Promise<void> {
  const home = await io.home()
  const settings = async (path: string): Promise<Record<string, boolean>> => json<{ enabledPlugins?: Record<string, boolean> }>(await io.read(path).catch(() => ''))?.enabledPlugins ?? {}
  const user = await settings(`${home}/.claude/settings.json`)
  const project = { ...(await settings(`${me.root}/.claude/settings.json`)), ...(await settings(`${me.root}/.claude/settings.local.json`)) }
  const commands = (await io.commands()) ?? []
  const plugins = Object.entries({ ...user, ...project })
    .filter(([, isOn]) => isOn)
    .map(([id]) => {
      const [name = id, market = ''] = id.split('@')
      return { name, market, scope: id in project ? ('project' as const) : ('user' as const), commands: commands.filter(c => c.plugin === name || c.plugin === id).map(c => c.name).sort() }
    })
    .sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === 'project' ? -1 : 1))

  // This project's skills: the session's folder and the folders above it, up to home.
  const projectSkills: KitSkill[] = []
  for (let dir = me.root; dir.startsWith(home) && dir !== home; dir = dir.split('/').slice(0, -1).join('/')) {
    projectSkills.push(...(await skillsIn(io, `${dir}/.claude/skills`, dir === me.root ? '' : dir.slice(home.length + 1))))
  }
  const kit: Kit = {
    plugins,
    projectSkills,
    globalSkills: await skillsIn(io, `${home}/.claude/skills`, ''),
    used: [...used.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    at: await io.now(),
  }
  await io.s.kit.set(old => (old && JSON.stringify({ ...old, at: 0 }) === JSON.stringify({ ...kit, at: 0 }) ? old : kit))
}

/** After a use: update the counts alone, without reading every folder again. */
export async function refreshUses(io: Io): Promise<void> {
  const list = [...used.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
  await io.s.kit.set(k => (k ? { ...k, used: list } : k))
}
