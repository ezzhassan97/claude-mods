// Renders every command-center drawing with sample data into preview.html,
// to look at them in a browser (light and dark) before they reach a session.
// Run: npx -y tsx dev/preview.ts && open dev/preview.html
import { writeFileSync } from 'node:fs'

import type { After, Agent, Beat, Edit, Env, Focus, Github, Pr, Rule, Ticket, Touch, Usage } from '../command-center/types'
import { drawAgents, drawBar, drawDeploys, drawFiles, drawJira, drawKnow, drawNextHead, drawNextRow, drawOverview, drawPr, drawPrList, drawReplay, drawRule, drawTimeline, drawToggle } from '../command-center/hooks/views/draw'
import { CONTROLS } from '../command-center/hooks/features/controls'

const now = Date.parse('2026-10-09T18:00:00Z')
const min = 60_000

const pr = (o: Partial<Pr>): Pr => ({
  url: 'https://github.com/NawyRE/nawy-inventory-frontend/pull/812', repo: 'NawyRE/nawy-inventory-frontend', number: 812, title: 'IMS-2423 Masterplan Amenities Enhancements', account: 'ezzhassan-nawy',
  state: 'OPEN', isDraft: false, base: 'staging', head: 'IMS-2423-Masterplan-Amenities-Enhancements', ticket: 'IMS-2423', review: 'APPROVED', reviewers: ['mazenfayez'], mergeable: 'MERGEABLE', checks: 'pass',
  comments: 3, newComments: 0, lastComment: { author: 'mazenfayez', text: 'Looks good, please extract the pin cluster logic into a hook before merge.', at: new Date(now - 120 * min).toISOString() },
  othersCommits: [], vsBase: { ahead: 4, behind: 12 }, vsMain: { behind: 9, forkedAt: '2026-10-03T10:00:00Z' }, mergedAt: null, mergedBy: null, deploy: null, conflictFiles: null,
  additions: 412, deletions: 96, changedFiles: 14, updatedAt: new Date(now - 30 * min).toISOString(), ...o,
})

const focusPrs = [
  pr({}),
  pr({ url: 'https://github.com/NawyRE/nawy-inventory-backend/pull/455', repo: 'NawyRE/nawy-inventory-backend', number: 455, review: 'CHANGES_REQUESTED', newComments: 2, checks: 'pending', othersCommits: [{ author: 'mazenfayez', count: 2 }], mergeable: 'CONFLICTING', conflictFiles: ['src/compounds/compounds.service.ts', 'src/amenities/amenity.mapper.ts'] }),
]
const github: Github = {
  focus: focusPrs,
  mine: [...focusPrs, pr({ number: 798, title: 'IMS-2408 Render Images Enhancements', state: 'MERGED', review: 'APPROVED', mergedBy: 'mazenfayez', deploy: { status: 'completed', conclusion: 'success', workflow: 'Deploy staging', url: '' } }), pr({ number: 801, title: 'IMS-2419 Projects Configurations Summary Tabs', review: null, isDraft: true })],
  deploys: [{ repo: 'ezzhassan97/ims-v0', ref: 'main', environment: 'Production', state: 'success', url: 'https://ims-nawy-prototype.vercel.app', at: new Date(now - 18 * min).toISOString() }, { repo: 'ezzhassan97/ims-v0', ref: 'amenities-v2', environment: 'Preview', state: 'in_progress', url: null, at: new Date(now - 2 * min).toISOString() }],
  at: now, isLoading: false, error: null,
}

