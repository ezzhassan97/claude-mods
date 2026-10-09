import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { issueOf, parseRequirements, payload } from '../hooks/features/jira'
import { commandOf } from '../hooks/features/skills'
import { looksLikeCorrection } from '../hooks/features/reflect'
import { pick, sightings, startArgs } from '../hooks/lib/focus'
import { dur, money, ticketKey } from '../hooks/lib/fmt'
import { fit, width } from '../hooks/lib/svg'
import { isLastBlock, squash } from '../hooks/views/cards'
import { diffPage } from '../hooks/views/draw'

// The command center's checks: the worktree detection, the Jira readers, reflect's trigger, the drawing kit,
// and the band and the panel validating on the terminal and the desktop (an
// invalid tree is silently replaced by the engine's own, so this catches it).

describe('what this session is on', () => {
  test('reads worktrees from paths, the worktree script and /ims-start', () => {
    const seen = [
      ...sightings('Read /ims/.worktrees/map-polygons-frontend/src/a.ts'),
      ...sightings('scripts/ims-worktree.sh start masterplan-amenities IMS-2423-Masterplan-Amenities'),
      ...sightings('Edit /ims/.worktrees/masterplan-amenities-backend/src/x.ts'),
      ...sightings('Read /ims/.worktrees/uat-1851-frontend/src/a.ts'),
    ]
    expect(pick(seen)?.folder).toBe('masterplan-amenities')
    expect(pick(seen)?.branch).toBe('IMS-2423-Masterplan-Amenities')
    expect(startArgs('render-images IMS-2408-Render')?.folder).toBe('render-images')
  })
  test('follows the most recent work in a reused session', () => {
    const old = Array.from({ length: 60 }, () => sightings('/ims/.worktrees/seo-frontend/a.ts')).flat()
    const now = Array.from({ length: 30 }, () => sightings('/ims/.worktrees/render-images-backend/b.ts')).flat()
    expect(pick([...old, ...now])?.folder).toBe('render-images')
  })
})

describe('cards under the reply, replay pages', () => {
  test('the cards go under the last block of the answer only', () => {
    const answer = 'First I read the files.\n\nDone. The bar now   shows both branches.'
    const anchor = squash(answer).slice(-160)
    expect(isLastBlock('Done. The bar now shows both branches.', anchor)).toBe(true)
    expect(isLastBlock('First I read the files.', anchor)).toBe(false)
    expect(isLastBlock('x'.repeat(300) + answer, squash('x'.repeat(300) + answer).slice(-160))).toBe(true)
    expect(isLastBlock('', anchor)).toBe(false)
  })
  test('a long diff pages, each page still a valid hunk', () => {
    const e = { id: 1, turnId: 't', path: '/r/a.ts', tool: 'Edit', before: 'a\nb\nc', after: 'A\nB\nC\nD', added: 4, removed: 3, at: 0 }
    const p = diffPage(e, '/r', 2, 3)
    expect(p.total).toBe(7)
    expect(p.source.split('\n').slice(2)).toEqual(['@@ -3,1 +1,2 @@', '-c', '+A', '+B'])
    expect(diffPage(e, '/r', 99, 3).from).toBe(4)
  })
})

describe('jira, reflect, formatting', () => {
  test('reads a story Requirements section and a connector payload', () => {
    expect(parseRequirements('## Objective\nx\n## Requirements\n1. Zoom on pins\n2. **Group** names\n## Testing\n- t')).toEqual(['Zoom on pins', 'Group names'])
    const story = '## 1. Objective\nx\n---\n## 2. Requirements\n### 2.1 First step\n1. Zoom with the touchpad\n2. Amenity names\n### 2.2 Next\n1. AI Detect\n## 3. References\n* link'
    expect(parseRequirements(story)).toEqual(['Zoom with the touchpad', 'Amenity names', 'AI Detect'])
    expect(payload<{ key: string }>({ content: [{ type: 'text', text: '[IMPORTANT: move to v2] {"key":"IMS-1"}' }] })?.key).toBe('IMS-1')
  })
  test('reads a ticket from either Atlassian connector', () => {
    const wrap = (o: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(o) }] })
    const fields = { summary: 'Masterplan Amenities Enhancements', status: { name: 'To Do' } }
    expect(issueOf(wrap({ data: { key: 'IMS-2423', fields } }))?.fields.summary).toBe('Masterplan Amenities Enhancements')
    expect(issueOf(wrap({ issues: { nodes: [{ key: 'IMS-2423', fields: { ...fields, subtasks: [] } }] } }))?.fields.subtasks).toEqual([])
    expect(issueOf(wrap({ error: 'Issue does not exist' }))).toBe(null)
  })
  test('counts the slash commands a prompt runs', () => {
    expect(commandOf('/ims-start masterplan IMS-2423-X')).toBe('ims-start')
    expect(commandOf('<command-name>/reload-plugins</command-name>')).toBe('reload-plugins')
    expect(commandOf('fix the bar')).toBe(null)
  })
  test('reflect wakes only for corrections', () => {
    expect(looksLikeCorrection('no - in this repo we always use pnpm, not npm')).toBe(true)
    expect(looksLikeCorrection('add a button to the header')).toBe(false)
    expect(looksLikeCorrection('/cc')).toBe(false)
  })
  test('text fits and money reads', () => {
    expect(width('MySQL', 11)).toBeGreaterThan(width('mysql', 11))
    expect(fit('IMS-2423-Masterplan-Amenities-Enhancements', 100, 12, { mono: true }).endsWith('…')).toBe(true)
    expect(money(1.234)).toBe('$1.23')
    expect(dur(232.5 * 3600_000)).toBe('9d 16h')
    expect(dur(90 * 60_000)).toBe('1h 30m')
    expect(ticketKey('IMS-2423-Masterplan')).toBe('IMS-2423')
  })
})

function world(on: On): void {
  mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/Users/test' })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <never>Box({})
  })
}

const BAND = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 110, scroll: { top: 0, bodyRows: 11 }, view: {} } as const
const PANE = { title: 'Command center', isFocused: false, bodyColumns: 72, placement: 'dock', scroll: { top: 0, bodyRows: 40 }, view: {} } as const

describe('views validate on every surface', () => {
  test('the band: bar and its one button', async ($, on) => {
    world(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'command-center', surface, component: 'AbovePrompt', props: BAND as never })
      expect(await ui.find({ key: 'bar-open' })).toBeDefined()
      await ui.unmount()
    }
  })
  test('the panel: every tab opens', async ($, on) => {
    world(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'command-center', surface, component: 'Pane', requestId: 'command-center', props: PANE as never })
      for (const id of ['overview', 'github', 'jira', 'files', 'sessions', 'skills', 'controls']) {
        await ui.press({ key: `tab-${id}` })
        expect(await ui.find({ key: `tab-${id}` })).toBeDefined()
      }
      await ui.press({ key: 'tab-controls' })
      const before = (await ui.find({ key: 'tg-next' })) as { props?: { label?: string } } | undefined
      await ui.press({ key: 'tg-next' })
      const after = (await ui.find({ key: 'tg-next' })) as { props?: { label?: string } } | undefined
      expect([before?.props?.label, after?.props?.label]).toEqual(['● On', '○ Off'])
      await ui.press({ key: 'tg-next' })
      expect(((await ui.find({ key: 'tg-next' })) as { props?: { label?: string } } | undefined)?.props?.label).toBe('● On')
      await ui.unmount()
    }
  })
})
