import { config } from '../lib/config'
import { trunc } from '../lib/fmt'
import type { Io } from '../lib/io'
import { ims, isStagingDb } from './env'

// The ims-nawy rules from its CLAUDE.md, enforced on every shell command
// instead of remembered. Each refusal says what to do instead, so Claude can
// correct course. A MySQL schema change asks Ezz first, and says whether it
// would land on the shared staging database or a local one.
// ponytail: reads the command text (as the command-center guard does).

type Verdict = { deny: string } | null

const split = (command: string): string[] =>
  command
    .split(/\s*(?:&&|\|\||;|\||\n)\s*/)
    .map(s => s.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+)*/, ''))
    .filter(Boolean)

const flag = (segment: string, name: string): string | null => {
  const m = new RegExp(`--${name}(?:=|\\s+)("[^"]*"|'[^']*'|\\S+)`).exec(segment)
  return m?.[1]?.replace(/^["']|["']$/g, '') ?? null
}

function prCreate(segment: string, command: string): string | null {
  const base = flag(segment, 'base') ?? flag(segment, 'B')
  if (!base || base !== config.prBase) return `PRs go into \`${config.prBase}\` only (never main, prod or testing): add \`--base ${config.prBase}\`.`
  const reviewers = [...segment.matchAll(/--reviewer(?:=|\s+)("[^"]*"|'[^']*'|\S+)/g)].flatMap(m => (m[1] ?? '').replace(/^["']|["']$/g, '').split(','))
  if (!reviewers.includes(config.reviewer)) return `${config.reviewer} is the only reviewer: add \`--reviewer ${config.reviewer}\`.`
  const others = reviewers.filter(r => r && r !== config.reviewer)
  if (others.length) return `${config.reviewer} is the only reviewer; drop ${others.join(', ')}.`
  if (/--body(?!-file)/.test(segment)) {
    const missing = ['Linked PR', '## Changes', '## Notes for the reviewer'].filter(part => !command.includes(part))
    if (missing.length) return `The PR description needs: ${missing.join(', ')} (one-line summary, Linked PR to the other repo's PR, ## Changes as numbered lists, ## Notes for the reviewer).`
  }
  return null
}

export async function imsCheck(io: Io, command: string, cwd: string): Promise<Verdict> {
  const deny = (why: string): Verdict => ({ deny: `IMS rule: ${why}` })
  const hasToken = /GH_TOKEN=/.test(command)
  // The prototype and product-workspace are Ezz's own repos (personal account, push-to-deploy):
  // the NawyRE git rules don't apply there.
  const isPersonal = /ims-prototype|product-workspace/.test(`${command} ${cwd}`)
  for (const s of split(command)) {
    if (isPersonal && /^(git|gh)\b/.test(s)) continue
    if (/^gh\s+pr\s+create\b/.test(s)) {
      const problem = prCreate(s, command)
      if (problem) return deny(problem)
    }
    if (/^git\b.*\b(merge|rebase)\b.*\b(origin\/)?staging\b/.test(s) || /^git\b.*\bpull\b.*\bstaging\b/.test(s)) {
      return deny('never merge or rebase `staging` into a feature branch (staging is not a superset of main; it would carry staging-only work to production). Conflicts with staging are listed under "Notes for the reviewer" for whoever merges.')
    }
    if (/^git\b.*\bpush\b/.test(s) && /\s(origin\s+)?(HEAD:)?(main|prod|staging|testing|dev|uat-testing)(\s|$)/.test(s)) {
      return deny('never push to a shared branch (main, prod, staging, testing, dev, uat-testing): push the feature branch and open a PR into staging.')
    }
    if (/^gh\s+pr\s+merge\b/.test(s) || /^gh\s+api\b.*\/merges?\b/.test(s)) {
      return deny('never merge — not into staging, not anywhere — without Ezz\'s explicit permission. Ask him; he merges or tells you to.')
    }
    const checkout = /^git\b(?:\s+-C\s+(\S+))?.*\b(checkout|switch)\b/.exec(s)
    if (checkout) {
      const target = checkout[1] ?? (/(?:^|\s)cd\s+(\S+)/.exec(command)?.[1]) ?? cwd
      if (/(^|\/)(frontend|backend)\/?$/.test(target.replace(ims.root, '')) && !target.includes('.worktrees')) {
        return deny('never switch the branch of the shared `frontend/` or `backend/` checkouts — another session may be using them. Work in a worktree copy (`/ims-start`).')
      }
    }
    if ((/^gh\s+(pr|api|repo|run|search|issue|release)\b/.test(s) || /^git\b.*\b(push|fetch|pull)\b/.test(s)) && !hasToken) {
      return deny(`run it with the nawy account's token in the same shell: \`export GH_TOKEN=$(gh auth token --user ${config.ghUser}) && ${trunc(s, 60)}\` (never switch the global gh account).`)
    }
    const isSchema =
      /\bmigration:(run|revert|generate|create)\b/.test(s) ||
      /\btypeorm\b.*\bmigration/.test(s) ||
      (/^(mysql|mysqlsh)\b/.test(s) && /\b(alter|create|drop|rename)\s+(table|index|database|schema)\b/i.test(command))
    if (isSchema) {
      const staging = await isStagingDb(io)
      const answer = await io
        .ask(
          `MySQL schema change ${staging ? 'on the SHARED STAGING database (via the tunnel)' : 'on your LOCAL database'}: \`${trunc(s, 80)}\`. The exact DDL must go in the PR description. Run it?`,
          ['Cancel', 'Run it'],
          'Schema',
        )
        .catch(() => '')
      if (answer !== 'Run it') return deny('a MySQL schema change needs Ezz\'s explicit confirmation every time, and he did not confirm this one. Show him the exact DDL and ask.')
    }
  }
  return null
}
