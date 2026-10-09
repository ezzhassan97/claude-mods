import type { Rule } from '../../types'
import { clean } from '../lib/fmt'
import { json } from '../lib/io'
import type { Io } from '../lib/io'

// Reflect: when you correct Claude ("no — we always use pnpm here"), a small
// model reads that one message and, when it states a lasting rule, offers it
// as "Save this as a rule?": for this project (its CLAUDE.md) or for all
// projects (~/.claude/CLAUDE.md). Nothing is written until you press Save.
// Technique after claude-reflect: a cheap text check first, the model only
// for messages that look like corrections, off the prompt's path.

const SIGNAL = /\b(no|nope|don'?t|do not|never|always|stop|instead|actually|wrong|not like that|we (always|never|use|don'?t)|should(n'?t)? (be|use)|use \w+ not|prefer)\b/i
const SYSTEM =
  "You read one message a user sent to an AI coding assistant and decide whether it states a lasting rule or preference for future work " +
  "(a convention, a tool to use or avoid, a style, a process), not a one-off instruction for the current task. " +
  'Answer with ONLY JSON: {"rule": "<one imperative sentence, self-contained>", "confidence": <0..1>} or {"rule": null}.'

let next = 1

/** Cheap check on the way in; the model runs later, never on the prompt's path. */
export const looksLikeCorrection = (text: string): boolean => text.length >= 8 && text.length <= 600 && !text.startsWith('/') && SIGNAL.test(text)

export async function reflect(io: Io, text: string): Promise<void> {
  const r = await io.complete(SYSTEM, `The user's message:\n"""${text.slice(0, 600)}"""`)
  if (!r?.isAnswered) return
  const found = json<{ rule?: string | null; confidence?: number }>(r.text.slice(Math.max(0, r.text.indexOf('{')), r.text.lastIndexOf('}') + 1))
  if (!found?.rule || (found.confidence ?? 0) < 0.7) return
  const rule: Rule = { id: next++, rule: clean(found.rule, 240), quote: clean(text, 160), confidence: Math.min(1, found.confidence ?? 0.7) }
  await io.s.rules.set(list => [...list.filter(x => x.rule !== rule.rule), rule].slice(-3))
}

/** Append the rule under a "Learned rules" heading, creating it when missing. */
export async function saveRule(io: Io, rule: Rule, file: string, label: string): Promise<void> {
  const text = await io.read(file).catch(() => '')
  const line = `- ${rule.rule}`
  if (text.includes(line)) {
    io.toast('That rule is already saved')
  } else {
    const heading = '## Learned rules'
    const body = text.includes(heading) ? text.replace(heading, `${heading}\n${line}`) : `${text.replace(/\s*$/, '')}\n\n${heading}\n${line}\n`
    await io.write(file, body)
    io.toast(`Rule saved to ${label}`)
  }
  await dropRule(io, rule.id)
}

export async function dropRule(io: Io, id: number): Promise<void> {
  await io.s.rules.set(list => list.filter(r => r.id !== id))
}
