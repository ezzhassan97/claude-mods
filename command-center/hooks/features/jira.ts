import type { Requirement, Sub, Ticket } from '../../types'
import { clean } from '../lib/fmt'
import { json } from '../lib/io'
import type { Io } from '../lib/io'

// Jira for this session: the ticket its branch names (IMS-2423), with its
// status, sub-tasks (bugs, code review, testing), comments, and the
// Requirements section of the story as a checklist. Claude ticks that list
// through the `requirements` tool as it builds and tests; /ims-end is told
// what is still open. Reads go through the Atlassian connector the session
// already has; nothing is ever written to Jira from here.

export const JIRA_SITE = 'nawy.atlassian.net'

/** The error a ticket carries when the session's permissions refused the lookup. */
export const BLOCKED = "This session's permissions blocked the Jira lookup."

/**
 * Allow the read-only "get Jira issue" lookup of each Atlassian connector in
 * ~/.claude/settings.json (permissions.allow), then load the ticket again.
 * Only run from the button the person presses; nothing else is added.
 */
export async function allowJira(io: Io): Promise<void> {
  const names = await io.mcpTools('__getJiraIssue')
  if (!names.length) return io.toast('No Atlassian connector in this session')
  const path = `${await io.home()}/.claude/settings.json`
  const settings = json<{ permissions?: { allow?: string[] } } & Record<string, unknown>>(await io.read(path).catch(() => '{}'))
  if (!settings) return io.toast("Couldn't read ~/.claude/settings.json, so nothing was changed")
  const allow = settings.permissions?.allow ?? []
  const added = names.filter(n => !allow.includes(n))
  if (added.length) await io.write(path, `${JSON.stringify({ ...settings, permissions: { ...settings.permissions, allow: [...allow, ...added] } }, null, 2)}\n`)
  io.toast(added.length ? `Allowed ${added.length} read-only Jira lookup${added.length > 1 ? 's' : ''} in ~/.claude/settings.json` : 'Jira lookups were already allowed')
  await refreshTicket(io)
}

type Issue = {
  key: string
  webUrl?: string
  fields: {
    summary: string
    status: { name: string; statusCategory?: { key: string } }
    issuetype?: { name: string }
    description?: unknown
    subtasks?: { key: string; fields: { summary: string; status: { name: string; statusCategory?: { key: string } }; issuetype: { name: string } } }[]
    comment?: { comments: { author?: { displayName?: string }; created: string; body: unknown }[] }
  }
}