const focus: Focus = {
  project: 'ims-nawy', root: '/x/ims-nawy', isIms: true, worktree: 'masterplan-amenities', isPicked: false, ticket: 'IMS-2423',
  branches: [
    { side: 'frontend', root: '/x/ims-nawy/.worktrees/masterplan-amenities-frontend', name: 'frontend', remote: 'NawyRE/nawy-inventory-frontend', branch: 'IMS-2423-Masterplan-Amenities-Enhancements', base: 'main', commits: 4, unpushed: 1, behindBase: 9, dirty: 0, last: { subject: 'IMS-2423: group overlapping amenity names', at: now - 25 * min } },
    { side: 'backend', root: '/x/ims-nawy/.worktrees/masterplan-amenities-backend', name: 'backend', remote: 'NawyRE/nawy-inventory-backend', branch: 'IMS-2423-Masterplan-Amenities-Enhancements', base: 'main', commits: 3, unpushed: 0, behindBase: 9, dirty: 2, last: { subject: 'IMS-2423: link amenity on pin drop', at: now - 70 * min } },
  ],
}
const env: Env = { mysql: true, mongo: true, redis: true, dbPort: 3308, dbMode: 'staging', fe: { port: 9006, up: true }, be: { port: 3006, up: true }, checkedAt: now }
const ticket: Ticket = {
  key: 'IMS-2423', summary: 'Masterplan Amenities Enhancements', status: 'In Progress', category: 'indeterminate', type: 'Story', url: 'https://nawy.atlassian.net/browse/IMS-2423', at: now, error: null,
  subs: [
    { key: 'IMS-2430', summary: '[Bug] Overlapping names hide the counter', status: 'To Do', isDone: false, kind: 'bug' },
    { key: 'IMS-2431', summary: '[Bug] Zoom resets after linking', status: 'Done', isDone: true, kind: 'bug' },
    { key: 'IMS-2426', summary: 'Code Review: Masterplan Amenities', status: 'Done', isDone: true, kind: 'review' },
    { key: 'IMS-2427', summary: 'Testing: Masterplan Amenities', status: 'To Do', isDone: false, kind: 'testing' },
  ],
  comments: [{ author: 'Mazen Fayez', text: 'Please make sure the pin drop only links amenities inside the drop area, not the whole compound.', at: new Date(now - 200 * min).toISOString() }],
  requirements: [
    { id: 1, text: 'Zoom to the pin when an amenity card is selected', state: 'tested' },
    { id: 2, text: 'Group overlapping amenity names with a counter', state: 'done' },
    { id: 3, text: 'Collapse and expand the amenity columns', state: 'done' },
    { id: 4, text: 'Inherit amenities to properties like the Features tab', state: 'open' },
    { id: 5, text: 'Link an amenity to the area it is dropped in', state: 'open' },
  ],
}
const usage: Usage = { contextPct: 34, contextTokens: 68_400, window: 200_000, costUsd: 1.2, limits: [] }
const agents: Agent[] = [
  { id: 'a1', name: 'Explore', type: 'Explore', model: 'claude-haiku-5-5', description: 'Find every caller of linkAmenity', status: 'running', tools: 14, lastTool: 'Grep', tokens: 26_000, contextTokens: 26_000, costUsd: 0.01, startedAt: now - 1 * min, endedAt: null },
  { id: 'a2', name: 'general-purpose', type: 'general-purpose', model: 'claude-opus-5-5', description: 'Research reference mods', status: 'completed', tools: 21, lastTool: null, tokens: 197_000, contextTokens: 61_000, costUsd: 0.41, startedAt: now - 9 * min, endedAt: now - 5 * min },
]
const touched: Touch[] = [
  { path: '/x/ims-nawy/.worktrees/masterplan-amenities-frontend/src/features/amenities/AmenityMap.tsx', reads: 2, edits: 3, created: false, added: 84, removed: 21, at: now, dependents: 3 },
  { path: '/x/ims-nawy/.worktrees/masterplan-amenities-backend/src/amenities/amenity.mapper.ts', reads: 1, edits: 1, created: false, added: 12, removed: 4, at: now, dependents: 14 },
  { path: '/x/ims-nawy/.worktrees/masterplan-amenities-frontend/src/features/amenities/usePinCluster.ts', reads: 0, edits: 1, created: true, added: 61, removed: 0, at: now, dependents: 0 },
  { path: '/x/ims-nawy/.worktrees/masterplan-amenities-backend/src/compounds/compounds.service.ts', reads: 3, edits: 0, created: false, added: 0, removed: 0, at: now, dependents: null },
]
const others: Beat[] = [
  { id: 's2', project: 'ims-nawy', branch: 'IMS-2425-Developers-Whatsapp-Chats', ticket: 'IMS-2425', title: 'Developers WhatsApp chats', status: 'waiting', waitingFor: 'Approve: git push origin IMS-2425…', contextPct: 61, costUsd: 3.1, agents: 0, updatedAt: now },
  { id: 's3', project: 'septem', branch: 'dev', ticket: null, title: 'Order product brief', status: 'idle', waitingFor: null, contextPct: 12, costUsd: 0.4, agents: 0, updatedAt: now - 14 * min },
]
const after: After = { turnId: 't', state: 'ready', durationMs: 42_000, tools: 12, files: ['a', 'b', 'c', 'd'], added: 120, removed: 30, costUsd: 0.31, edits: 4, know: ['The pin-drop link now writes to the shared staging DB — the 3 test amenities you dropped are real rows.', 'amenity.mapper.ts is used by 14 files in 4 modules; the PR note should say so.'], next: [{ label: 'Run the amenities tests', prompt: 'Run the amenities tests in the frontend worktree' }, { label: 'Open the PRs', prompt: '/ims-end masterplan-amenities' }, { label: 'Fix the overlapping counter bug', prompt: 'Fix IMS-2430: overlapping names hide the counter' }], dismissed: [] }
const rule: Rule = { id: 1, rule: 'Use pnpm instead of npm for package management in this project.', quote: 'no - in this repo we always use pnpm, not npm', confidence: 0.95 }
const edits: Edit[] = [
  { id: 1, turnId: 't', path: '/x/README.md', tool: 'Edit', before: '`greet(name)`', after: '`welcome(name)`', added: 1, removed: 1, at: now },
  { id: 2, turnId: 't', path: '/x/src/greet.js', tool: 'Edit', before: 'export const greet', after: 'export const welcome', added: 1, removed: 1, at: now },
  { id: 3, turnId: 't', path: '/x/src/cli.js', tool: 'Edit', before: 'a\nb', after: 'c\nd', added: 2, removed: 2, at: now },
]

