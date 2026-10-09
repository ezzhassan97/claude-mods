import type { PrRef, Stories, Story, Sub } from '../../types'
import { config } from '../lib/config'
import { clean, ticketKey } from '../lib/fmt'
import { json } from '../lib/io'
import type { Io } from '../lib/io'

// Your IMS stories, each with everything around it: Jira status, the bug,
// review and testing sub-tasks, the latest comment, the frontend and backend
// PRs found by the ticket key in their branch, and the worktree it lives in.
// Jira goes through the Atlassian connector the session already has; GitHub
// through `gh` with the nawy account's token, per command.

const REFRESH_MS = 5 * 60_000
export const STORIES_EVERY = REFRESH_MS

type JiraIssue = {
  key: string
  webUrl?: string
  fields: {
    summary: string
    updated: string
    status: { name: string; statusCategory?: { key: string } }
    issuetype: { name: string }
    subtasks?: { key: string; fields: { summary: string; status: { name: string; statusCategory?: { key: string } }; issuetype: { name: string } } }[]
    comment?: { total: number; comments: { author?: { displayName?: string }; created: string; body: unknown }[] }
  }
}

/** The JSON payload of an MCP text result (a transport notice may lead it). */
export function payload<T>(result: unknown): T | null {
  const content = (result as { content?: { type: string; text?: string }[] } | null)?.content ?? []
  const text = content.map(c => c.text ?? '').join('')
  const body = text.replace(/^\s*\[IMPORTANT:[^\]]*\]\s*/, '')
  return json<T>(body.slice(Math.max(0, body.search(/[[{]/))))
}

const textOf = (body: unknown): string =>
  typeof body === 'string' ? body : JSON.stringify(body ?? '').replace(/"(type|version|attrs)":"?[^,}]*"?,?/g, '').replace(/[{}[\]"]/g, ' ')

function kindOf(summary: string, type: string): Sub['kind'] {
  if (/^\[bug\]/i.test(summary) || /bug/i.test(type)) return 'bug'
  if (/^code review/i.test(summary)) return 'review'
  if (/^testing/i.test(summary)) return 'testing'
  return 'task'
}

type GhPr = { number: number; url: string; state: string; isDraft: boolean; headRefName: string; baseRefName: string; reviewDecision: string; mergedAt: string | null; updatedAt: string }

async function prsByTicket(io: Io): Promise<Map<string, PrRef[]>> {
  const token = await io.run(['gh', 'auth', 'token', '--hostname', 'github.com', '--user', config.ghUser])
  const map = new Map<string, PrRef[]>()
  if (!token.ok) return map
  const fields = 'number,url,state,isDraft,headRefName,baseRefName,reviewDecision,mergedAt,updatedAt'
  const repos = [['frontend', config.frontendRepo], ['backend', config.backendRepo]] as const
  await Promise.all(
    repos.map(async ([side, repo]) => {
      const r = await io.run(['gh', 'pr', 'list', '--repo', repo, '--author', '@me', '--state', 'all', '--limit', '60', '--json', fields], { env: { GH_TOKEN: token.out }, timeoutMs: 30_000 })
      for (const pr of json<GhPr[]>(r.out) ?? []) {
        const key = ticketKey(pr.headRefName)
        if (!key) continue
        const ref: PrRef = { repo: side, number: pr.number, url: pr.url, state: pr.state, isDraft: pr.isDraft, review: pr.reviewDecision || null, base: pr.baseRefName, mergedAt: pr.mergedAt }
        // Several PRs per side (adjustments open new ones): keep the newest first.
        map.set(key, [...(map.get(key) ?? []), ref].sort((a, b) => b.number - a.number))
      }
    }),
  )
  return map
}

export async function refreshStories(io: Io): Promise<void> {
  await io.s.stories.set(s => ({ ...s, isLoading: true }))
  try {
    const jql = `project = ${config.jiraProject} AND assignee = currentUser() AND (statusCategory != Done OR updated >= -7d) AND issuetype not in subTaskIssueTypes() ORDER BY updated DESC`
    const [result, prs, worktrees] = await Promise.all([
      io.jira('searchJiraIssuesUsingJql', { cloudId: config.jiraSite, jql, fields: ['summary', 'status', 'issuetype', 'subtasks', 'updated', 'comment'], maxResults: 50, responseContentFormat: 'markdown' }),
      prsByTicket(io),
      io.s.worktrees.get(),
    ])
    const found = payload<{ issues?: { nodes?: JiraIssue[] } }>(result)
    if (!found?.issues?.nodes) throw new Error('Jira did not answer (is the Atlassian connector connected?)')
    const items: Story[] = found.issues.nodes.map(issue => {
      const f = issue.fields
      const comments = f.comment?.comments ?? []
      const last = comments[comments.length - 1]
      return {
        key: issue.key,
        summary: clean(f.summary, 120),
        status: f.status.name,
        category: f.status.statusCategory?.key ?? '',
        type: f.issuetype.name,
        url: issue.webUrl ?? `https://${config.jiraSite}/browse/${issue.key}`,
        updated: f.updated,
        subs: (f.subtasks ?? []).map(s => ({
          key: s.key,
          summary: clean(s.fields.summary, 100),
          status: s.fields.status.name,
          isDone: s.fields.status.statusCategory?.key === 'done',
          kind: kindOf(s.fields.summary, s.fields.issuetype.name),
        })),
        lastComment: last ? { author: last.author?.displayName ?? 'someone', text: clean(textOf(last.body), 160), at: last.created } : null,
        comments: f.comment?.total ?? comments.length,
        prs: prs.get(issue.key) ?? [],
        worktree: worktrees.find(w => w.ticket === issue.key && !w.isUat)?.folder ?? null,
      }
    })
    const done: Stories = { items, at: await io.now(), isLoading: false, error: null }
    await io.s.stories.set(() => done)
    await io.storeSet('stories', done)
  } catch (error) {
    await io.s.stories.set(s => ({ ...s, isLoading: false, error: clean(String(error), 160) }))
  }
}

/** One story's summary, status and description, for Claude's context. */
export async function ticketBrief(io: Io, key: string): Promise<{ summary: string; text: string; description: string } | null> {
  const result = await io.jira('getJiraIssue', { cloudId: config.jiraSite, issueIdOrKey: key, fields: ['summary', 'status', 'issuetype', 'description', 'subtasks'], responseContentFormat: 'markdown' })
  const issue = payload<JiraIssue & { fields: { description?: unknown } }>(result)
  if (!issue?.fields) return null
  const f = issue.fields
  const description = typeof f.description === 'string' ? f.description : textOf(f.description)
  const subs = (f.subtasks ?? []).map(s => `- ${s.key} ${s.fields.summary} (${s.fields.status.name})`).join('\n')
  const text = [`<ims-ticket key="${key}">`, `${key} · ${f.issuetype.name} · ${f.status.name}`, `Summary: ${f.summary}`, '', description.slice(0, 4000), subs ? `\nSub-tasks:\n${subs}` : '', '</ims-ticket>'].join('\n')
  return { summary: clean(f.summary, 120), text, description }
}
