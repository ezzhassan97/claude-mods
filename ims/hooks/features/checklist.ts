import type { Checklist, Requirement, UatResult } from '../../types'
import { clean, plural } from '../lib/fmt'
import type { Io } from '../lib/io'
import { ticketBrief } from './stories'

// Requirements checklist and UAT board.
// The story's Requirements section (Ezz's story format: Objective,
// Requirements, References, Testing) becomes a checklist Claude ticks through
// the `requirements` tool as it builds and tests; /ims-end is told what is
// still open. During /uat-start every requirement's verdict is logged through
// the `uat_log` tool and drawn as a board; /uat-end gets the summary.

/** The numbered or bulleted items under a "Requirements" heading. */
export function parseRequirements(markdown: string): string[] {
  const lines = markdown.split('\n')
  const start = lines.findIndex(l => /^\s*(#{1,6}\s*|\*\*|__)?\s*requirements\b/i.test(l))
  if (start === -1) return []
  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#{1,6}\s+|\*\*[A-Z]|__[A-Z])/.test(line) && !/^\s*\*\*\d/.test(line)) break
    const m = /^\s*(?:\d+[.)]|[-*•])\s+(.*)$/.exec(line)
    if (m?.[1]) items.push(clean(m[1].replace(/\*\*/g, ''), 220))
  }
  return items
}

export async function loadChecklist(io: Io, key: string): Promise<Checklist | null> {
  const saved = (await io.storeGet(`checklist:${key}`)) as Checklist | undefined
  const brief = await ticketBrief(io, key)
  if (!brief) return saved ?? null
  const texts = parseRequirements(brief.description)
  const items: Requirement[] = texts.map((text, i) => {
    const prior = saved?.items.find(r => r.text === text)
    return { id: i + 1, text, state: prior?.state ?? 'open', note: prior?.note ?? null }
  })
  const list: Checklist = { key, summary: brief.summary, items }
  await io.s.checklist.set(() => list)
  await io.storeSet(`checklist:${key}`, list)
  return list
}

export const REQUIREMENTS_TOOL = {
  name: 'requirements',
  description:
    "The active IMS story's requirements checklist (from its Jira Requirements section). Call with action 'list' to see it; " +
    "with action 'mark', ids and state ('done' when implemented, 'tested' when verified, 'waived' only when Ezz says so, 'open' to undo) " +
    'as you implement and verify each requirement. Optional key loads another story (IMS-1234).',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'mark'] },
      ids: { type: 'array', items: { type: 'number' } },
      state: { type: 'string', enum: ['open', 'done', 'tested', 'waived'] },
      note: { type: 'string' },
      key: { type: 'string' },
    },
    required: ['action'],
  },
  isDeferred: false,
} as const

export async function requirementsTool(io: Io, input: { action?: string; ids?: number[]; state?: Requirement['state']; note?: string; key?: string }): Promise<string> {
  let list = await io.s.checklist.get()
  if (input.key && input.key !== list?.key) list = await loadChecklist(io, input.key.toUpperCase())
  if (!list) return 'No active story. Mention its key (IMS-1234) or pass key.'
  if (input.action === 'mark' && input.ids?.length && input.state) {
    const ids = new Set(input.ids)
    const state = input.state
    const note = input.note ? clean(input.note, 200) : null
    const next: Checklist = { ...list, items: list.items.map(r => (ids.has(r.id) ? { ...r, state, note: note ?? r.note } : r)) }
    await io.s.checklist.set(() => next)
    await io.storeSet(`checklist:${next.key}`, next)
    list = next
  }
  return render(list)
}

export function render(list: Checklist): string {
  if (!list.items.length) return `${list.key} ${list.summary}: no Requirements section found in the story.`
  const mark = { open: '[ ]', done: '[x]', tested: '[✓]', waived: '[~]' } as const
  const open = list.items.filter(r => r.state === 'open').length
  return [`${list.key} ${list.summary} — ${list.items.length - open}/${list.items.length} done`, ...list.items.map(r => `${mark[r.state]} ${r.id}. ${r.text}${r.note ? ` — ${r.note}` : ''}`)].join('\n')
}

export const UAT_TOOL = {
  name: 'uat_log',
  description:
    "Log one UAT verdict for an IMS story while testing on staging: key, requirement (its text or number), result 'pass' | 'fail' | 'blocked', " +
    'an optional note (what you saw) and the bug sub-task key once one is filed. Log every requirement you test; the board is what /uat-end reports.',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      requirement: { type: 'string' },
      result: { type: 'string', enum: ['pass', 'fail', 'blocked'] },
      note: { type: 'string' },
      bug: { type: 'string' },
    },
    required: ['key', 'requirement', 'result'],
  },
  isDeferred: false,
} as const

export async function uatTool(io: Io, input: { key?: string; requirement?: string; result?: UatResult['result']; note?: string; bug?: string }): Promise<string> {
  if (!input.key || !input.requirement || !input.result) return 'key, requirement and result are required.'
  const entry: UatResult = {
    key: input.key.toUpperCase(),
    requirement: clean(input.requirement, 200),
    result: input.result,
    note: input.note ? clean(input.note, 240) : null,
    bug: input.bug ? clean(input.bug, 20) : null,
    at: await io.now(),
  }
  const all = [...(await io.s.uat.get()).filter(r => !(r.key === entry.key && r.requirement === entry.requirement)), entry]
  await io.s.uat.set(() => all)
  await io.storeSet('uat', all)
  return uatSummary(all, entry.key)
}

export function uatSummary(all: UatResult[], key?: string): string {
  const keys = key ? [key] : [...new Set(all.map(r => r.key))]
  if (!keys.length) return 'No UAT results logged.'
  return keys
    .map(k => {
      const rows = all.filter(r => r.key === k)
      const count = (x: UatResult['result']): number => rows.filter(r => r.result === x).length
      return [`${k}: ${plural(count('pass'), 'pass', 'pass')}, ${count('fail')} fail, ${count('blocked')} blocked`, ...rows.map(r => `- ${r.result.toUpperCase()} ${r.requirement}${r.note ? ` — ${r.note}` : ''}${r.bug ? ` (bug ${r.bug})` : ''}`)].join('\n')
    })
    .join('\n\n')
}
