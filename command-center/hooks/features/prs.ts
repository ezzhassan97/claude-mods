
import type { CheckState, Pr, Prs } from '../../types'
import { config } from '../lib/config'
import { clean, ticketKey } from '../lib/fmt'
import { gh, ghAccounts, git, json } from '../lib/io'
import type { GhAccount, Io } from '../lib/io'
import { me } from './live'

// Pull requests across every GitHub account `gh` is logged into: the open
// ones plus those merged in the last week. Per PR: review state, comments
// (and how many are new since you last looked), commits pushed by someone
// else (the tech lead's fixes), drift from its base and from the default
// branch, mergeability, checks, and after a merge the base branch's deploy.
// Read-only: every call is a GET; conflicts are checked with `git merge-tree`,
// which writes no branch and touches no working tree.

const REFRESH_MS = 5 * 60_000
const MERGED_DAYS = 7

export const attention = (p: Pr): boolean =>
  p.state === 'OPEN'
    ? p.review === 'CHANGES_REQUESTED' || p.mergeable === 'CONFLICTING' || p.checks === 'fail' || p.newComments > 0
    : p.state === 'MERGED' && p.deploy?.conclusion === 'failure'

type SearchHit = { url: string; number: number; title: string; isDraft: boolean; updatedAt: string; repository: { nameWithOwner: string } }

type View = {
  number: number
  title: string
  state: Pr['state']
  isDraft: boolean
  baseRefName: string
  headRefName: string
  headRepositoryOwner?: { login: string }
  mergeable: string
  reviewDecision: string | null
  latestReviews: { author: { login: string }; state: string; body: string; submittedAt: string }[]
  reviewRequests: { login?: string; name?: string }[]
  comments: { author: { login: string }; body: string; createdAt: string }[]
  commits: { authors: { login: string }[] }[]
  statusCheckRollup: { status?: string; conclusion?: string; state?: string }[]
  mergedAt: string | null
  mergedBy: { login: string } | null
  additions: number
  deletions: number
  changedFiles: number
  updatedAt: string
}

const FIELDS = 'number,title,state,isDraft,baseRefName,headRefName,headRepositoryOwner,mergeable,reviewDecision,latestReviews,reviewRequests,comments,commits,statusCheckRollup,mergedAt,mergedBy,additions,deletions,changedFiles,updatedAt'

