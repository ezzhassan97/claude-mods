import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { classify, imsVerdict, segments } from '../hooks/features/guard'
import { parseRequirements, payload } from '../hooks/features/jira'
import { looksLikeCorrection } from '../hooks/features/reflect'
import { pick, sightings, startArgs } from '../hooks/lib/focus'
import { money, ticketKey } from '../hooks/lib/fmt'
import { fit, width } from '../hooks/lib/svg'

// The command center's checks: the guard and ims-nawy's rules (pure), the
// worktree detection, the Jira readers, reflect's trigger, the drawing kit,
// and the band and the panel validating on the terminal and the desktop (an
// invalid tree is silently replaced by the engine's own, so this catches it).

const rule = (command: string): string | null => {
  const v = classify(command)
  return v === null ? null : 'never' in v ? `never:${v.never}` : v.rule.id
}

describe('guard', () => {
  test('splits a command line into the commands it runs', () => {
    expect(segments('cd x && FOO=1 git push -f; echo ok | cat')).toEqual(['cd x', 'git push -f', 'echo ok', 'cat'])
  })
  test('holds risky commands, refuses what is never right, lets the rest through', () => {
    expect(rule('git push --force origin feature/x')).toBe('force-push')
    expect(rule('git -C repo reset --hard HEAD~1')).toBe('reset-hard')
    expect(rule('git checkout -- .')).toBe('discard')
    expect(rule('git clean -fdx')).toBe('clean')
    expect(rule('git branch -D old')).toBe('branch-delete')
    expect(rule('gh pr merge 12 --squash')).toBe('pr-merge')
    expect(rule('rm -rf dist build')).toBe('rm-rf')
    expect(rule('rm -rf ~')).toBe('never:rm -rf of the root or home folder')
    expect(rule('git push --force origin main')).toBe('never:force-pushing main/master')
    expect(rule('git push --force origin feature/main-fix')).toBe('force-push')
    expect(rule('git status && npm test')).toBe(null)
  })
})

describe('ims-nawy rules', () => {
  const root = '/ims'
  const t = 'export GH_TOKEN=$(gh auth token --user ezzhassan-nawy) && '
  const body = '--body "x\nLinked PR: y\n## Changes\n1. a\n## Notes for the reviewer\nn"'
  const v = (command: string, cwd = root): string | null => {
    const r = imsVerdict(command, cwd, root)
    return r === null ? null : 'deny' in r ? r.deny : `schema:${r.schema}`
  }
  test('PRs into staging, Mazen only, a full description', () => {
    expect(v(`${t}gh pr create --base main --reviewer mazenfayez ${body}`)).toContain('staging')
    expect(v(`${t}gh pr create --base staging ${body}`)).toContain('mazenfayez')
    expect(v(`${t}gh pr create --base staging --reviewer mazenfayez,ahmedkoshek ${body}`)).toContain('drop ahmedkoshek')
    expect(v(`${t}gh pr create --base staging --reviewer mazenfayez --body "one line"`)).toContain('## Changes')
    expect(v(`${t}gh pr create --base staging --reviewer mazenfayez ${body}`)).toBe(null)
  })
  test('no staging merges, no PR merges, no shared pushes, the nawy token', () => {
    expect(v(`${t}git merge origin/staging`)).toContain('never merge or rebase')
    expect(v(`${t}gh pr merge 812`)).toContain('never merge')
    expect(v(`${t}git push origin staging`)).toContain('shared branch')
    expect(v('gh pr list')).toContain('GH_TOKEN')
    expect(v(`${t}git push -u origin IMS-2423-Amenities`)).toBe(null)
  })
  test('shared checkouts keep their branch; worktrees and the prototype are free', () => {
    expect(v('git -C frontend checkout -b x')).toContain('shared')
    expect(v('git -C .worktrees/x-frontend checkout -b y')).toBe(null)
    expect(v('cd ims-prototype && git push origin main')).toBe(null)
  })
  test('a schema change is held for a yes', () => {
    expect(v('npm run migration:run')).toBe('schema:npm run migration:run')
  })
})

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

describe('jira, reflect, formatting', () => {
  test('reads a story Requirements section and a connector payload', () => {
    expect(parseRequirements('## Objective\nx\n## Requirements\n1. Zoom on pins\n2. **Group** names\n## Testing\n- t')).toEqual(['Zoom on pins', 'Group names'])
    const story = '## 1. Objective\nx\n---\n## 2. Requirements\n### 2.1 First step\n1. Zoom with the touchpad\n2. Amenity names\n### 2.2 Next\n1. AI Detect\n## 3. References\n* link'
    expect(parseRequirements(story)).toEqual(['Zoom with the touchpad', 'Amenity names', 'AI Detect'])
    expect(payload<{ key: string }>({ content: [{ type: 'text', text: '[IMPORTANT: move to v2] {"key":"IMS-1"}' }] })?.key).toBe('IMS-1')
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
      for (const id of ['overview', 'files', 'github', 'controls']) {
        await ui.press({ key: `tab-${id}` })
        expect(await ui.find({ key: `tab-${id}` })).toBeDefined()
      }
      await ui.press({ key: 'tg-next' })
      expect(await ui.find({ key: 'tg-next' })).toBeDefined()
      await ui.unmount()
    }
  })
})
