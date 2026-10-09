
import { basename, clean, plural, trunc } from '../lib/fmt'
import { git } from '../lib/io'
import type { Io } from '../lib/io'
import { config } from '../lib/config'

// Guard: a risky shell command is held until you answer. The engine's own
// question dialog shows what it would change (files it deletes, commits it
// drops, uncommitted work it discards); "Run it" lets it through, anything
// else refuses it with a reason Claude can act on. A few commands are never
// right (rm -rf of / or ~, force-pushing a default branch) and are refused.
// ponytail: reads the command text, so `bash -c`, `$(…)` or a script that runs
// rm gets past it. It is a seatbelt for honest mistakes, not a sandbox.

type Rule = { id: string; label: string; test: (segment: string) => boolean }

const RULES: Rule[] = [
  { id: 'force-push', label: 'Force-push', test: s => /^git\b.*\bpush\b/.test(s) && /(\s--force(-with-lease)?\b|\s-[a-zA-Z]*f\b|\s\+\S+)/.test(s) },
  { id: 'reset-hard', label: 'Hard reset', test: s => /^git\b.*\breset\b.*\s--hard\b/.test(s) },
  { id: 'discard', label: 'Discard changes', test: s => /^git\b.*\b(checkout|restore)\b.*\s(--\s+)?\.(\s|$)/.test(s) },
  { id: 'clean', label: 'git clean', test: s => /^git\b.*\bclean\b.*\s-[a-zA-Z]*f/.test(s) },
  { id: 'branch-delete', label: 'Delete branch', test: s => /^git\b.*\bbranch\b.*\s-D\b/.test(s) || /^git\b.*\bpush\b.*(\s--delete\b|\s:[^\s:]+)/.test(s) },
  { id: 'pr-merge', label: 'Merge a PR', test: s => /^gh\b.*\bpr\s+merge\b/.test(s) || /^gh\s+api\b.*\/merges?\b/.test(s) },
  { id: 'rm-rf', label: 'Recursive delete', test: s => /^rm\s/.test(s) && /(\s-[a-zA-Z]*(r[a-zA-Z]*f|f[a-zA-Z]*r)|\s--recursive\b)/.test(s) },
  { id: 'sql', label: 'Destructive SQL', test: s => /\b(drop\s+(table|database|schema)|truncate\s+(table\s+)?\w)/i.test(s) },
]

const NEVER: { label: string; test: (segment: string) => boolean }[] = [
  { label: 'rm -rf of the root or home folder', test: s => /^rm\s.*\s(\/|~|\$HOME|\/\*|~\/\*?)(\s|$)/.test(s) && /\s-[a-zA-Z]*[rR]/.test(s) },
  {
    label: 'force-pushing main/master',
    test: s =>
      /^git\b.*\bpush\b/.test(s) &&
      /(--force|\s-[a-zA-Z]*f\b|\s\+)/.test(s) &&
      s.split(/\s+/).some(t => /^\+?(?:[^:]+:)?(?:refs\/heads\/)?(main|master)$/.test(t)),
  },
]

/** Split a command line into the simple commands it runs, env/sudo stripped. */
export function segments(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||;|\||\n)\s*/)
    .map(s => s.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)*/, '').replace(/^sudo\s+(-\S+\s+)*/, ''))
    .filter(Boolean)
}

