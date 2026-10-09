import type { Held } from '../../types'
import { basename, clean, plural, trunc } from '../lib/fmt'
import { git } from '../lib/io'
import type { Io } from '../lib/io'

// The guard. A risky shell command is held: a card shows what it would change
// (the files it deletes and their size, the work it discards, the commits it
// drops) with Run it / Cancel, and the command waits for your press (pattern
// of Anthropic's blast-radius mod). A few commands are never right and are
// refused outright. Inside ims-nawy its CLAUDE.md rules are enforced too.
// ponytail: reads the command text, so `bash -c`, `$(…)` or a script that runs
// rm gets past it. A seatbelt for honest mistakes, not a sandbox.

type Rule = { id: string; label: string; test: (segment: string) => boolean }

const RULES: Rule[] = [
  { id: 'force-push', label: 'Force-push', test: s => /^git\b.*\bpush\b/.test(s) && /(\s--force(-with-lease)?\b|\s-[a-zA-Z]*f\b|\s\+\S+)/.test(s) },
  { id: 'reset-hard', label: 'Hard reset', test: s => /^git\b.*\breset\b.*\s--hard\b/.test(s) },
  { id: 'discard', label: 'Discard changes', test: s => /^git\b.*\b(checkout|restore)\b.*\s(--\s+)?\.(\s|$)/.test(s) },
  { id: 'clean', label: 'git clean', test: s => /^git\b.*\bclean\b.*\s-[a-zA-Z]*f/.test(s) },
  { id: 'branch-delete', label: 'Delete branch', test: s => /^git\b.*\bbranch\b.*\s-D\b/.test(s) || /^git\b.*\bpush\b.*(\s--delete\b|\s:[^\s:]+)/.test(s) },
  { id: 'pr-merge', label: 'Merge a PR', test: s => /^gh\b.*\bpr\s+merge\b/.test(s) || /^gh\s+api\b.*\/merges?\b/.test(s) },
  { id: 'rm-rf', label: 'Recursive delete', test: s => /^rm\s/.test(s) && /(\s-[a-zA-Z]*(r[a-zA-Z]*f|f[a-zA-Z]*r)|\s--recursive\b)/.test(s) },
  { id: 'sql', label: 'Destructive SQL', test: s => /^(mysql|mariadb|mysqlsh|psql|sqlite3|mongosh)\b/.test(s) && /\b(drop\s+(table|database|schema)|truncate\s+(table\s+)?\w)/i.test(s) },
]

const NEVER: { label: string; test: (segment: string) => boolean }[] = [
  { label: 'rm -rf of the root or home folder', test: s => /^rm\s.*\s(\/|~|\$HOME|\/\*|~\/\*?)(\s|$)/.test(s) && /\s-[a-zA-Z]*[rR]/.test(s) },
  {
    label: 'force-pushing main/master',
    test: s => /^git\b.*\bpush\b/.test(s) && /(--force|\s-[a-zA-Z]*f\b|\s\+)/.test(s) && s.split(/\s+/).some(t => /^\+?(?:[^:]+:)?(?:refs\/heads\/)?(main|master)$/.test(t)),
  },
]

/** Split a command line into the simple commands it runs, env/sudo stripped. */
export function segments(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||;|\||\n)\s*/)
    .map(s => s.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)*/, '').replace(/^sudo\s+(-\S+\s+)*/, ''))
    .filter(Boolean)
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

// ---- ims-nawy's rules (its CLAUDE.md), enforced on every command there

