// What this session is working on, read from what it does: the worktree
// folder (ims-nawy's `.worktrees/<folder>-{frontend,backend}`, or any git
// worktree), from `/ims-start <folder> <branch>`, the worktree script, and
// the paths its tools touch. Pure functions over text; no I/O.

export type Sighting = { folder: string; branch: string | null; weight: number }

const WT = /\.worktrees\/([a-z0-9][a-z0-9-]*?)-(?:frontend|backend)(?:\/|\b)/gi
const START = /ims-worktree\.sh\s+start\s+([a-z0-9][a-z0-9-]*)\s+(\S+)/i

/** Folders a piece of text points at: an explicit start beats a path that only passes by. */
export function sightings(text: string): Sighting[] {
  const out: Sighting[] = []
  const start = START.exec(text)
  if (start?.[1]) out.push({ folder: start[1], branch: start[2] ?? null, weight: 10 })
  for (const m of text.matchAll(WT)) if (m[1] && !m[1].startsWith('uat-')) out.push({ folder: m[1], branch: null, weight: 1 })
  return out
}

/** `/ims-start <folder> <branch>` arguments. */
export function startArgs(args: string): Sighting | null {
  const [folder, branch] = args.trim().split(/\s+/)
  return folder && /^[a-z0-9][a-z0-9-]*$/i.test(folder) ? { folder, branch: branch ?? null, weight: 10 } : null
}

/**
 * The folder the session is on now: the heaviest among its last 40 sightings.
 * Sessions get reused for several pieces of work, so the whole history would
 * name the folder it spent longest in, not the one it is in (checked against
 * real ims-nawy transcripts). A pick the person makes overrides this.
 */
export function pick(all: Sighting[]): Sighting | null {
  const score = new Map<string, Sighting>()
  for (const s of all.slice(-40)) {
    const prior = score.get(s.folder)
    score.set(s.folder, { folder: s.folder, branch: s.branch ?? prior?.branch ?? null, weight: (prior?.weight ?? 0) + s.weight })
  }
  return [...score.values()].sort((a, b) => b.weight - a.weight)[0] ?? null
}
