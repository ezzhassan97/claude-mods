import type { TurnCompleteInput, TurnCompleteResult } from 'claude-code'

import type { Io } from '../lib/io'

import { config } from '../lib/config'
import { dur, money, plural } from '../lib/fmt'
import { turn } from './live'

// The receipt: one dim line under a turn's answer — how long, how many tool
// calls, what it changed, what it cost. Only for turns that did real work.

let costAtStart: number | null = null

export async function receiptOnTurnStart(io: Io): Promise<void> {
  costAtStart = (await io.usage())?.cost?.usd ?? null
}

export async function receiptDecorate(io: Io, e: TurnCompleteInput, result: TurnCompleteResult): Promise<TurnCompleteResult> {
  if (!config.isReceipt || e.agentId || e.reason !== 'answer' || (turn.tools === 0 && e.durationMs < 20_000)) return result
  const cost = (await io.usage())?.cost?.usd ?? null
  const parts = [`✻ ${dur(e.durationMs)}`]
  if (turn.tools) parts.push(plural(turn.tools, 'tool'))
  if (turn.files.size) parts.push(`${plural(turn.files.size, 'file')} +${turn.added} −${turn.removed}`)
  if (cost != null && costAtStart != null && cost > costAtStart) parts.push(money(cost - costAtStart))
  const line = parts.join(' · ')
  return { ...result, text: result.text && result.text !== e.answer ? `${result.text}\n${line}` : line }
}