const flag = (segment: string, name: string): string | null => new RegExp(`--${name}(?:=|\\s+)("[^"]*"|'[^']*'|\\S+)`).exec(segment)?.[1]?.replace(/^["']|["']$/g, '') ?? null

export const IMS = { reviewer: 'mazenfayez', ghUser: 'ezzhassan-nawy', base: 'staging' }

/** An ims-nawy rule this command breaks, or a schema change to confirm. Pure. */
export function imsVerdict(command: string, cwd: string, root: string): { deny: string } | { schema: string } | null {
  const deny = (why: string): { deny: string } => ({ deny: `IMS rule: ${why}` })
  const hasToken = /GH_TOKEN=/.test(command)
  const isPersonal = /ims-prototype|product-workspace/.test(`${command} ${cwd}`)
  for (const s of segments(command)) {
    if (isPersonal && /^(git|gh)\b/.test(s)) continue
    if (/^gh\s+pr\s+create\b/.test(s)) {
      const base = flag(s, 'base') ?? flag(s, 'B')
      if (base !== IMS.base) return deny(`PRs go into \`${IMS.base}\` only (never main, prod or testing): add \`--base ${IMS.base}\`.`)
      const reviewers = [...s.matchAll(/--reviewer(?:=|\s+)("[^"]*"|'[^']*'|\S+)/g)].flatMap(m => (m[1] ?? '').replace(/^["']|["']$/g, '').split(','))
      if (!reviewers.includes(IMS.reviewer)) return deny(`${IMS.reviewer} is the only reviewer: add \`--reviewer ${IMS.reviewer}\`.`)
      const others = reviewers.filter(r => r && r !== IMS.reviewer)
      if (others.length) return deny(`${IMS.reviewer} is the only reviewer; drop ${others.join(', ')}.`)
      if (/--body(?!-file)/.test(s)) {
        const missing = ['Linked PR', '## Changes', '## Notes for the reviewer'].filter(part => !command.includes(part))
        if (missing.length) return deny(`the PR description needs: ${missing.join(', ')}.`)
      }
    }
    if (/^git\b.*\b(merge|rebase)\b.*\b(origin\/)?staging\b/.test(s) || /^git\b.*\bpull\b.*\bstaging\b/.test(s)) {
      return deny('never merge or rebase `staging` into a feature branch (it is not a superset of main). Conflicts with staging go under "Notes for the reviewer".')
    }
    if (/^git\b.*\bpush\b/.test(s) && /\s(origin\s+)?(HEAD:)?(main|prod|staging|testing|dev|uat-testing)(\s|$)/.test(s)) {
      return deny('never push to a shared branch: push the feature branch and open a PR into staging.')
    }
    if (/^gh\s+pr\s+merge\b/.test(s) || /^gh\s+api\b.*\/merges?\b/.test(s)) return deny("never merge without Ezz's explicit permission. Ask him.")
    const checkout = /^git\b(?:\s+-C\s+(\S+))?.*\b(checkout|switch)\b/.exec(s)
    if (checkout) {
      const target = checkout[1] ?? /(?:^|\s)cd\s+(\S+)/.exec(command)?.[1] ?? cwd
      if (/(^|\/)(frontend|backend)\/?$/.test(target.replace(root, '')) && !target.includes('.worktrees')) {
        return deny('never switch the branch of the shared `frontend/` or `backend/` checkouts; work in a worktree copy (`/ims-start`).')
      }
    }
    if ((/^gh\s+(pr|api|repo|run|search|issue|release)\b/.test(s) || /^git\b.*\b(push|fetch|pull)\b/.test(s)) && !hasToken) {
      return deny(`run it with the nawy account's token: \`export GH_TOKEN=$(gh auth token --user ${IMS.ghUser}) && ${trunc(s, 60)}\`.`)
    }
    if (/\bmigration:(run|revert|generate|create)\b/.test(s) || /\btypeorm\b.*\bmigration/.test(s) || (/^(mysql|mysqlsh)\b/.test(s) && /\b(alter|create|drop|rename)\s+(table|index|database|schema)\b/i.test(command))) {
      return { schema: s }
    }
  }
  return null
}

// ---- what a held command would change

const kb = (bytes: number): string => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

async function measure(io: Io, id: string, segment: string, dir: string): Promise<Pick<Held, 'summary' | 'lines' | 'note'>> {
  if (id === 'rm-rf') {
    const targets = segment.split(/\s+/).slice(1).filter(a => !a.startsWith('-'))
    const found = await io.run(['find', ...targets, '-type', 'f', '-exec', 'stat', '-f', '%z %N', '{}', '+'], { cwd: dir })
    const files = found.out.split('\n').filter(Boolean).map(l => ({ size: Number(l.split(' ')[0]) || 0, name: l.slice(l.indexOf(' ') + 1) })).sort((a, b) => b.size - a.size)
    const total = files.reduce((n, f) => n + f.size, 0)
    const tracked = (await git(io, dir, 'ls-files', '--', ...targets)).out.split('\n').filter(Boolean).length
    return {
      summary: files.length ? `deletes ${plural(files.length, 'file')} · ${kb(total)}` : `deletes ${targets.join(', ')} (nothing found there)`,
      note: files.length ? (tracked ? `${tracked} of them are tracked by git and can be restored; the rest cannot.` : 'None of these are tracked by git, so they cannot be restored.') : null,
      lines: files.map(f => ({ name: f.name, detail: kb(f.size) })),
    }
  }
  if (id === 'reset-hard' || id === 'discard') {
    const s = await git(io, dir, 'status', '--porcelain')
    const files = s.out.split('\n').filter(l => l && !l.startsWith('??'))
    return { summary: files.length ? `discards uncommitted changes in ${plural(files.length, 'file')}` : 'there are no uncommitted changes to lose', note: files.length ? 'Uncommitted work is gone for good once discarded.' : null, lines: files.map(l => ({ name: l.slice(3), detail: l.slice(0, 2).trim() || 'changed' })) }
  }
  if (id === 'clean') {
    const flags = segment.slice(segment.indexOf(' clean') + 6).match(/\s-[a-zA-Z]+/g)?.join(' ').replace(/f/g, '') ?? ''
    const s = await io.run(['git', '-C', dir, 'clean', '-n', ...flags.split(/\s+/).filter(f => f && f !== '-')])
    const files = s.out.split('\n').filter(Boolean).map(l => l.replace(/^Would remove /, ''))
    return { summary: files.length ? `deletes ${plural(files.length, 'untracked file')}` : 'nothing untracked would be deleted', note: files.length ? 'Untracked files cannot be restored.' : null, lines: files.map(name => ({ name, detail: 'untracked' })) }
  }
  if (id === 'force-push') {
    const s = await git(io, dir, 'log', '--format=%h%x09%s', 'HEAD..@{upstream}')
    const commits = s.out.split('\n').filter(Boolean)
    return { summary: commits.length ? `drops ${plural(commits.length, 'commit')} that are on the remote but not in your branch` : 'your branch already has everything on the remote', note: null, lines: commits.map(c => ({ name: c.split('\t')[1] ?? c, detail: c.split('\t')[0] ?? '' })) }
  }
  if (id === 'branch-delete') {
    const name = /\s-D\s+(\S+)/.exec(segment)?.[1]
    if (!name) return { summary: 'deletes a branch on the remote', note: null, lines: [] }
    const s = await git(io, dir, 'log', '--format=%h%x09%s', name, '--not', '--remotes')
    const commits = s.out.split('\n').filter(Boolean)
    return { summary: commits.length ? `${name} has ${plural(commits.length, 'commit')} that exist nowhere else` : `${name} is fully pushed; nothing is lost`, note: null, lines: commits.map(c => ({ name: c.split('\t')[1] ?? c, detail: c.split('\t')[0] ?? '' })) }
  }
  if (id === 'pr-merge') return { summary: 'merges a pull request into a shared branch', note: null, lines: [] }
  return { summary: `runs: ${trunc(segment, 120)}`, note: null, lines: [] }
}

/** Where a segment runs: the session's folder, moved by `cd x &&` or `git -C x`. */
function dirFor(command: string, segment: string, cwd: string): string {
  let dir = cwd
  for (const s of segments(command)) {
    if (s === segment) break
    const cd = /^cd\s+("[^"]+"|'[^']+'|\S+)/.exec(s)?.[1]?.replace(/^["']|["']$/g, '')
    if (cd) dir = cd.startsWith('/') || cd.startsWith('~') ? cd : `${dir}/${cd}`
  }
  const gitC = /^git\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(segment)?.[1]?.replace(/^["']|["']$/g, '')
  return gitC ? (gitC.startsWith('/') ? gitC : `${dir}/${gitC}`) : dir
}

/** Hold the command on a card until the person answers (10 min at most). */
// The answer travels in a plain variable: every state read inside one hook sees
// the moment the hook started, so a held hook never sees the button's state write.
let pressed: Held['decision'] = null

async function hold(io: Io, held: Held, isAborted: () => boolean): Promise<'run' | 'cancel'> {
  pressed = null
  await io.s.held.set(() => held)
  const started = await io.now()
  while (!pressed) {
    if (isAborted() || (await io.now()) - started > 10 * 60_000) break
    await io.pause(250)
  }
  const decision = pressed ?? 'cancel'
  pressed = null
  await io.s.held.set(() => null)
  return decision
}

export async function guardCommand(io: Io, command: string, opts: { cwd: string; imsRoot: string; dbMode: 'staging' | 'local' | null; isOn: boolean; isAborted: () => boolean }): Promise<{ deny: string } | null> {
  if (opts.imsRoot) {
    const ims = imsVerdict(command, opts.cwd, opts.imsRoot)
    if (ims && 'deny' in ims) return ims
    if (ims && 'schema' in ims) {
      const staging = opts.dbMode !== 'local'
      const answer = await hold(io, { command: ims.schema, title: 'MySQL schema change', summary: staging ? 'changes the SHARED STAGING database (through the tunnel)' : 'changes your LOCAL database', note: 'The exact DDL goes in the PR description.', lines: [], decision: null }, opts.isAborted)
      if (answer !== 'run') return { deny: "IMS rule: a MySQL schema change needs Ezz's explicit confirmation every time, and he did not confirm this one. Show him the exact DDL and ask." }
    }
  }
  if (!opts.isOn) return null
  const verdict = classify(command)
  if (!verdict) return null
  if ('never' in verdict) return { deny: `The guard refused this: ${verdict.never} is never run from here. Do not retry; tell the user what you were trying to do.` }
  const { rule, segment } = verdict
  const shown = await measure(io, rule.id, segment, dirFor(command, segment, opts.cwd)).catch(() => ({ summary: rule.label.toLowerCase(), note: null, lines: [] }))
  const answer = await hold(io, { command: trunc(segment, 120), title: rule.label, ...shown, lines: shown.lines.map(l => ({ name: basename(l.name) === l.name ? l.name : l.name.replace(/^\.\//, ''), detail: l.detail })), decision: null }, opts.isAborted)
  if (answer === 'run') return null
  return { deny: `The user declined this ${rule.label.toLowerCase()} (${clean(shown.summary, 160)}). Do not retry it unless they ask you to.` }
}

export async function decide(io: Io, decision: 'run' | 'cancel'): Promise<void> {
  pressed = decision
  await io.s.held.set(h => (h ? { ...h, decision } : h))
}
