import type { Branch, Env, Focus, Side } from '../../types'
import { basename, clean, ticketKey } from '../lib/fmt'
import { pick, sightings, startArgs } from '../lib/focus'
import type { Sighting } from '../lib/focus'
import { envValue, git, isOpen, repoOf } from '../lib/io'
import type { Io } from '../lib/io'
import { me } from './session'

// What this session is on. In ims-nawy: the worktree pair it works in
// (.worktrees/<folder>-{frontend,backend}), read from what the session does,
// or the one the person picked; anywhere else: the git repo it is in. For
// each working copy: its branch, commits on it, how many are unpushed, how
// far its base moved, and uncommitted changes. In ims-nawy also the
// environment: the tunnels, Redis, the copy's ports and which database its
// backend points at (the tunnel port 3308 is the shared staging DB; any other
// port, 3307, the local copy of it).

export const ws = { imsRoot: '' as string, seen: [] as Sighting[], picked: null as string | null }

export const MYSQL_TUNNEL = 3308
export const MONGO_TUNNEL = 27317

/** The ims-nawy folder: the nearest folder up holding the worktree script. */
export async function findImsRoot(io: Io, from: string): Promise<string> {
  let dir = from
  for (let i = 0; i < 8 && dir && dir !== '/'; i++) {
    if (await io.exists(`${dir}/scripts/ims-worktree.sh`)) return dir
    dir = dir.split('/').slice(0, -1).join('/')
  }
  return ''
}

/** Read the session's history once, so a session opened earlier still knows its worktree. */
export async function learnFromHistory(io: Io): Promise<void> {
  const history = await io.messages().catch(() => [])
  for (const m of history) {
    ws.seen.push(...sightings(m.text))
    for (const use of m.toolUses ?? []) ws.seen.push(...sightings(JSON.stringify((use as { input?: unknown }).input ?? '')))
  }
  ws.picked = ((await io.storeGet(`picked:${me.id}`)) as string | undefined) ?? null
}

/** Note what a tool call or a command points at. */
export function notice(text: string): boolean {
  const found = sightings(text)
  ws.seen.push(...found)
  if (ws.seen.length > 400) ws.seen.splice(0, ws.seen.length - 400)
  return found.length > 0
}

export function noticeStart(args: string): void {
  const s = startArgs(args)
  if (s) ws.seen.push(s)
}

export async function pickWorktree(io: Io, folder: string | null): Promise<void> {
  ws.picked = folder
  await io.storeSet(`picked:${me.id}`, folder)
}

