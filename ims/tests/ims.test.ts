import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseRequirements } from '../hooks/features/checklist'
import { ims } from '../hooks/features/env'
import { imsCheck } from '../hooks/features/rules'
import { payload } from '../hooks/features/stories'
import type { Io } from '../hooks/lib/io'

// The IMS pack's checks: every ims-nawy rule the shell guard enforces, the
// story parser, the Jira payload reader, and the views on both surfaces.

ims.root = '/Users/ezz/Main/Nawy/coding-projects/ims-nawy'
const TOKEN = 'export GH_TOKEN=$(gh auth token --user ezzhassan-nawy) && '

/** A stand-in for the engine door: the DB mode and the answer to any question. */
const fakeIo = (dbMode: 'staging' | 'local', answer = 'Cancel'): Io =>
  ({
    s: { env: { get: async () => ({ mysql: { up: true, port: 3308 }, mongo: { up: true, port: 27317 }, redis: true, dbMode, checkedAt: 0 }) } },
    ask: async () => answer,
  }) as unknown as Io

const verdict = async (command: string, io = fakeIo('staging'), cwd = ims.root): Promise<string | null> =>
  (await imsCheck(io, command, cwd))?.deny ?? null

const BODY = '--body "Adds zoom.\nLinked PR: x\n## Changes\n1. a\n## Notes for the reviewer\nnone"'

describe('IMS rules', () => {
  test('PRs go into staging, Mazen reviews, the description is complete', async () => {
    expect(await verdict(`${TOKEN}gh pr create --base main --reviewer mazenfayez ${BODY}`)).toContain('staging')
    expect(await verdict(`${TOKEN}gh pr create --base staging ${BODY}`)).toContain('mazenfayez')
    expect(await verdict(`${TOKEN}gh pr create --base staging --reviewer mazenfayez,ahmedkoshek ${BODY}`)).toContain('drop ahmedkoshek')
    expect(await verdict(`${TOKEN}gh pr create --base staging --reviewer mazenfayez --body "just a line"`)).toContain('## Changes')
    expect(await verdict(`${TOKEN}gh pr create --base staging --reviewer mazenfayez ${BODY}`)).toBe(null)
  })

  test('never merge staging in, never merge PRs, never push shared branches', async () => {
    expect(await verdict(`${TOKEN}git merge origin/staging`)).toContain('never merge or rebase')
    expect(await verdict(`${TOKEN}git pull origin staging`)).toContain('never merge or rebase')
    expect(await verdict(`${TOKEN}gh pr merge 812`)).toContain('never merge')
    expect(await verdict(`${TOKEN}git push origin staging`)).toContain('shared branch')
    expect(await verdict(`${TOKEN}git push -u origin IMS-2423-Amenities`)).toBe(null)
  })

  test('GitHub calls carry the nawy token', async () => {
    expect(await verdict('gh pr list --repo NawyRE/nawy-inventory-frontend')).toContain('GH_TOKEN')
    expect(await verdict('git push -u origin IMS-1-X')).toContain('GH_TOKEN')
    expect(await verdict(`${TOKEN}gh pr list`)).toBe(null)
  })

  test('the shared checkouts keep their branch; worktrees and the prototype are free', async () => {
    expect(await verdict('git -C frontend checkout -b x')).toContain('shared')
    expect(await verdict('cd backend && git switch main')).toContain('shared')
    expect(await verdict('git -C .worktrees/x-frontend checkout -b y')).toBe(null)
    expect(await verdict('cd ims-prototype && git push origin main')).toBe(null)
  })

  test('a schema change asks first and says which database', async () => {
    expect(await verdict('npm run migration:run', fakeIo('staging', 'Cancel'))).toContain('explicit confirmation')
    expect(await verdict('npm run migration:run', fakeIo('local', 'Run it'))).toBe(null)
  })
})

describe('stories', () => {
  test('reads the Requirements section of a story', () => {
    const md = '## Objective\nDo it.\n## Requirements\n1. Zoom on pins\n2. **Group** overlapping names\n   - keep the counter\n## Testing\n- try it'
    expect(parseRequirements(md)).toEqual(['Zoom on pins', 'Group overlapping names', 'keep the counter'])
    expect(parseRequirements('no such section')).toEqual([])
  })

  test('reads a connector payload behind a transport notice', () => {
    const result = { content: [{ type: 'text', text: '[IMPORTANT: move to v2] {"issues":{"nodes":[{"key":"IMS-1"}]}}' }] }
    expect(payload<{ issues: { nodes: { key: string }[] } }>(result)?.issues.nodes[0]?.key).toBe('IMS-1')
  })
})

function world(on: On): void {
  mock.clock(on)
  mock.store(on)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <never>Box({})
  })
}

const PANE = { title: 'IMS', isFocused: false, bodyColumns: 64, placement: 'dock', scroll: { top: 0, bodyRows: 30 }, view: {} } as const

describe('views validate on every surface', () => {
  test('pane, every tab', async ($, on) => {
    world(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'ims', surface, component: 'Pane', requestId: 'ims', props: PANE as never })
      for (const tab of ['stories', 'worktrees', 'checklist', 'uat']) {
        await ui.press({ key: `tab-${tab}` })
        expect(await ui.find({ key: `tab-${tab}` })).toBeDefined()
      }
      await ui.unmount()
    }
  })
})
