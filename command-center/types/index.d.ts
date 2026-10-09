// The command center's state contract: every value its views draw from.
// The hooks module imports these types; `claude plugin validate` holds each
// `$.state` key the module names to this file.

export type Tab = 'now' | 'sessions' | 'prs' | 'files' | 'impact'

export type Status = 'working' | 'waiting' | 'idle' | 'ended'

/** One Claude Code session, as its heartbeat file says (any project). */
export type Beat = {
  id: string
  cwd: string
  project: string
  branch: string | null
  title: string
  task: string | null
  progress: { done: number; total: number } | null
  status: Status
  waitingFor: string | null
  contextPct: number | null
  costUsd: number | null
  agents: number
  startedAt: number
  updatedAt: number
}

export type Usage = {
  contextPct: number | null
  contextTokens: number | null
  window: number | null
  costUsd: number | null
  limits: { kind: string; percent: number; resetsAt: string | null }[]
}

export type Todo = { content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }

export type Agent = {
  id: string
  name: string
  type: string
  description: string
  status: string
  tools: number
  lastTool: string | null
  tokensIn: number
  tokensOut: number
  startedAt: number
  endedAt: number | null
}

export type Repo = {
  root: string
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  dirty: number
  base: string | null
  baseAhead: number
  baseBehind: number
}

/** A file this session touched, and how. */
export type Touch = {
  path: string
  reads: number
  edits: number
  created: boolean
  added: number
  removed: number
  at: number
}

export type GitMark = { path: string; code: string }

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

export type Prs = { items: Pr[]; at: number; isLoading: boolean; error: string | null }

export type ImpactRow = {
  path: string
  dependents: string[]
  modules: string[]
  source: 'edit' | 'branch'
}

export type Suggestion = { label: string; prompt: string }
export type Steps = { kind: 'hidden' } | { kind: 'loading'; turnId: string } | { kind: 'offer'; items: Suggestion[] }


export type Blocked = { at: number; rule: string; command: string; outcome: 'blocked' | 'cancelled' | 'proceeded' }

export type Receipt = { tools: number; edits: number; added: number; removed: number; files: string[]; startedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'command-center': {
      tab: Tab
      usage: Usage | null
      status: Status
      waitingFor: string | null
      todos: Todo[]
      agents: Agent[]
      repo: Repo | null
      touched: Touch[]
      git: GitMark[]
      sessions: Beat[]
      prs: Prs
      openPr: string | null
      impact: ImpactRow[]
      openImpact: string | null
      tree: { mode: 'touched' | 'all'; open: string[] }
      listing: Record<string, { name: string; isDir: boolean }[]>
      steps: Steps
      blocked: Blocked[]
      skin: boolean
    }
  }
}