async function branchOf(io: Io, root: string, side: Side): Promise<Branch | null> {
  const head = await git(io, root, 'rev-parse', '--abbrev-ref', 'HEAD')
  if (!head.ok) return null
  const branch = head.out === 'HEAD' ? null : head.out
  const remote = repoOf((await git(io, root, 'remote', 'get-url', 'origin')).out)
  const baseRef = (await git(io, root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')).out || 'origin/main'
  const base = baseRef.replace(/^origin\//, '')
  const count = async (...range: string[]): Promise<number> => Number((await git(io, root, 'rev-list', '--count', ...range)).out) || 0
  const onBase = branch === base
  const hasStaging = (await git(io, root, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/staging')).ok
  const [commits, behindBase, hasUpstream, dirty, lastLog, logOut, stagingAhead, isInStaging] = await Promise.all([
    onBase ? Promise.resolve(0) : count(`${baseRef}..HEAD`),
    onBase ? Promise.resolve(0) : count(`HEAD..${baseRef}`),
    git(io, root, 'rev-parse', '--abbrev-ref', '@{u}').then(r => r.ok),
    git(io, root, 'status', '--porcelain').then(r => r.out.split('\n').filter(Boolean).length),
    git(io, root, 'log', '-1', '--format=%s%x09%ct'),
    // on a feature branch: its own commits; on main itself: main's latest
    git(io, root, 'log', '-n', onBase ? '12' : '20', '--format=%h%x09%ct%x09%an%x09%s', ...(onBase ? ['HEAD'] : [`${baseRef}..HEAD`])),
    hasStaging ? count('origin/staging..HEAD') : Promise.resolve(0),
    hasStaging ? git(io, root, 'merge-base', '--is-ancestor', 'HEAD', 'origin/staging').then(r => r.ok) : Promise.resolve(false),
  ])
  const unpushed = hasUpstream ? await count('@{u}..HEAD') : commits
  const [subject = '', ts = '0'] = lastLog.out.split('\t')
  return {
    side,
    root,
    name: basename(root),
    remote,
    branch,
    base,
    commits,
    unpushed,
    behindBase,
    dirty,
    last: subject ? { subject: clean(subject, 120), at: Number(ts) * 1000 } : null,
    log: logOut.out.split('\n').filter(Boolean).map((line, i) => {
      const [sha = '', at = '0', author = '', ...rest] = line.split('\t')
      return { sha, at: Number(at) * 1000, author, subject: clean(rest.join(' '), 120), isPushed: i >= unpushed }
    }),
    staging: hasStaging && !onBase ? { ahead: stagingAhead, isIn: commits > 0 && isInStaging } : null, // a branch with no commits of its own is trivially "in" staging
  }
}

export async function refreshFocus(io: Io): Promise<void> {
  if (ws.imsRoot) {
    const chosen = ws.picked ?? pick(ws.seen)?.folder ?? null
    const branches: Branch[] = []
    if (chosen) {
      for (const side of ['frontend', 'backend'] as const) {
        const root = `${ws.imsRoot}/.worktrees/${chosen}-${side}`
        if (await io.exists(root)) {
          const b = await branchOf(io, root, side)
          if (b) branches.push(b)
        }
      }
    }
    const focus: Focus = {
      project: basename(ws.imsRoot),
      root: ws.imsRoot,
      isIms: true,
      worktree: chosen,
      isPicked: !!ws.picked,
      branches,
      ticket: branches.map(b => ticketKey(b.branch ?? '')).find(Boolean) ?? (chosen ? ticketKey(pick(ws.seen.filter(s => s.folder === chosen))?.branch ?? '') : null),
    }
    await io.s.focus.set(old => (JSON.stringify(old) === JSON.stringify(focus) ? old : focus))
    const names = (await io.list(`${ws.imsRoot}/.worktrees`).catch(() => []))
      .filter(e => e.kind === 'dir' && /-(frontend|backend)$/.test(e.name) && !e.name.startsWith('uat-'))
      .map(e => e.name.replace(/-(frontend|backend)$/, ''))
    await io.s.worktrees.set(() => [...new Set(names)].sort())
    return
  }
  // The session's folder, else the repo of the file it touched last, else a repo just inside it.
  let top = await git(io, me.root, 'rev-parse', '--show-toplevel')
  if (!top.ok) {
    const recent = (await io.s.touched.get())[0]?.path
    if (recent) top = await git(io, recent.split('/').slice(0, -1).join('/'), 'rev-parse', '--show-toplevel')
  }
  if (!top.ok) {
    for (const entry of await io.list(me.root).catch(() => [])) {
      if (entry.kind !== 'dir' || entry.name.startsWith('.') || !(await io.exists(`${me.root}/${entry.name}/.git`))) continue
      top = await git(io, `${me.root}/${entry.name}`, 'rev-parse', '--show-toplevel')
      if (top.ok) break
    }
  }
  const branch = top.ok ? await branchOf(io, top.out, 'repo') : null
  const focus: Focus = {
    project: basename(me.root),
    root: top.ok ? top.out : me.root,
    isIms: false,
    worktree: null,
    isPicked: false,
    branches: branch ? [branch] : [],
    ticket: ticketKey(branch?.branch ?? ''),
  }
  await io.s.focus.set(old => (JSON.stringify(old) === JSON.stringify(focus) ? old : focus))
}

export async function refreshEnv(io: Io): Promise<void> {
  if (!ws.imsRoot) return
  const focus = await io.s.focus.get()
  const fe = focus?.branches.find(b => b.side === 'frontend')
  const be = focus?.branches.find(b => b.side === 'backend')
  const [feEnv, beEnv] = await Promise.all([fe ? io.read(`${fe.root}/.env`).catch(() => '') : '', be ? io.read(`${be.root}/.env`).catch(() => '') : ''])
  const fePort = Number(/localhost:(\d+)/.exec(envValue(feEnv, 'VITE_APP_COGNITO_REDIRECT_URI') ?? '')?.[1] ?? NaN)
  const bePort = Number(envValue(beEnv, 'SERVER_PORT') ?? NaN)
  const dbPort = Number(envValue(beEnv, 'DB_PORT') ?? NaN)
  // a copy on the local MySQL (scripts/ims-worktree.sh db <folder> local) needs that server, not the tunnel
  const [mysql, mongo, redis, feUp, beUp] = await Promise.all([
    isOpen(io, Number.isFinite(dbPort) && dbPort !== MYSQL_TUNNEL ? dbPort : MYSQL_TUNNEL),
    isOpen(io, MONGO_TUNNEL),
    io.run(['redis-cli', 'ping'], { timeoutMs: 3000 }).then(r => r.ok && r.out === 'PONG'),
    Number.isFinite(fePort) ? isOpen(io, fePort) : Promise.resolve(false),
    Number.isFinite(bePort) ? isOpen(io, bePort) : Promise.resolve(false),
  ])
  const env: Env = {
    mysql,
    mongo,
    redis,
    dbPort: Number.isFinite(dbPort) ? dbPort : null,
    dbMode: Number.isFinite(dbPort) ? (dbPort === MYSQL_TUNNEL ? 'staging' : 'local') : null,
    fe: Number.isFinite(fePort) ? { port: fePort, up: feUp } : null,
    be: Number.isFinite(bePort) ? { port: bePort, up: beUp } : null,
    checkedAt: await io.now(),
  }
  await io.s.env.set(old => (old && JSON.stringify({ ...old, checkedAt: 0 }) === JSON.stringify({ ...env, checkedAt: 0 }) ? old : env))
}

/** Restart the tunnels with the repo's own script, then re-check. */
export async function fixTunnels(io: Io): Promise<void> {
  io.toast('Restarting the IMS tunnels…')
  const r = await io.run(['bash', `${ws.imsRoot}/scripts/ims-worktree.sh`, 'tunnels'], { cwd: ws.imsRoot, timeoutMs: 60_000 })
  io.toast(r.ok ? clean(r.out.split('\n').filter(Boolean).join(' · '), 160) || 'Tunnels restarted' : `Tunnels: ${clean(r.err || r.out, 160)}`, 8000)
  await refreshEnv(io)
}
