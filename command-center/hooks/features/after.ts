import type { TurnCompleteInput } from 'claude-code'

import type { After, Suggestion, Toggles } from '../../types'
import { clean } from '../lib/fmt'
import type { Io } from '../lib/io'
import { me, turn } from './session'

// After Claude finishes something: one card with the receipt (time, tools,
// lines changed, cost), what you should know (risks, assumptions, side
// effects, anything left for you to decide) and up to three next actions.
// Both come from ONE fork of the session: it shares the prompt cache, so it
// costs about one short reply, and it is skipped when both are switched off.
// Next actions use the technique of Anthropic's next-steps mod.

const MIN_ANSWER = 80

function ask(wantKnow: boolean, wantNext: boolean, skills: string): string {
  return (
    'Do not continue the task. Look back at the turn you just finished and answer with ONLY a JSON object, no prose, no code fence:\n' +
    '{"goal": {...}, "know": [...], "next": [{"label": "...", "prompt": "..."}]}\n\n' +
    '"goal": the overall goal of this whole session as {"title": "<at most 8 words>", "steps": [{"text": "<at most 60 characters>", "done": true|false}]}: ' +
    '3 to 7 steps that cover the whole goal from the start, done = finished so far. Keep earlier steps stable; add or tick, do not rename.\n' +
    (wantKnow
      ? '"know": at most 3 short plain-language sentences (no code, no jargon) about what the user should know and could easily miss: ' +
        'a risk or side effect (shared data or databases touched, money spent, something deleted or published), an assumption you made, ' +
        'something left unfinished, or a decision that is theirs. Write for a product manager. Empty when nothing matters.\n'
      : '"know": always [].\n') +
    (wantNext
      ? '"next": up to 3 concrete prompts the user is most likely to send next, in their voice (name the file, test, PR or ticket). ' +
        'Prefer the obvious next action. "label" at most 44 characters. A slash command from the list below may be used as "/name args"; never invent one.\n' +
        (skills ? `<available-commands>\n${skills}\n</available-commands>\n` : '')
      : '"next": always [].\n')
  )
}

function parse(reply: string, known: ReadonlySet<string> | null): { know: string[]; next: Suggestion[]; goal: { title: string; steps: { text: string; done: boolean }[] } | null } {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  let raw: { know?: unknown; next?: unknown; goal?: { title?: unknown; steps?: unknown } } = {}
  try {
    raw = JSON.parse(reply.slice(start, end + 1)) as typeof raw
  } catch {
    return { know: [], next: [], goal: null }
  }
  const steps = (Array.isArray(raw.goal?.steps) ? (raw.goal!.steps as { text?: unknown; done?: unknown }[]) : [])
    .filter(x => typeof x?.text === 'string')
    .map(x => ({ text: clean(String(x.text), 70), done: x.done === true }))
    .slice(0, 8)
  const goal = typeof raw.goal?.title === 'string' && steps.length ? { title: clean(raw.goal.title, 60), steps } : null
  const know = (Array.isArray(raw.know) ? raw.know : []).filter((k): k is string => typeof k === 'string').map(k => clean(k, 240)).filter(Boolean).slice(0, 3)
  const next: Suggestion[] = []
  for (const n of Array.isArray(raw.next) ? (raw.next as { label?: unknown; prompt?: unknown }[]) : []) {
    if (typeof n?.prompt !== 'string') continue
    const prompt = clean(n.prompt, 600)
    if (!prompt || (prompt.startsWith('/') && known && !known.has(prompt.slice(1).split(' ', 1)[0] ?? ''))) continue
    next.push({ label: typeof n.label === 'string' && n.label ? clean(n.label, 44) : clean(prompt, 44), prompt })
    if (next.length === 3) break
  }
  return { know, next, goal }
}

export async function turnFinished(io: Io, e: TurnCompleteInput, toggles: Toggles): Promise<void> {
  if (e.agentId || e.reason !== 'answer') return
  const edits = (await io.s.edits.get()).filter(x => x.turnId === turn.id).length
  const didWork = turn.tools > 0 || e.durationMs > 20_000
  if (!didWork && e.answer.trim().length < MIN_ANSWER) return
  const cost = (await io.usage())?.cost?.usd ?? null
  const wantKnow = toggles.know && didWork
  const wantNext = toggles.next && e.answer.trim().length >= MIN_ANSWER
  const card: After = {
    turnId: e.turnId,
    state: wantKnow || wantNext ? 'loading' : 'ready',
    durationMs: e.durationMs,
    tools: turn.tools,
    files: [...turn.files],
    added: turn.added,
    removed: turn.removed,
    costUsd: cost != null && turn.costAtStart != null && cost > turn.costAtStart ? cost - turn.costAtStart : null,
    edits,
    know: [],
    next: [],
    dismissed: [],
  }
  await io.s.after.set(() => card)
  if (!wantKnow && !wantNext && !didWork) return
  void (async () => {
    let found: ReturnType<typeof parse> = { know: [], next: [], goal: null }
    try {
      const commands = wantNext ? await io.commands() : null
      const known = commands ? new Set(commands.map(c => c.name)) : null
      const skills = (commands ?? []).filter(c => c.source !== 'builtin').slice(0, 60).map(c => `/${clean(c.name, 64)}: ${clean(c.description, 100)}`).join('\n')
      const reply = await io.fork(ask(wantKnow, wantNext, skills))
      if (reply?.isAnswered) found = parse(reply.text, known)
    } catch (error) {
      io.debug(`after: ${String(error)}`)
    }
    if (found.goal) {
      const goal = { ...found.goal, at: await io.now() }
      await io.s.goal.set(() => goal)
      await io.storeSet(`goal:${me.id}`, goal)
    }
    await io.s.after.set(a => (a && a.turnId === card.turnId ? { ...a, state: 'ready', know: wantKnow ? found.know : [], next: wantNext ? found.next : [] } : a))
    if (found.next[0]) io.suggest(found.next[0].prompt)
  })()
}

export async function takeNext(io: Io, s: Suggestion): Promise<void> {
  await io.s.after.set(a => (a ? { ...a, dismissed: [...a.dismissed, 'next' as const] } : a))
  if (!(await io.fill(s.prompt))) io.toast('Could not put that in the prompt box')
}
