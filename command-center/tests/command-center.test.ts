import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { classify, segments } from '../hooks/features/guard'
import { ago, clean, money, ticketKey, trunc } from '../hooks/lib/fmt'

// The command center's checks: the guard's reading of commands (pure), the
// formatting every view leans on, and each drawn site validating on the
// terminal and the desktop (an invalid tree is silently replaced by the
// engine's own, so this is the test that catches a broken view).

const rule = (command: string): string | null => {
  const v = classify(command)
  return v === null ? null : 'never' in v ? `never:${v.never}` : v.rule.id
}

describe('guard', () => {
  test('splits a command line into the commands it runs', () => {
    expect(segments('cd x && FOO=1 git push -f; echo ok | cat')).toEqual(['cd x', 'git push -f', 'echo ok', 'cat'])
  })

  test('holds risky commands', () => {
    expect(rule('git push --force origin feature/x')).toBe('force-push')
    expect(rule('git push -f origin feature')).toBe('force-push')
    expect(rule('git -C repo reset --hard HEAD~1')).toBe('reset-hard')
    expect(rule('git checkout -- .')).toBe('discard')
    expect(rule('git clean -fdx')).toBe('clean')
    expect(rule('git branch -D old')).toBe('branch-delete')
    expect(rule('gh pr merge 12 --squash')).toBe('pr-merge')
    expect(rule('rm -rf dist build')).toBe('rm-rf')
    expect(rule('mysql -e "DROP TABLE users"')).toBe('sql')
  })

  test('refuses what is never right', () => {
    expect(rule('rm -rf ~')).toBe('never:rm -rf of the root or home folder')
    expect(rule('git push --force origin main')).toBe('never:force-pushing main/master')
  })

  test('lets ordinary commands through', () => {
    expect(rule('git push -u origin IMS-2423-Amenities')).toBe(null)
    expect(rule('git push --force origin feature/main-fix')).toBe('force-push')
    expect(rule('rm notes.txt')).toBe(null)
    expect(rule('git status && npm test')).toBe(null)
  })
})

describe('format', () => {
  test('money, ago, trunc, tickets, clean', () => {
    expect(money(1.234)).toBe('$1.23')
    expect(money(12.34)).toBe('$12.3')
    expect(ago(0, 30_000)).toBe('now')
    expect(ago(0, 5 * 60_000)).toBe('5m')
    expect(trunc('abcdef', 4)).toBe('abc…')
    expect(ticketKey('IMS-2423-Masterplan-Amenities')).toBe('IMS-2423')
    expect(clean('a\u001b[31mred\u001b[0m\n b')).toBe('ared b')
  })
})

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 90, scroll: { top: 0, bodyRows: 9 }, view: {} } as const
const PANE = { title: 'Command Center', isFocused: false, bodyColumns: 64, placement: 'dock', scroll: { top: 0, bodyRows: 30 }, view: {} } as const

// The world beneath the plugin: a clock, an empty store, and the engine's own
// drawing (an empty box) for the sites the plugin composes with.
function world(on: On): void {
  mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/Users/test' })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <never>Box({})
  })
}

describe('views validate on every surface', () => {
  test('band', async ($, on) => {
    world(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'command-center', surface, component: 'AbovePrompt', props: BAND as never })
      expect(await ui.find({ key: 'cc-open' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('pane, every tab', async ($, on) => {
    world(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'command-center', surface, component: 'Pane', requestId: 'command-center', props: PANE as never })
      for (const tab of ['now', 'sessions', 'prs', 'files', 'impact']) {
        await ui.press({ key: `tab-${tab}` })
        expect(await ui.find({ key: `tab-${tab}` })).toBeDefined()
      }
      await ui.unmount()
    }
  })
})
