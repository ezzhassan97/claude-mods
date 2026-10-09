// The IMS pack's state contract: every value its views draw from.

export type ImsTab = 'stories' | 'worktrees' | 'checklist' | 'uat'

export type Link = { up: boolean; port: number }

/** One worktree pair under .worktrees/<folder>-{frontend,backend}. */
export type Worktree = {
  folder: string
  isUat: boolean
  branch: string | null
  ticket: string | null
  fePort: number | null
  bePort: number | null
  feUp: boolean
  beUp: boolean
  dbPort: number | null
  dirty: number
}

export type Env = {
  mysql: Link
  mongo: Link
  redis: boolean
  dbMode: 'staging' | 'local' | 'mixed' | 'none'
  checkedAt: number
}

export type Sub = { key: string; summary: string; status: string; isDone: boolean; kind: 'bug' | 'review' | 'testing' | 'task' }

export type PrRef = { repo: 'frontend' | 'backend'; number: number; url: string; state: string; isDraft: boolean; review: string | null; base: string; mergedAt: string | null }

export type Story = {
  key: string
  summary: string
  status: string
  category: string
  type: string
  url: string
  updated: string
  subs: Sub[]
  lastComment: { author: string; text: string; at: string } | null
  comments: number
  prs: PrRef[]
  worktree: string | null
}

export type Stories = { items: Story[]; at: number; isLoading: boolean; error: string | null }

export type Requirement = { id: number; text: string; state: 'open' | 'done' | 'tested' | 'waived'; note: string | null }

export type Checklist = { key: string; summary: string; items: Requirement[] }

export type UatResult = { key: string; requirement: string; result: 'pass' | 'fail' | 'blocked'; note: string | null; bug: string | null; at: number }

declare module 'claude-code' {
  interface PluginState {
    ims: {
      tab: ImsTab
      env: Env | null
      worktrees: Worktree[]
      stories: Stories
      openStory: string | null
      checklist: Checklist | null
      uat: UatResult[]
      loaded: string[]
    }
  }
}
