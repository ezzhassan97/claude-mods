import type { Io } from '../lib/io'
import { refreshTicket } from './jira'
import { refreshFocusPrs } from './prs'
import { beat } from './session'
import { refreshEnv, refreshFocus } from './workspace'

// Everything about "what this session is on", in dependency order: the focus
// (worktree, branches) first, then what hangs off it.

let isRunning = false

export async function refreshAll(io: Io): Promise<void> {
  if (isRunning) return
  isRunning = true
  try {
    const before = (await io.s.focus.get())?.ticket ?? null
    await refreshFocus(io)
    const focus = await io.s.focus.get()
    await refreshEnv(io)
    if (focus?.ticket !== before || !(await io.s.ticket.get())) await refreshTicket(io)
    await refreshFocusPrs(io)
    await beat(io, { project: focus?.project, branch: focus?.branches[0]?.branch ?? null, ticket: focus?.ticket ?? null })
  } finally {
    isRunning = false
  }
}
