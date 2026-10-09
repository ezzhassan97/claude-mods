// The command center's state contract: every value its views draw from.
// The hooks module imports these types; `claude plugin validate` holds each
// `$.state` key the module names to this file.

export type Status = 'working' | 'waiting' | 'idle' | 'ended'

export type Usage = {
  contextPct: number | null
  contextTokens: number | null
  window: number | null
  costUsd: number | null
  limits: { kind: string; percent: number; resetsAt: string | null }[]
}

export type Agent = {
  id: string
  name: string
  type: string
  model: string | null
  description: string
  status: string
  tools: number
  lastTool: string | null
  tokens: number
  contextTokens: number
  costUsd: number
  startedAt: number
  endedAt: number | null
}

/** A file this session touched, and how. */
export type Touch = { path: string; reads: number; edits: number; created: boolean; added: number; removed: number; at: number; dependents: number | null }

/** One edit, kept for Replay. */
export type Edit = { id: number; turnId: string; path: string; tool: string; before: string; after: string; added: number; removed: number; at: number }

/** What Claude is doing right now (the Files section's first card). */
export type Activity = { verb: 'reading' | 'editing' | 'writing' | 'running' | 'searching' | 'thinking'; target: string; at: number } | null

export type Side = 'frontend' | 'backend' | 'repo'

/** One working copy this session works in, and its branch. */
export type Branch = {
  side: Side
  root: string
  name: string
  remote: string | null
  branch: string | null
  base: string | null
  commits: number
  unpushed: number
  behindBase: number
  dirty: number
  last: { subject: string; at: number } | null
}

/** What this session is on. */
export type Focus = {
  project: string
  root: string
  isIms: boolean
  worktree: string | null
  isPicked: boolean
  branches: Branch[]
  ticket: string | null
}

export type Env = {
  mysql: boolean
  mongo: boolean
  redis: boolean
  dbPort: number | null
  dbMode: 'staging' | 'local' | null
  fe: { port: number; up: boolean } | null
  be: { port: number; up: boolean } | null
  checkedAt: number
}

export type CheckState = 'pass' | 'fail' | 'pending' | 'none'

export type Pr = {
  url: string
  repo: string
  number: number
  title: string
  account: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  base: string
  head: string
  ticket: string | null
  review: string | null
  reviewers: string[]
  mergeable: string | null
  checks: CheckState
  comments: number
  newComments: number
  lastComment: { author: string; text: string; at: string } | null
  othersCommits: { author: string; count: number }[]
  vsBase: { ahead: number; behind: number } | null
  vsMain: { behind: number; forkedAt: string | null } | null
  mergedAt: string | null
  mergedBy: string | null
  deploy: { status: string; conclusion: string | null; workflow: string; url: string } | null
  conflictFiles: string[] | null
  additions: number
  deletions: number
  changedFiles: number
  updatedAt: string
}

export type Deploy = { repo: string; ref: string; environment: string; state: string; url: string | null; at: string }

export type Github = { focus: Pr[]; mine: Pr[]; deploys: Deploy[]; at: number; isLoading: boolean; error: string | null }

export type Sub = { key: string; summary: string; status: string; isDone: boolean; kind: 'bug' | 'review' | 'testing' | 'task' }

export type Requirement = { id: number; text: string; state: 'open' | 'done' | 'tested' | 'waived' }

export type Ticket = {
  key: string
  summary: string
  status: string
  category: string
  type: string
  url: string
  subs: Sub[]
  comments: { author: string; text: string; at: string }[]
  requirements: Requirement[]
  at: number
  error: string | null
}

export type Suggestion = { label: string; prompt: string }

/** The card after a finished turn: the receipt, what you should know, next actions, replay. */
export type After = {
  turnId: string
  state: 'loading' | 'ready' | 'hidden'
  durationMs: number
  tools: number
  files: string[]
  added: number
  removed: number
  costUsd: number | null
  edits: number
  know: string[]
  next: Suggestion[]
  /** Cards of this turn the person closed. */
  dismissed: ('know' | 'next' | 'replay')[]
}

/** This session's goal and its steps, kept up to date after each task. */
export type Goal = { title: string; steps: { text: string; done: boolean }[]; at: number }

export type Rule = { id: number; rule: string; quote: string; confidence: number }

export type Held = { command: string; title: string; summary: string; lines: { name: string; detail: string }[]; note: string | null; decision: 'run' | 'cancel' | null }

/** `builtinKnow` is Anthropic's built-in mod (cc-plugin-you-should-know), the rest are this mod's. */
export type Toggles = { next: boolean; know: boolean; builtinKnow: boolean; replay: boolean; reflect: boolean; guard: boolean }

export type Panel = { tab: string; replay: number | null; showAllPrs: boolean; isPicking: boolean }

/** One Claude Code session, as its heartbeat file says (any project). */
export type Beat = {
  id: string
  project: string
  branch: string | null
  ticket: string | null
  title: string
  status: Status
  waitingFor: string | null
  contextPct: number | null
  costUsd: number | null
  agents: number
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'command-center': {
      usage: Usage | null
      status: Status
      waitingFor: string | null
      agents: Agent[]
      touched: Touch[]
      edits: Edit[]
      activity: Activity
      focus: Focus | null
      worktrees: string[]
      env: Env | null
      github: Github
      ticket: Ticket | null
      sessions: Beat[]
      after: After | null
      goal: Goal | null
      rules: Rule[]
      held: Held | null
      toggles: Toggles
      panel: Panel
    }
  }
}
