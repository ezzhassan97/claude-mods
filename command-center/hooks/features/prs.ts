import type { CheckState, Deploy, Github, Pr } from '../../types'
import { clean, ticketKey } from '../lib/fmt'
import { accountFor, gh, ghAccounts, git, json } from '../lib/io'
import type { GhAccount, Io } from '../lib/io'

// GitHub for this session: the PR of each branch it works on (review state,
// comments and how many are new, commits someone else pushed, drift from its
// base and from the default branch, mergeability, checks, the deploy after a
// merge), the deployments of those branches (Vercel and the like), and your
// other PRs across every `gh` account. Read-only: every call is a GET, and
// conflicts are checked with `git merge-tree`, which writes no branch.

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
  url: string
}

const FIELDS = 'number,title,state,isDraft,baseRefName,headRefName,headRepositoryOwner,mergeable,reviewDecision,latestReviews,reviewRequests,comments,commits,statusCheckRollup,mergedAt,mergedBy,additions,deletions,changedFiles,updatedAt,url'

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

async function detail(io: Io, account: GhAccount, repo: string, ref: string, seen: Record<string, number>): Promise<Pr | null> {
  const viewRun = await gh(io, account, ['pr', 'view', ref, '--repo', repo, '--json', FIELDS])
  const v = viewRun.ok ? json<View>(viewRun.out) : null
  if (!v) return null
  const owner = v.headRepositoryOwner?.login ?? repo.split('/')[0] ?? ''
  const [inline, main] = await Promise.all([gh(io, account, ['api', `repos/${repo}/pulls/${v.number}/comments`, '--jq', 'length']), defaultBranch(io, account, repo)])
  const reviewBodies = v.latestReviews.filter(r => r.body?.trim())
  const comments = v.comments.length + Number(inline.out || 0) + reviewBodies.length
  const talk = [
    ...v.comments.map(c => ({ author: c.author.login, text: c.body, at: c.createdAt })),
    ...reviewBodies.map(r => ({ author: r.author.login, text: `${r.state.toLowerCase().replace('_', ' ')}: ${r.body}`, at: r.submittedAt })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  const last = talk[0]
  const others = new Map<string, number>()
  for (const commit of v.commits) for (const author of commit.authors) if (author.login && author.login !== account.user) others.set(author.login, (others.get(author.login) ?? 0) + 1)

  let vsBase: Pr['vsBase'] = null
  let vsMain: Pr['vsMain'] = null
  let deploy: Pr['deploy'] = null
  if (v.state === 'OPEN') {
    const head = `${owner}:${v.headRefName}`
    const [base, fromMain] = await Promise.all([
      gh(io, account, ['api', `repos/${repo}/compare/${encodeURIComponent(v.baseRefName)}...${encodeURIComponent(head)}`, '--jq', '[.ahead_by,.behind_by]']),
      v.baseRefName === main ? Promise.resolve(null) : gh(io, account, ['api', `repos/${repo}/compare/${encodeURIComponent(main)}...${encodeURIComponent(head)}`, '--jq', '[.behind_by,.merge_base_commit.commit.committer.date]']),
    ])
    const b = json<[number, number]>(base.out)
    if (b) vsBase = { ahead: b[0], behind: b[1] }
    const m = fromMain ? json<[number, string]>(fromMain.out) : null
    if (m) vsMain = { behind: m[0], forkedAt: m[1] }
  } else if (v.state === 'MERGED' && v.mergedAt) {
    const runs = await gh(io, account, ['run', 'list', '--repo', repo, '--branch', v.baseRefName, '--limit', '8', '--json', 'status,conclusion,createdAt,workflowName,url,event'])
    const after = (json<{ status: string; conclusion: string; createdAt: string; workflowName: string; url: string; event: string }[]>(runs.out) ?? [])
      .filter(r => r.createdAt >= v.mergedAt! && r.event === 'push')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
    if (after) deploy = { status: after.status, conclusion: after.conclusion || null, workflow: clean(after.workflowName, 40), url: after.url }
  }
  return {
    url: v.url,
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
    newComments: Math.max(0, comments - (seen[v.url] ?? comments)),
    lastComment: last ? { author: last.author, text: clean(last.text, 200), at: last.at } : null,
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

async function deploysOf(io: Io, account: GhAccount, repo: string, ref: string): Promise<Deploy[]> {
  const r = await gh(io, account, ['api', `repos/${repo}/deployments?ref=${encodeURIComponent(ref)}&per_page=2`])
  const list = json<{ id: number; environment: string; created_at: string; ref: string }[]>(r.out) ?? []
  const out: Deploy[] = []
  for (const d of list) {
    const s = await gh(io, account, ['api', `repos/${repo}/deployments/${d.id}/statuses?per_page=1`])
    const status = json<{ state: string; environment_url?: string; target_url?: string; created_at: string }[]>(s.out)?.[0]
    out.push({ repo, ref: d.ref, environment: clean(d.environment, 40), state: status?.state ?? 'pending', url: status?.environment_url || status?.target_url || null, at: status?.created_at ?? d.created_at })
  }
  return out
}

let isFetching = false

/** This session's PRs and deployments, by the branches it works on. */
export async function refreshFocusPrs(io: Io): Promise<void> {
  if (isFetching) return
  isFetching = true
  try {
    const focus = await io.s.focus.get()
    const seen = ((await io.storeGet('seen')) as Record<string, number> | undefined) ?? {}
    const prs: Pr[] = []
    const deploys: Deploy[] = []
    for (const b of focus?.branches ?? []) {
      if (!b.remote || !b.branch) continue
      const account = await accountFor(io, b.remote)
      if (!account) continue
      const list = await gh(io, account, ['pr', 'list', '--repo', b.remote, '--head', b.branch, '--state', 'all', '--limit', '1', '--json', 'number'])
      const n = json<{ number: number }[]>(list.out)?.[0]?.number
      if (n) {
        const pr = await detail(io, account, b.remote, String(n), seen)
        if (pr) prs.push(pr)
      }
      deploys.push(...(await deploysOf(io, account, b.remote, b.branch)))
    }
    for (const pr of prs) if (seen[pr.url] === undefined) seen[pr.url] = pr.comments
    await io.storeSet('seen', seen)
    const old = await io.s.github.get()
    for (const pr of prs) pr.conflictFiles = old.focus.find(o => o.url === pr.url)?.conflictFiles ?? null
    const at = await io.now()
    await io.s.github.set(g => ({ ...g, focus: prs, deploys, at, error: null }))
  } catch (error) {
    await io.s.github.set(g => ({ ...g, error: clean(String(error), 160) }))
  } finally {
    isFetching = false
  }
}

/** Every open PR you authored (and those merged this week), across all accounts. */
export async function refreshMine(io: Io): Promise<void> {
  await io.s.github.set(g => ({ ...g, isLoading: true }))
  try {
    const now = await io.now()
    const since = new Date(now - 7 * 86400_000).toISOString().slice(0, 10)
    const fields = ['--author', '@me', '--json', 'url,number,repository', '--limit', '25']
    const seen = ((await io.storeGet('seen')) as Record<string, number> | undefined) ?? {}
    const hits: { account: GhAccount; repo: string; number: number }[] = []
    for (const account of await ghAccounts(io)) {
      for (const state of [['--state', 'open'], ['--merged', '--merged-at', `>=${since}`]]) {
        const r = await gh(io, account, ['search', 'prs', ...state, ...fields])
        for (const h of json<{ number: number; repository: { nameWithOwner: string } }[]>(r.out) ?? []) hits.push({ account, repo: h.repository.nameWithOwner, number: h.number })
      }
    }
    const mine: Pr[] = []
    for (let i = 0; i < hits.length; i += 6) {
      const batch = await Promise.all(hits.slice(i, i + 6).map(h => detail(io, h.account, h.repo, String(h.number), seen)))
      for (const pr of batch) if (pr) mine.push(pr)
    }
    const rank = (p: Pr): number => (p.state !== 'OPEN' ? 3 : p.review === 'CHANGES_REQUESTED' || p.mergeable === 'CONFLICTING' || p.newComments ? 0 : p.isDraft ? 2 : 1)
    mine.sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt))
    await io.s.github.set(g => ({ ...g, mine, isLoading: false, at: now }))
    await io.storeSet('mine', mine)
  } catch (error) {
    await io.s.github.set(g => ({ ...g, isLoading: false, error: clean(String(error), 160) }))
  }
}

export async function markSeen(io: Io, url: string): Promise<void> {
  const g: Github = await io.s.github.get()
  const pr = [...g.focus, ...g.mine].find(p => p.url === url)
  if (!pr) return
  const seen = ((await io.storeGet('seen')) as Record<string, number> | undefined) ?? {}
  seen[url] = pr.comments
  await io.storeSet('seen', seen)
  const clear = (list: Pr[]): Pr[] => list.map(p => (p.url === url ? { ...p, newComments: 0 } : p))
  await io.s.github.set(x => ({ ...x, focus: clear(x.focus), mine: clear(x.mine) }))
}

/** Which files would conflict if the PR merged now, from the session's own copy. */
export async function checkConflicts(io: Io, url: string): Promise<void> {
  const g = await io.s.github.get()
  const pr = g.focus.find(p => p.url === url)
  const focus = await io.s.focus.get()
  const copy = focus?.branches.find(b => b.remote?.toLowerCase() === pr?.repo.toLowerCase())
  const account = pr ? await accountFor(io, pr.repo) : null
  if (!pr || !copy || !account) return
  io.toast(`Checking ${pr.repo.split('/')[1]} #${pr.number} against ${pr.base}…`)
  const fetched = await io.run(['git', '-C', copy.root, 'fetch', '--quiet', 'origin', pr.base, pr.head], { env: { GH_TOKEN: account.token }, timeoutMs: 60_000 })
  if (!fetched.ok) return io.toast(`git fetch failed: ${clean(fetched.err, 100)}`)
  const merged = await git(io, copy.root, 'merge-tree', '--write-tree', '--name-only', '--no-messages', `origin/${pr.base}`, `origin/${pr.head}`)
  const files = merged.code === 1 ? merged.out.split('\n').slice(1).filter(Boolean) : []
  await io.s.github.set(x => ({ ...x, focus: x.focus.map(p => (p.url === url ? { ...p, conflictFiles: files } : p)) }))
}
