/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import type { Tab } from '../../types'
import { me } from '../features/live'
import { attention, refreshPrs } from '../features/prs'
import type { Io } from '../lib/io'
import { C, G, kit } from '../lib/ui'
import type { Table } from '../lib/ui'
import { filesView } from './files'
import { impactView } from './impact'
import { nowView } from './now'
import { prsView } from './prs'
import { sessionsView } from './sessions'

// The Command Center pane: one pane, five tabs (Now, Sessions, PRs, Files,
// Impact), opened with /cc or the band's `cc` button. Each tab is a view
// over state, so a value changing redraws exactly the pane that reads it.

export const PANE = 'command-center'
export const TABS: readonly Tab[] = ['now', 'sessions', 'prs', 'files', 'impact']

export const CC = {
  name: 'cc',
  description: 'Command Center: this session, all sessions, PRs, files, impact',
  argumentHint: '[now|sessions|prs|files|impact|refresh|skin on|skin off]',
  immediate: true,
} as const

export type View = { io: Io; E: Table; k: ReturnType<typeof kit>; cols: number; now: number }

export async function openPane(io: Io, tab?: Tab): Promise<void> {
  if (tab) await io.s.tab.set(() => tab)
  await io.openPane(PANE, 'Command Center', 64)
}

/** `/cc …` — open a tab, refresh PRs, or switch the skin. */
export async function ccCommand(io: Io, args: string): Promise<string> {
  const [word = '', arg = ''] = args.trim().toLowerCase().split(/\s+/)
  if (word === 'refresh') {
    void refreshPrs(io)
    return 'Refreshing pull requests.'
  }
  if (word === 'skin') {
    await io.s.skin.set(() => arg !== 'off')
    return `Desktop skin ${arg === 'off' ? 'off' : 'on'}.`
  }
  const tab = word ? TABS.find(t => t.startsWith(word)) : undefined
  await openPane(io, tab)
  return `Command Center opened${tab ? ` on ${tab}` : ''}.`
}

export async function paneView(io: Io, E: Table, cols: number): Promise<RenderElement> {
  const { Box, Text } = E
  const k = kit(E)
  const tab = await io.s.tab.get()
  const prs = await io.s.prs.get()
  const sessions = await io.s.sessions.get()
  const touched = await io.s.touched.get()
  const impact = await io.s.impact.get()
  const view: View = { io, E, k, cols, now: await io.now() }
  const waiting = sessions.filter(s => s.status === 'waiting' && s.id !== me.id).length
  const hot = prs.items.filter(attention).length
  const shared = impact.filter(r => r.dependents.length >= 8 || r.modules.length >= 3).length
  const open = prs.items.filter(p => p.state === 'OPEN').length
  const items: { id: Tab; label: string; badge?: string }[] = [
    { id: 'now', label: 'Now' },
    { id: 'sessions', label: 'Sessions', badge: waiting ? `${G.wait}${waiting}` : sessions.length > 1 ? String(sessions.length) : undefined },
    { id: 'prs', label: 'PRs', badge: hot ? `${G.warn}${hot}` : open ? String(open) : undefined },
    { id: 'files', label: 'Files', badge: touched.length ? String(touched.length) : undefined },
    { id: 'impact', label: 'Impact', badge: shared ? `${G.warn}${shared}` : undefined },
  ]
  const body =
    tab === 'sessions' ? await sessionsView(view)
    : tab === 'prs' ? await prsView(view)
    : tab === 'files' ? await filesView(view)
    : tab === 'impact' ? await impactView(view)
    : await nowView(view)
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={C.accent}>{`${G.brand} `}</Text>
        {k.tabs(tab, items, id => void io.s.tab.set(() => id))}
      </Box>
      {body}
    </Box>
  )
}