function checks(rollup: View['statusCheckRollup']): CheckState {
  if (!rollup?.length) return 'none'
  const states = rollup.map(c => (c.conclusion || c.state || c.status || '').toUpperCase())
  if (states.some(s => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(s))) return 'fail'
  if (states.some(s => ['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'EXPECTED', ''].includes(s))) return 'pending'
  return 'pass'
}

const defaults = new Map<string, string>()

async function defaultBranch(io: Io, account: GhAccount, repo: string): Promise<string> {
  const known = defaults.get(repo)
  if (known) return known
  const r = await gh(io, account, ['api', `repos/${repo}`, '--jq', '.default_branch'])
  const branch = r.ok && r.out ? r.out : 'main'
  defaults.set(repo, branch)
  return branch
}

async function detail(io: Io, account: GhAccount, hit: SearchHit, seen: Record<string, number>): Promise<Pr | null> {
  const repo = hit.repository.nameWithOwner
  const viewRun = await gh(io, account, ['pr', 'view', hit.url, '--json', FIELDS])
  const v = viewRun.ok ? json<View>(viewRun.out) : null
  if (!v) return null
  const owner = v.headRepositoryOwner?.login ?? repo.split('/')[0] ?? ''
  const [inline, main] = await Promise.all([
    gh(io, account, ['api', `repos/${repo}/pulls/${v.number}/comments`, '--jq', 'length']),
    defaultBranch(io, account, repo),
  ])
  const reviewBodies = v.latestReviews.filter(r => r.body?.trim())
  const comments = v.comments.length + Number(inline.out || 0) + reviewBodies.length
  const talk = [
    ...v.comments.map(c => ({ author: c.author.login, text: c.body, at: c.createdAt })),
    ...reviewBodies.map(r => ({ author: r.author.login, text: `${r.state.toLowerCase().replace('_', ' ')}: ${r.body}`, at: r.submittedAt })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  const last = talk[0]

  const others = new Map<string, number>()
  for (const commit of v.commits) {
    for (const author of commit.authors) {
      if (author.login && author.login !== account.user) others.set(author.login, (others.get(author.login) ?? 0) + 1)
    }
  }

  let vsBase: Pr['vsBase'] = null
  let vsMain: Pr['vsMain'] = null
  let deploy: Pr['deploy'] = null
  if (v.state === 'OPEN') {
    const head = `${owner}:${v.headRefName}`
    const [base, fromMain] = await Promise.all([
      gh(io, account, ['api', `repos/${repo}/compare/${encodeURIComponent(v.baseRefName)}...${encodeURIComponent(head)}`, '--jq', '[.ahead_by,.behind_by]']),
      v.baseRefName === main
        ? Promise.resolve(null)
        : gh(io, account, ['api', `repos/${repo}/compare/${encodeURIComponent(main)}...${encodeURIComponent(head)}`, '--jq', '[.behind_by,.merge_base_commit.commit.committer.date]']),
    ])
    const b = json<[number, number]>(base.out)
    if (b) vsBase = { ahead: b[0], behind: b[1] }
    const m = fromMain ? json<[number, string]>(fromMain.out) : null
    if (m) vsMain = { behind: m[0], forkedAt: m[1] }
  } else if (v.state === 'MERGED' && v.mergedAt) {
    const runs = await gh(io, account, ['run', 'list', '--repo', repo, '--branch', v.baseRefName, '--limit', '8', '--json', 'status,conclusion,createdAt,workflowName,url,event'])
    const list = json<{ status: string; conclusion: string; createdAt: string; workflowName: string; url: string; event: string }[]>(runs.out) ?? []
    const after = list.filter(r => r.createdAt >= v.mergedAt! && r.event === 'push').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    if (after) deploy = { status: after.status, conclusion: after.conclusion || null, workflow: clean(after.workflowName, 40), url: after.url }
  }

  const url = hit.url
  return {
    url,
    repo,
    number: v.number,
    title: clean(v.title, 140),
    account: account.user,
    state: v.state,
    isDraft: v.isDraft,
    base: v.baseRefName,
    head: v.headRefName,
    ticket: ticketKey(`${v.headRefName} ${v.title}`),
    review: v.reviewDecision || null,
    reviewers: v.reviewRequests.map(r => r.login ?? r.name ?? '').filter(Boolean),
    mergeable: v.mergeable || null,
    checks: checks(v.statusCheckRollup),
    comments,
    newComments: Math.max(0, comments - (seen[url] ?? comments)),
    lastComment: last ? { author: last.author, text: clean(last.text, 160), at: last.at } : null,
    othersCommits: [...others].map(([author, count]) => ({ author, count })),
    vsBase,
    vsMain,
    mergedAt: v.mergedAt,
    mergedBy: v.mergedBy?.login ?? null,
    deploy,
    conflictFiles: null,
    additions: v.additions,
    deletions: v.deletions,
    changedFiles: v.changedFiles,
    updatedAt: v.updatedAt,
  }
}

let isFetching = false

export async function refreshPrs(io: Io): Promise<void> {
  if (isFetching) return
  isFetching = true
  await io.s.prs.set(p => ({ ...p, isLoading: true }))
  try {
    const accounts = await ghAccounts(io)
    if (!accounts.length) {
      await io.s.prs.set(p => ({ ...p, isLoading: false, error: 'gh is not logged in (run: gh auth login)' }))
      return
    }
    const now = await io.now()
    const since = new Date(now - MERGED_DAYS * 86400_000).toISOString().slice(0, 10)
    const seen = ((await io.storeGet('seen')) as Record<string, number> | undefined) ?? {}
    const search = ['--author', '@me', '--json', 'url,number,title,isDraft,updatedAt,repository', '--limit', '30']
    const found = await Promise.all(
      accounts.map(async account => {
        const [open, merged] = await Promise.all([
          gh(io, account, ['search', 'prs', '--state', 'open', ...search]),
          gh(io, account, ['search', 'prs', '--merged', '--merged-at', `>=${since}`, ...search]),
        ])
        const hits = [...(json<SearchHit[]>(open.out) ?? []), ...(json<SearchHit[]>(merged.out) ?? [])]
        return hits.map(hit => ({ account, hit }))
      }),
    )
    const unique = new Map<string, { account: GhAccount; hit: SearchHit }>()
    for (const one of found.flat()) unique.set(one.hit.url, one)

    const items: Pr[] = []
    const queue = [...unique.values()]
    // ponytail: 6 at a time keeps GitHub's secondary rate limit happy; raise if it's slow.
    for (let i = 0; i < queue.length; i += 6) {
      const batch = await Promise.all(queue.slice(i, i + 6).map(({ account, hit }) => detail(io, account, hit, seen)))
      for (const pr of batch) if (pr) items.push(pr)
    }
    const old = await io.s.prs.get()
    for (const pr of items) pr.conflictFiles = old.items.find(o => o.url === pr.url)?.conflictFiles ?? null
    const rank = (p: Pr): number => (attention(p) ? 0 : p.state === 'OPEN' ? (p.isDraft ? 2 : 1) : 3)
    items.sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt))
    // A PR seen for the first time starts as "read".
    let isSeenChanged = false
    for (const pr of items) {
      if (seen[pr.url] === undefined) {
        seen[pr.url] = pr.comments
        isSeenChanged = true
      }
    }
    if (isSeenChanged) await io.storeSet('seen', seen)
    const done = { items, at: await io.now(), isLoading: false, error: null }
    await io.s.prs.set(() => done)
    await io.storeSet('prs', done)
  } catch (error) {
    await io.s.prs.set(p => ({ ...p, isLoading: false, error: clean(String(error), 160) }))
  } finally {
    isFetching = false
  }
}

/** Mark a PR's comments as read. */
export async function markSeen(io: Io, url: string): Promise<void> {
  const prs = await io.s.prs.get()
  const pr = prs.items.find(p => p.url === url)
  if (!pr) return
  const seen = ((await io.storeGet('seen')) as Record<string, number> | undefined) ?? {}
  seen[url] = pr.comments
  await io.storeSet('seen', seen)
  await io.s.prs.set(p => ({ ...p, items: p.items.map(i => (i.url === url ? { ...i, newComments: 0 } : i)) }))
}

/** Which files would conflict if the PR merged now — via a local clone, read-only. */
export async function checkConflicts(io: Io, url: string): Promise<void> {
  const prs = await io.s.prs.get()
  const pr = prs.items.find(p => p.url === url)
  if (!pr) return
  const account = (await ghAccounts(io)).find(a => a.user === pr.account)
  const clone = await findClone(io, pr.repo)
  if (!clone || !account) {
    io.toast(`No local clone of ${pr.repo} found near this session`)
    return
  }
  io.toast(`Checking ${pr.repo}#${pr.number} against ${pr.base}…`)
  const fetched = await io.run(['git', '-C', clone, 'fetch', '--quiet', 'origin', pr.base, pr.head], { env: { GH_TOKEN: account.token }, timeoutMs: 60_000 })
  if (!fetched.ok) {
    io.toast(`git fetch failed: ${clean(fetched.err, 100)}`)
    return
  }
  const merged = await git(io, clone, 'merge-tree', '--write-tree', '--name-only', '--no-messages', `origin/${pr.base}`, `origin/${pr.head}`)
  const files = merged.code === 1 ? merged.out.split('\n').slice(1).filter(Boolean) : []
  await io.s.prs.set(p => ({ ...p, items: p.items.map(i => (i.url === url ? { ...i, conflictFiles: files } : i)) }))
  io.toast(files.length ? `${files.length} file(s) conflict with ${pr.base}` : `No conflicts with ${pr.base}`)
}

async function findClone(io: Io, repo: string): Promise<string | null> {
  const candidates = new Set<string>()
  const top = await git(io, me.root, 'rev-parse', '--show-toplevel')
  if (top.ok) candidates.add(top.out)
  for (const entry of await io.list(me.root).catch(() => [])) {
    if (entry.kind === 'dir' && !entry.name.startsWith('.')) candidates.add(`${me.root}/${entry.name}`)
  }
  for (const dir of candidates) {
    const remote = await git(io, dir, 'remote', 'get-url', 'origin')
    if (remote.ok && remote.out.replace(/\.git$/, '').toLowerCase().endsWith(repo.toLowerCase())) return dir
  }
  return null
}

export async function prsOnStart(io: Io): Promise<void> {
  if (!config.isTrackingPrs) return
  const cached = (await io.storeGet('prs')) as Prs | undefined
  if (Array.isArray(cached?.items)) await io.s.prs.set(() => ({ ...cached, isLoading: false, error: null }))
  void refreshPrs(io)
  io.every(REFRESH_MS, () => void refreshPrs(io))
}
