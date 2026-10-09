import type { PluginOptions } from 'claude-code'

// The plugin's options (its userConfig), read once per load: a change in the
// config menu reloads the module, so this is always the current set.

export const config = {
  budget: 10,
  contextAlert: 85,
  isChiming: true,
  isGuarding: true,
  isSuggesting: true,
  suggestMinChars: 80,
  isReceipt: true,
  isSkin: true,
  isBand: true,
  isTrackingPrs: true,
  isImpact: true,
  impactWarn: 8,
  isAutoOpen: false,
  workspace: '~/Main',
}

const num = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

export function configure(o: PluginOptions): void {
  config.budget = num(o.budget_usd, 10)
  config.contextAlert = num(o.context_alert_pct, 85)
  config.isChiming = flag(o.sound, true)
  config.isGuarding = flag(o.guard, true)
  config.isSuggesting = flag(o.next_steps, true)
  config.suggestMinChars = num(o.next_min_chars, 80)
  config.isReceipt = flag(o.receipt, true)
  config.isSkin = flag(o.skin, true)
  config.isBand = flag(o.band, true)
  config.isTrackingPrs = flag(o.prs, true)
  config.isImpact = flag(o.impact, true)
  config.impactWarn = num(o.impact_warn, 8)
  config.isAutoOpen = flag(o.auto_open, false)
  config.workspace = typeof o.workspace === 'string' && o.workspace ? o.workspace : '~/Main'
}