/** The JSON payload of an MCP text result (a transport notice may lead it). */
export function payload<T>(result: unknown): T | null {
  const content = (result as { content?: { type: string; text?: string }[] } | null)?.content ?? []
  const text = content.map(c => c.text ?? '').join('').replace(/^\s*\[IMPORTANT:[^\]]*\]\s*/, '')
  return json<T>(text.slice(Math.max(0, text.search(/[[{]/))))
}

const textOf = (body: unknown): string => (typeof body === 'string' ? body : JSON.stringify(body ?? '').replace(/"(type|version|attrs)":"?[^,}]*"?,?/g, '').replace(/[{}[\]"]/g, ' '))

function kindOf(summary: string, type: string): Sub['kind'] {
  if (/^\[bug\]/i.test(summary) || /bug/i.test(type)) return 'bug'
  if (/^code review/i.test(summary)) return 'review'
  if (/^testing/i.test(summary)) return 'testing'
  return 'task'
}

/**
 * The numbered or bulleted items under a "Requirements" heading: `## 2. Requirements`,
 * `## Requirements` or a bold `**Requirements**`, through its own sub-headings
 * (`### 2.1 First step`) up to the next heading of the same level or higher.
 */
export function parseRequirements(markdown: string): string[] {
  const lines = markdown.split('\n')
  let level = 0
  const start = lines.findIndex(l => {
    const h = /^\s*(#{1,6})\s*(?:\d+(?:\.\d+)*\.?\s*)?requirements\b/i.exec(l)
    if (h) level = h[1]!.length
    else if (/^\s*(\*\*|__)\s*(?:\d+\.?\s*)?requirements\b/i.test(l)) level = 7
    return level > 0
  })
  if (start === -1) return []
  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    const h = /^\s*(#{1,6})\s/.exec(line)
    if (h && h[1]!.length <= Math.min(level, 6)) break
    if (level === 7 && (h || /^\s*(\*\*|__)[A-Z]/.test(line))) break
    const m = /^\s*(?:\d+[.)]|[-*•])\s+(.*)$/.exec(line)
    if (m?.[1]) items.push(clean(m[1].replace(/\*\*/g, ''), 220))
  }
  return items
}

/** The issue in a connector's answer: `{ issues: { nodes: [issue] } }`, `{ data: issue }` or the bare issue. */
export function issueOf(result: unknown): Issue | null {
  const found = payload<Issue & { issues?: { nodes?: Issue[] }; data?: Issue }>(result)
  const issue = found?.issues?.nodes?.[0] ?? found?.data ?? found
  return issue?.fields ? issue : null
}

async function fetchIssue(io: Io, key: string): Promise<Issue> {
  // The newer Atlassian connector leaves out sub-tasks and comments, so the one that sends them wins.
  const result = await io.mcp('__getJiraIssue', { cloudId: JIRA_SITE, issueIdOrKey: key, fields: ['summary', 'status', 'issuetype', 'description', 'subtasks', 'comment'], responseContentFormat: 'markdown' }, r => !!issueOf(r)?.fields.subtasks)
  const issue = issueOf(result)
  if (!issue) {
    const r = result as { isError?: boolean; content?: { text?: string }[] } | null
    const text = r?.isError ? (r.content ?? []).map(c => c.text ?? '').join(' ').replace(/^HooksError:\s*command-center:\s*/, '') : (payload<{ message?: string }>(result)?.message ?? JSON.stringify(result))
    // a plugin's connector call goes through the session's permission check like Claude's own
    if (/refused/i.test(text)) throw new Error(BLOCKED)
    throw new Error(clean(text, 200))
  }
  return issue
}

export async function refreshTicket(io: Io): Promise<void> {
  const focus = await io.s.focus.get()
  const key = focus?.ticket
  if (!key) {
    await io.s.ticket.set(() => null)
    return
  }
  try {
    const issue = await fetchIssue(io, key)
    const f = issue.fields
    const saved = ((await io.storeGet(`req:${key}`)) as Record<string, Requirement['state']> | undefined) ?? {}
    const texts = parseRequirements(typeof f.description === 'string' ? f.description : textOf(f.description))
    const ticket: Ticket = {
      key,
      summary: clean(f.summary, 140),
      status: f.status.name,
      category: f.status.statusCategory?.key ?? '',
      type: f.issuetype?.name ?? '',
      url: issue.webUrl ?? `https://${JIRA_SITE}/browse/${key}`,
      subs: (f.subtasks ?? []).map(s => ({ key: s.key, summary: clean(s.fields.summary, 110), status: s.fields.status.name, isDone: s.fields.status.statusCategory?.key === 'done', kind: kindOf(s.fields.summary, s.fields.issuetype.name) })),
      comments: (f.comment?.comments ?? []).slice(-5).map(c => ({ author: c.author?.displayName ?? 'someone', text: clean(textOf(c.body), 240), at: c.created })),
      requirements: texts.map((text, i) => ({ id: i + 1, text, state: saved[text] ?? 'open' })),
      at: await io.now(),
      error: null,
    }
    await io.s.ticket.set(() => ticket)
  } catch (error) {
    const message = clean(String(error).replace(/^Error: /, ''), 160)
    await io.s.ticket.set(t => (t?.key === key ? { ...t, error: message } : { key, summary: '', status: '', category: '', type: '', url: `https://${JIRA_SITE}/browse/${key}`, subs: [], comments: [], requirements: [], at: 0, error: message }))
  }
}

/** One story's text for Claude's context, the first time a prompt names it. */
export async function ticketContext(io: Io, key: string): Promise<string | null> {
  const issue = await fetchIssue(io, key).catch(() => null)
  if (!issue?.fields) return null
  const f = issue.fields
  const description = typeof f.description === 'string' ? f.description : textOf(f.description)
  const subs = (f.subtasks ?? []).map(s => `- ${s.key} ${s.fields.summary} (${s.fields.status.name})`).join('\n')
  return [`<jira-ticket key="${key}">`, `${key} · ${f.issuetype?.name ?? 'Issue'} · ${f.status.name}`, `Summary: ${f.summary}`, '', description.slice(0, 4000), subs ? `\nSub-tasks:\n${subs}` : '', '</jira-ticket>'].join('\n')
}

export const REQUIREMENTS_TOOL = {
  name: 'requirements',
  description:
    "The requirements checklist of the Jira story this session works on (its Requirements section). Call with action 'list' to see it; " +
    "with action 'mark', ids and state ('done' when implemented, 'tested' when verified, 'waived' only when the user says so, 'open' to undo) " +
    'as you implement and verify each requirement. The user watches this as the session progress.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'mark'] },
      ids: { type: 'array', items: { type: 'number' } },
      state: { type: 'string', enum: ['open', 'done', 'tested', 'waived'] },
    },
    required: ['action'],
  },
  isDeferred: false,
} as const

export function checklistText(t: Ticket): string {
  if (!t.requirements.length) return `${t.key} ${t.summary}: the story has no Requirements section.`
  const mark = { open: '[ ]', done: '[x]', tested: '[✓]', waived: '[~]' } as const
  const done = t.requirements.filter(r => r.state !== 'open').length
  return [`${t.key} ${t.summary} — ${done}/${t.requirements.length} done`, ...t.requirements.map(r => `${mark[r.state]} ${r.id}. ${r.text}`)].join('\n')
}

export async function requirementsTool(io: Io, input: { action?: string; ids?: number[]; state?: Requirement['state'] }): Promise<string> {
  const t = await io.s.ticket.get()
  if (!t) return 'No Jira story for this session (its branch names no ticket key).'
  if (input.action === 'mark' && input.ids?.length && input.state) {
    const ids = new Set(input.ids)
    const state = input.state
    const next: Ticket = { ...t, requirements: t.requirements.map(r => (ids.has(r.id) ? { ...r, state } : r)) }
    await io.s.ticket.set(() => next)
    await io.storeSet(`req:${t.key}`, Object.fromEntries(next.requirements.map(r => [r.text, r.state])))
    return checklistText(next)
  }
  return checklistText(t)
}
