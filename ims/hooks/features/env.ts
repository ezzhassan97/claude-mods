import type { Env, Worktree } from '../../types'
import { config } from '../lib/config'
import { clean, ticketKey } from '../lib/fmt'
import { envValue, git, isOpen } from '../lib/io'
import type { Io } from '../lib/io'

// The IMS environment: the staging MySQL and testing Mongo tunnels, local
// Redis (which holds the cron locks), and every worktree pair — its branch,
// ports, whether each app is running, and which MySQL its backend points at.
// A backend on the tunnel port is on the shared STAGING database; any other
// port is a local one. From .env files only the port keys are ever read.

export const ims = { root: '' }

/** The ims-nawy folder: the nearest folder up from `from` holding the worktree script. */
export async function findRoot(io: Io, from: string): Promise<string | null> {
  let dir = from
  for (let i = 0; i < 8 && dir && dir !== '/'; i++) {
    if (await io.exists(`${dir}/scripts/ims-worktree.sh`)) return dir
    dir = dir.split('/').slice(0, -1).join('/')
  }
  return null
}

async function worktree(io: Io, folder: string): Promise<Worktree> {
  const fe = `${ims.root}/.worktrees/${folder}-frontend`
  const be = `${ims.root}/.worktrees/${folder}-backend`
  const [feEnv, beEnv] = await Promise.all([io.read(`${fe}/.env`).catch(() => ''), io.read(`${be}/.env`).catch(() => '')])
  const fePort = Number(/localhost:(\d+)/.exec(envValue(feEnv, 'VITE_APP_COGNITO_REDIRECT_URI') ?? '')?.[1] ?? NaN)
  const bePort = Number(envValue(beEnv, 'SERVER_PORT') ?? NaN)
  const dbPort = Number(envValue(beEnv, 'DB_PORT') ?? NaN)
  const branch = (await git(io, be, 'branch', '--show-current')).out || (await git(io, fe, 'branch', '--show-current')).out || null
  const [feDirty, beDirty, feUp, beUp] = await Promise.all([
    git(io, fe, 'status', '--porcelain').then(r => r.out.split('\n').filter(Boolean).length),
    git(io, be, 'status', '--porcelain').then(r => r.out.split('\n').filter(Boolean).length),
    Number.isFinite(fePort) ? isOpen(io, fePort) : Promise.resolve(false),
    Number.isFinite(bePort) ? isOpen(io, bePort) : Promise.resolve(false),
  ])
  return {
    folder,
    isUat: folder.startsWith('uat-'),
    branch: branch ? clean(branch, 80) : null,
    ticket: ticketKey(branch ?? '') ?? (/^uat-(\d+)/.exec(folder) ? `${config.jiraProject}-${/^uat-(\d+)/.exec(folder)![1]}` : null),
    fePort: Number.isFinite(fePort) ? fePort : null,
    bePort: Number.isFinite(bePort) ? bePort : null,
    feUp,
    beUp,
    dbPort: Number.isFinite(dbPort) ? dbPort : null,
    dirty: feDirty + beDirty,
  }
}

export async function refreshEnv(io: Io): Promise<void> {
  if (!ims.root) return
  const names = await io.dirs(`${ims.root}/.worktrees`).catch(() => [])
  const folders = [...new Set(names.filter(n => /-(frontend|backend)$/.test(n)).map(n => n.replace(/-(frontend|backend)$/, '')))].sort()
  const [mysql, mongo, redis, trees] = await Promise.all([
    isOpen(io, config.mysqlTunnel),
    isOpen(io, config.mongoTunnel),
    io.run(['redis-cli', 'ping'], { timeoutMs: 3000 }).then(r => r.ok && r.out === 'PONG'),
    Promise.all(folders.map(f => worktree(io, f))),
  ])
  const running = trees.filter(t => t.beUp && t.dbPort != null)
  const onStaging = running.filter(t => t.dbPort === config.mysqlTunnel).length
  const dbMode: Env['dbMode'] = running.length === 0 ? 'none' : onStaging === running.length ? 'staging' : onStaging === 0 ? 'local' : 'mixed'
  const env: Env = { mysql: { up: mysql, port: config.mysqlTunnel }, mongo: { up: mongo, port: config.mongoTunnel }, redis, dbMode, checkedAt: await io.now() }
  await io.s.env.set(() => env)
  await io.s.worktrees.set(old => (JSON.stringify(old) === JSON.stringify(trees) ? old : trees))
}

/** Restart the tunnels with the repo's own script, then re-check. */
export async function fixTunnels(io: Io): Promise<void> {
  io.toast('Restarting the IMS tunnels…')
  const r = await io.run(['bash', `${ims.root}/scripts/ims-worktree.sh`, 'tunnels'], { cwd: ims.root, timeoutMs: 60_000 })
  io.toast(r.ok ? clean(r.out.split('\n').filter(Boolean).join(' · '), 160) || 'Tunnels restarted' : `Tunnels: ${clean(r.err || r.out, 160)}`, 8000)
  await refreshEnv(io)
}

/** True when a schema change from here would land on the shared staging DB. */
export async function isStagingDb(io: Io): Promise<boolean> {
  const env = await io.s.env.get()
  return !env || env.dbMode !== 'local'
}
