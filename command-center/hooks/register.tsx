/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { guardCheck } from './features/guard'
import { impactAfterTool } from './features/impact'
import { afterTool, beforeTool, onEnd, onMeasure, onNotification, onPrompt, onStart, onTurnComplete, onTurnStart } from './features/live'
import { stepsOnTurnComplete, stepsOnTurnStart } from './features/next'
import { prsOnStart } from './features/prs'
import { receiptDecorate, receiptOnTurnStart } from './features/receipt'
import { skinRow } from './features/skin'
import { report, STANDUP } from './features/standup'
import { config, configure } from './lib/config'
import type { Cells, Io } from './lib/io'
import { bandView } from './views/band'
import { CC, ccCommand, openPane, paneView } from './views/pane'

// Command Center: a development cockpit inside Claude Code, for any project.
// This file is the only one that touches `$` (the engine follows `$` within
// the file that receives it): it builds `io` for the features and views, and
// hooks each event once, handing it to the features that care.

// Session state: every value a view draws from, one atom per key of the
// contract in ../types (the engine reads these literally, so they live here).
const tabA = atom({ plugin: 'command-center', key: 'tab' } as const, 'now')
const usageA = atom({ plugin: 'command-center', key: 'usage' } as const, null)
const statusA = atom({ plugin: 'command-center', key: 'status' } as const, 'idle')
const waitingForA = atom({ plugin: 'command-center', key: 'waitingFor' } as const, null)
const todosA = atom({ plugin: 'command-center', key: 'todos' } as const, [])
const agentsA = atom({ plugin: 'command-center', key: 'agents' } as const, [])
const repoA = atom({ plugin: 'command-center', key: 'repo' } as const, null)
const touchedA = atom({ plugin: 'command-center', key: 'touched' } as const, [])
const gitA = atom({ plugin: 'command-center', key: 'git' } as const, [])
const sessionsA = atom({ plugin: 'command-center', key: 'sessions' } as const, [])
const prsA = atom({ plugin: 'command-center', key: 'prs' } as const, { items: [], at: 0, isLoading: false, error: null })
const openPrA = atom({ plugin: 'command-center', key: 'openPr' } as const, null)
const impactA = atom({ plugin: 'command-center', key: 'impact' } as const, [])
const openImpactA = atom({ plugin: 'command-center', key: 'openImpact' } as const, null)
const treeA = atom({ plugin: 'command-center', key: 'tree' } as const, { mode: 'touched', open: [] })
const listingA = atom({ plugin: 'command-center', key: 'listing' } as const, {})
const stepsA = atom({ plugin: 'command-center', key: 'steps' } as const, { kind: 'hidden' })
const blockedA = atom({ plugin: 'command-center', key: 'blocked' } as const, [])
const skinA = atom({ plugin: 'command-center', key: 'skin' } as const, true)

function cells($: EngineInterface): Cells {
  return {
    tab: { get: () => read($, tabA), set: async change => void (await update($, tabA, change)) },
    usage: { get: () => read($, usageA), set: async change => void (await update($, usageA, change)) },
    status: { get: () => read($, statusA), set: async change => void (await update($, statusA, change)) },
    waitingFor: { get: () => read($, waitingForA), set: async change => void (await update($, waitingForA, change)) },
    todos: { get: () => read($, todosA), set: async change => void (await update($, todosA, change)) },
    agents: { get: () => read($, agentsA), set: async change => void (await update($, agentsA, change)) },
    repo: { get: () => read($, repoA), set: async change => void (await update($, repoA, change)) },
    touched: { get: () => read($, touchedA), set: async change => void (await update($, touchedA, change)) },
    git: { get: () => read($, gitA), set: async change => void (await update($, gitA, change)) },
    sessions: { get: () => read($, sessionsA), set: async change => void (await update($, sessionsA, change)) },
    prs: { get: () => read($, prsA), set: async change => void (await update($, prsA, change)) },
    openPr: { get: () => read($, openPrA), set: async change => void (await update($, openPrA, change)) },
    impact: { get: () => read($, impactA), set: async change => void (await update($, impactA, change)) },
    openImpact: { get: () => read($, openImpactA), set: async change => void (await update($, openImpactA, change)) },
    tree: { get: () => read($, treeA), set: async change => void (await update($, treeA, change)) },
    listing: { get: () => read($, listingA), set: async change => void (await update($, listingA, change)) },
    steps: { get: () => read($, stepsA), set: async change => void (await update($, stepsA, change)) },
    blocked: { get: () => read($, blockedA), set: async change => void (await update($, blockedA, change)) },
    skin: { get: () => read($, skinA), set: async change => void (await update($, skinA, change)) },
  }
}

// The desktop app's process may not carry Homebrew's PATH, so known tools are
// looked up at their usual homes. ponytail: fixed list; extend if a tool lives elsewhere.
const HOMES = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin']
const bins = new Map<string, string>()