const bar = { focus, env, ticket, github, usage, status: 'working' as const, title: 'Masterplan amenities', progress: { done: 3, total: 5 } }
const generic = { focus: { ...focus, isIms: false, project: 'claude-mods', worktree: null, ticket: null, branches: [{ ...focus.branches[0]!, side: 'repo' as const, branch: 'main', commits: 2, unpushed: 2, remote: 'ezzhassan97/claude-mods' }] }, env: null, ticket: null, github: { ...github, focus: [] }, usage, status: 'idle' as const, title: 'Build the command center mods', progress: null }

const W = 760
const P = 560
const blocks: [string, string][] = [
  ['Bar · IMS session (working)', drawBar(bar, W)],
  ['Bar · narrow', drawBar(bar, 520)],
  ['Bar · any other repo', drawBar(generic, W)],
  ['Card · you should know', drawKnow(after.know, W, false)],
  ['Card · replay', drawReplay(after, ['/x/src/AmenityMap.tsx', '/x/src/usePinCluster.ts', '/x/src/amenity.mapper.ts'], W)],
  ['Card · what\'s next (head)', drawNextHead(W)],
  ...after.next.map((n, i): [string, string] => [`Card · what's next row ${i + 1}`, drawNextRow(n, i, W - 90)]),
  ['Card · reflect', drawRule(rule, W, './CLAUDE.md')],
  ['Panel · overview', drawOverview({ ...bar, agents, startedAt: now - 47 * min, now, others, goal: { title: 'Masterplan amenities enhancements', steps: [{ text: 'Touchpad zoom and wider range', done: true }, { text: 'Amenity names on the masterplan', done: true }, { text: 'Collapsible amenities column', done: false }, { text: 'Test on staging and open the PRs', done: false }], at: now } }, P)],
  ['Panel · agents', drawAgents(agents, P, now)],
  ['Panel · files', drawFiles({ activity: { verb: 'editing', target: touched[0]!.path }, branch: 'IMS-2423-Masterplan-Amenities-Enhancements', changed: 3, touched, root: '/x/ims-nawy/.worktrees' }, P)],
  ['Panel · GitHub (this PR)', drawPr(focusPrs[1]!, P, now)],
  ['Panel · GitHub (approved)', drawPr(focusPrs[0]!, P, now)],
  ['Panel · your other PRs', drawPrList(github.mine, P)],
  ['Panel · Jira', drawJira(ticket, P, now)],
  ['Panel · Vercel', drawDeploys(github.deploys, P, now)],
  ['Replay · timeline', drawTimeline(edits, 0, P, '/x')],
  ...CONTROLS.map((c, i) => [`Controls · ${c.key}`, drawToggle(c.name, c.what, i % 3 !== 1, P)] as [string, string]),
]

const html = `<!doctype html><meta charset="utf-8"><title>Command center preview</title>
<style>body{margin:0;padding:24px;font:13px -apple-system,system-ui,sans-serif;background:#faf9f5;color:#1f1e1d}
@media (prefers-color-scheme:dark){body{background:#1f1e1d;color:#ecebe6}}
h3{font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.55;margin:22px 0 6px}
.f{display:block;width:1000px;border:1px dashed rgba(128,128,128,.35);border-radius:10px;padding:8px}</style>
${blocks.map(([t, s]) => `<h3>${t}</h3><div class="f">${s}</div>`).join('\n')}`
writeFileSync(new URL('./preview.html', import.meta.url), html)
console.log('wrote dev/preview.html')
