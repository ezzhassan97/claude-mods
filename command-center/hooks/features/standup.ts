
import { basename, clean, ticketKey } from '../lib/fmt'
import { git } from '../lib/io'
import type { Io } from '../lib/io'

// /cc standup [days]: what you did since yesterday (or N days) across every git
// repo in your workspace — commits grouped by repo and ticket — plus your PRs
// (merged, waiting, needing changes) and the sessions still in flight.

export async function report(io: Io, days: number, workspace: string): Promise<string> {
  const home = await io.home()
  const root = (workspace || '~/Main').replace(/^~/, home)
  const now = await io.now()
  const since = new Date(now - days * 86400_000)
  since.setHours(0, 0, 0, 0)
  const sinceIso = since.toISOString()

  const found = await io.run(['find', root, '-maxdepth', '6', '-name', '.git', '-not', '-path', '*/node_modules/*', '-not', '-path', '*/.worktrees/*', '-not', '-path', '*/.old-git/*'], { timeoutMs: 20_000 })
  const repos = found.out.split('\n').filter(Boolean).map(p => p.replace(/\/\.git$/, ''))

  const done: string[] = []
  for (const repo of repos) {
    const email = (await git(io, repo, 'config', 'user.email')).out
    if (!email) continue
    const log = await git(io, repo, 'log', '--all', '--no-merges', `--since=${sinceIso}`, `--author=${email}`, '--format=%s')
    const subjects = log.out.split('\n').filter(Boolean)
    if (!subjects.length) continue
    const byTicket = new Map<string, string[]>()
    for (const subject of subjects) {
      const key = ticketKey(subject) ?? ''
      byTicket.set(key, [...(byTicket.get(key) ?? []), clean(subject.replace(/^[A-Z][A-Z0-9]+-\d+:?\s*/, ''), 90)])
    }
    const name = repo.startsWith(`${home}/`) ? repo.slice(home.length + 1).split('/').slice(-2).join('/') : basename(repo)
    for (const [key, items] of byTicket) {
      const unique = [...new Set(items)]
      done.push(`- **${name}**${key ? ` · ${key}` : ''} — ${unique.slice(0, 3).join('; ')}${unique.length > 3 ? ` (+${unique.length - 3} more)` : ''}`)
    }
  }

  const prs = (await io.s.prs.get()).items
  const merged = prs.filter(p => p.state === 'MERGED' && p.mergedAt && p.mergedAt >= sinceIso)
  const open = prs.filter(p => p.state === 'OPEN')
  const prLine = (p: (typeof prs)[number], tail: string): string => `- ${p.repo.split('/')[1]} #${p.number} ${p.title}${tail}`

  const sessions = (await io.s.sessions.get()).filter(s => s.status !== 'ended')
  const label = days === 1 ? 'since yesterday' : `in the last ${days} days`
  const out = [`### Standup — ${label}`, '', '**Done**', ...(done.length ? done : ['- No commits found.'])]
  if (merged.length) out.push('', '**Merged**', ...merged.map(p => prLine(p, ` → ${p.base}${p.mergedBy ? ` by ${p.mergedBy}` : ''}`)))
  if (open.length) {
    out.push('', '**In review**', ...open.map(p => prLine(p, p.review === 'CHANGES_REQUESTED' ? ' — changes requested' : p.isDraft ? ' — draft' : p.review === 'APPROVED' ? ' — approved' : ' — waiting for review')))
  }
  if (sessions.length) out.push('', '**In flight**', ...sessions.map(s => `- ${s.project}${s.branch ? ` (${s.branch})` : ''}: ${s.task ?? s.title}`))
  return out.join('\n')
}