function makeIo($: EngineInterface): Io {
  const bin = async (name: string): Promise<string> => {
    const known = bins.get(name)
    if (known) return known
    for (const home of HOMES) {
      if (await $.fs.exists(`${home}/${name}`).catch(() => false)) {
        bins.set(name, `${home}/${name}`)
        return `${home}/${name}`
      }
    }
    bins.set(name, name)
    return name
  }
  return {
    run: async (argv, init = {}) => {
      try {
        const [head = '', ...rest] = argv
        const r = await $.process.run([await bin(head), ...rest], { timeoutMs: 20_000, ...init })
        return { ok: r.exitCode === 0, out: r.stdout.trim(), err: r.stderr.trim(), code: r.exitCode }
      } catch (error) {
        return { ok: false, out: '', err: String(error), code: -1 }
      }
    },
    exists: path => $.fs.exists(path).catch(() => false),
    read: path => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    list: path => $.fs.list(path),
    now: () => $.clock.now(),
    every: (ms, fn) => void $.clock.every(ms, fn),
    home: async () => (await $.env.get('HOME')) ?? '',
    s: cells($),
    storeGet: key => $.store.get(key),
    storeSet: (key, value) => $.store.set(key, value),
    toast: (text, ms) => $.ui.toast(text, ms ? { timeoutMs: ms } : undefined),
    debug: text => $.ui.log(text, { to: 'debug' }),
    ask: (question, options, header) => $.ui.ask(question, { options, header }),
    copy: async (text, surface) => (await $.ui.copy({ text, surface }).catch(() => null))?.isCopied === true,
    chime: () => void $.audio.play({ asset: 'assets/chime.wav' }).catch(() => undefined),
    usage: () => $.session.usage().catch(() => null),
    agents: () => $.agent.list().catch(() => null),
    commands: () => $.command.list().catch(() => null),
    fork: prompt => $.model.fork({ prompt }).catch(() => null),
    suggest: text => void $.prompt.suggest({ text }).catch(() => undefined),
    fill: async text => (await $.prompt.fill({ text }).catch(() => null))?.isFilled === true,
    openPane: async (id, title, columns) => void (await $.ui.open({ id, title, columns })),
    session: async () => {
      const cwd = await $.session.cwd()
      return { id: await $.session.id(), cwd, root: await $.session.root().catch(() => cwd) }
    },
  }
}

export const register: Register = (on, options) => {
  configure(options)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const io = makeIo($)
    await $.command.register(CC)
    await $.command.register(STANDUP)
    await onStart(io)
    await prsOnStart(io)
    if (config.isAutoOpen && e.isInteractive) void openPane(io)
    return result
  })

  on('session.end', async ($, e, next) => {
    await onEnd(makeIo($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await onMeasure(makeIo($), e)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    onPrompt(e.text)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const io = makeIo($)
    await Promise.all([onTurnStart(io), stepsOnTurnStart(io), receiptOnTurnStart(io)])
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const io = makeIo($)
    await onTurnComplete(io, e.agentId, e.usage)
    await stepsOnTurnComplete(io, e)
    return receiptDecorate(io, e, result)
  })

  on('classic.Notification', async ($, e, next) => {
    await onNotification(makeIo($), e.notification_type, e.message)
    return next(e)
  })

  // Guard first: a risky Bash command waits here for the user's answer.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => (await guardCheck(makeIo($), String(e.command ?? ''))) ?? next(e)).catch(($, e, next) =>
    next.called ? next(e) : { deny: 'Command Center guard failed while checking this command, so it did not run. Tell the user.' },
  )

  on('tool.call', async ($, e, next) => {
    const io = makeIo($)
    await beforeTool(io, e)
    const ran = await next(e)
    await afterTool(io, e, ran)
    impactAfterTool(io, e, ran)
    return ran
  })

  on('command.run', { command: 'cc' }, async ($, e) => ({ text: await ccCommand(makeIo($), e.args) }))

  on('command.run', { command: 'standup' }, async ($, e) => {
    const days = Math.max(1, Math.min(30, Number(e.args.trim()) || 1))
    return { text: await report(makeIo($), days, config.workspace) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (!config.isBand || e.props.hasSurvey) return below
    const io = makeIo($)
    return bandView(io, $.ui.resolve(e), e.props, below, () => void openPane(io))
  })

  on('ui.render', { component: 'Pane', requestId: 'command-center' }, async ($, e) => paneView(makeIo($), $.ui.resolve(e), e.props.bodyColumns))

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const row = await next(e)
    if (e.surface !== 'desktop' || !config.isSkin || !(await read($, skinA))) return row
    return skinRow($.ui.resolve(e), e.props, row)
  })
}
