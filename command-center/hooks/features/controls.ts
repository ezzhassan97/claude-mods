import type { Toggles } from '../../types'
import { json } from '../lib/io'
import type { Io } from '../lib/io'

// The Controls section's switches: what each does, in plain words, and how
// it is turned on and off. Five of them are this mod's own and take effect at
// once; "while working" is Anthropic's built-in "You should know" plugin,
// switched with Claude Code's own `claude plugin enable/disable`.

export const BUILTIN_KNOW = 'cc-plugin-you-should-know@builtin'

export const CONTROLS: { key: keyof Toggles; name: string; what: string }[] = [
  { key: 'know', name: 'You should know · after each task', what: 'When a task finishes, 1–3 plain notes on risks, side effects, assumptions or decisions left to you. One quick, cheap model call (Haiku) per task, a few seconds.' },
  { key: 'builtinKnow', name: 'You should know · while working (Anthropic)', what: "Anthropic's built-in mod: a second agent watches longer tasks and flags what you might miss as it happens. Uses extra tokens; applies from your next session." },
  { key: 'next', name: "What's next", what: 'After an answer, up to 3 likely next prompts; → puts one in the prompt box, ⧉ copies it; hover one to read it whole. Nothing is sent for you.' },
  { key: 'replay', name: 'Replay', what: 'After a task that edited files, a card to step through every edit as a diff, in order.' },
  { key: 'reflect', name: 'Reflect', what: 'When you correct Claude ("no, we always…"), offer to save it as a rule in CLAUDE.md, for this project or all.' },
]

/** Claude Code's own binary: the desktop app's newest bundled one, else `claude` on PATH. */
async function claudeBin(io: Io): Promise<string> {
  const dir = `${await io.home()}/Library/Application Support/Claude/claude-code`
  const versions = (await io.list(dir).catch(() => []))
    .filter(e => e.kind === 'dir' && /^\d+\.\d+\.\d+$/.test(e.name))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const latest = versions[versions.length - 1]
  if (latest) {
    for (const hash of await io.list(`${dir}/${latest}`).catch(() => [])) {
      const bin = `${dir}/${latest}/${hash.name}/claude.app/Contents/MacOS/claude`
      if (await io.exists(bin)) return bin
    }
  }
  return 'claude'
}

export async function readBuiltinKnow(io: Io): Promise<boolean> {
  const settings = json<{ enabledPlugins?: Record<string, boolean> }>(await io.read(`${await io.home()}/.claude/settings.json`).catch(() => '{}'))
  return settings?.enabledPlugins?.[BUILTIN_KNOW] === true
}

export async function flip(io: Io, key: keyof Toggles): Promise<void> {
  const t = await io.s.toggles.get()
  const isOn = !t[key]
  if (key === 'builtinKnow') {
    const r = await io.run([await claudeBin(io), 'plugin', isOn ? 'enable' : 'disable', BUILTIN_KNOW], { timeoutMs: 30_000 })
    if (!r.ok) return io.toast(`Could not switch Anthropic's You should know: ${r.err.slice(0, 120)}`)
    io.toast(`Anthropic's You should know is ${isOn ? 'on' : 'off'} from your next session`)
  }
  const next = { ...t, [key]: isOn }
  await io.s.toggles.set(() => next)
  await io.storeSet('toggles', next)
}