/** The folder a segment runs in: the session's, moved by `cd x &&` or `git -C x`. */
function dirFor(command: string, segment: string, cwd: string): string {
  let dir = cwd
  for (const s of segments(command)) {
    if (s === segment) break
    const cd = /^cd\s+("[^"]+"|'[^']+'|\S+)/.exec(s)?.[1]?.replace(/^["']|["']$/g, '')
    if (cd) dir = cd.startsWith('/') ? cd : cd.startsWith('~') ? cd : `${dir}/${cd}`
  }
  const gitC = /^git\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(segment)?.[1]?.replace(/^["']|["']$/g, '')
  if (gitC) dir = gitC.startsWith('/') ? gitC : `${dir}/${gitC}`
  return dir
}

const list = (names: string[], max = 4): string =>
  names.length <= max ? names.join(', ') : `${names.slice(0, max).join(', ')} +${names.length - max} more`

/** What the command would change, as one short sentence. */
async function preview(io: Io, rule: string, segment: string, dir: string): Promise<string> {
  switch (rule) {
    case 'reset-hard':
    case 'discard': {
      const s = await git(io, dir, 'status', '--porcelain')
      const files = s.out.split('\n').filter(l => l && !l.startsWith('??')).map(l => basename(l.slice(3)))
      return files.length ? `It discards uncommitted changes in ${plural(files.length, 'file')}: ${list(files)}.` : 'There are no uncommitted changes to lose.'
    }
    case 'clean': {
      const flags = segment.slice(segment.indexOf(' clean') + 6).match(/\s-[a-zA-Z]+/g)?.join(' ').replace(/f/g, '') ?? ''
      const s = await io.run(['git', '-C', dir, 'clean', '-n', ...flags.split(/\s+/).filter(f => f && f !== '-')])
      const files = s.out.split('\n').filter(Boolean).map(l => basename(l.replace(/^Would remove /, '')))
      return files.length ? `It deletes ${plural(files.length, 'untracked file')}: ${list(files)}.` : 'Nothing untracked would be deleted.'
    }
    case 'force-push': {
      const s = await git(io, dir, 'log', '--oneline', 'HEAD..@{upstream}')
      const commits = s.out.split('\n').filter(Boolean)
      return commits.length ? `The remote has ${plural(commits.length, 'commit')} your branch doesn't — they would be dropped: ${list(commits.map(c => trunc(c, 40)), 3)}.` : 'Your branch already contains everything on the remote.'
    }
    case 'branch-delete': {
      const name = /\s-D\s+(\S+)/.exec(segment)?.[1]
      if (!name) return 'It deletes a branch on the remote.'
      const s = await git(io, dir, 'log', '--oneline', name, '--not', '--remotes')
      const n = s.out.split('\n').filter(Boolean).length
      return n ? `${name} has ${plural(n, 'commit')} that exist nowhere else.` : `${name} is fully pushed; nothing is lost.`
    }
    case 'rm-rf': {
      const targets = segment.split(/\s+/).slice(1).filter(a => !a.startsWith('-'))
      const sizes = await io.run(['du', '-sh', ...targets], { cwd: dir })
      return sizes.out ? `It deletes: ${list(sizes.out.split('\n').map(l => l.replace(/\s+/, ' ')), 4)}.` : `It deletes ${list(targets)}.`
    }
    case 'pr-merge':
      return 'It merges a pull request (that changes a shared branch for everyone).'
    default:
      return `It runs: ${trunc(segment, 120)}`
  }
}

/** What the guard makes of a command: never run, hold for an answer, or let through. */
export function classify(command: string): { never: string } | { rule: Rule; segment: string } | null {
  const parts = segments(command)
  for (const segment of parts) {
    const never = NEVER.find(n => n.test(segment))
    if (never) return { never: never.label }
  }
  for (const segment of parts) {
    const rule = RULES.find(r => r.test(segment))
    if (rule) return { rule, segment }
  }
  return null
}

/** Hold a risky command until the user answers; null lets it run. */
export async function guardCheck(io: Io, command: string): Promise<{ deny: string } | null> {
  if (!config.isGuarding) return null
  const verdict = classify(command)
  if (!verdict) return null
  if ('never' in verdict) {
    await log(io, verdict.never, command, 'blocked')
    return { deny: `Command Center guard refused this: ${verdict.never} is never run from here. Do not retry; tell the user what you were trying to do.` }
  }
  const { rule, segment } = verdict
  const { cwd } = await io.session()
  const why = await preview(io, rule.id, segment, dirFor(command, segment, cwd)).catch(() => '')
  const answer = await io.ask(`${rule.label}: \`${trunc(segment, 90)}\`. ${why} Run it?`, ['Cancel', 'Run it'], 'Guard').catch(() => '')
  if (answer === 'Run it') {
    await log(io, rule.label, command, 'proceeded')
    return null
  }
  await log(io, rule.label, command, 'cancelled')
  return { deny: `The user declined this ${rule.label.toLowerCase()} (${why || 'risky command'}). Do not retry it unless they ask you to${answer && answer !== 'Cancel' ? `; they said: "${clean(answer, 200)}"` : ''}.` }
}

async function log(io: Io, rule: string, command: string, outcome: 'blocked' | 'cancelled' | 'proceeded'): Promise<void> {
  const at = await io.now()
  await io.s.blocked.set(old => [{ at, rule, command: clean(command, 160), outcome }, ...old].slice(0, 20))
}
