/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import { impactSummary, measureBranch } from '../features/impact'
import { me } from '../features/live'
import { basename, plural, trunc } from '../lib/fmt'
import { C, G, level } from '../lib/ui'
import type { View } from './pane'

// Impact: for each code file edited (or changed on the branch), how many files
// import it and from which modules. Wide reach = shared code: say so in the
// PR and test the callers. "copy for PR" puts the summary on the clipboard.

export async function impactView({ io, E, k, cols }: View): Promise<RenderElement> {
  const { Box, Text, Button } = E
  const [rows, open, repo] = await Promise.all([io.s.impact.get(), io.s.openImpact.get(), io.s.repo.get()])
  const root = repo?.root ?? me.root
  const most = Math.max(1, ...rows.map(r => r.dependents.length))
  const shared = rows.filter(r => r.dependents.length >= 8 || r.modules.length >= 3).length
  const edits = rows.filter(r => r.source === 'edit')
  const branch = rows.filter(r => r.source === 'branch')
  const relOf = (path: string): string => (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path)

  const row = (r: (typeof rows)[number]): RenderElement => {
    const isShared = r.dependents.length >= 8 || r.modules.length >= 3
    const isOpen = open === `${r.source}:${r.path}`
    const name = basename(r.path)
    return (
      <Box key={`imp-${r.source}-${r.path}`} flexDirection="column">
        <Box justifyContent="space-between">
          <Box flexShrink={1}>
            <Text color={isShared ? C.warn : r.dependents.length ? C.text : C.muted}>{isShared ? G.warn : r.dependents.length ? G.dot : G.ring}</Text>
            <Button
              key={`imp-btn-${r.source}-${r.path}`}
              plain
              label={` ${trunc(name, Math.max(12, cols - 30))}`}
              onPress={() => void io.s.openImpact.set(cur => (cur === `${r.source}:${r.path}` ? null : `${r.source}:${r.path}`))}
            />
          </Box>
          <Box flexShrink={0}>
            {k.meter((r.dependents.length / most) * 100, 6, level((r.dependents.length / 8) * 100, 50, 100))}
            <Text dimColor>{` ${String(r.dependents.length).padStart(3)} ${r.dependents.length === 1 ? 'file' : 'files'}`}</Text>
          </Box>
        </Box>
        <Box paddingLeft={2}>
          <Text dimColor wrap="truncate-end">
            {`${G.result} ${r.dependents.length ? `${plural(r.modules.length, 'module')}: ${r.modules.slice(0, 4).join(' · ')}${r.modules.length > 4 ? ' …' : ''}` : 'used only where it lives'}`}
          </Text>
        </Box>
        {isOpen ? (
          <Box flexDirection="column" paddingLeft={4}>
            <Text dimColor>{relOf(r.path)}</Text>
            {r.dependents.slice(0, 30).map(d => (
              <Text key={`dep-${r.path}-${d}`} wrap="truncate-end">{`${G.arrow} ${relOf(d)}`}</Text>
            ))}
            {r.dependents.length > 30 ? <Text dimColor>{`+${r.dependents.length - 30} more`}</Text> : null}
          </Box>
        ) : null}
      </Box>
    )
  }

  const aside = [plural(rows.length, 'file'), shared ? `${shared} shared` : ''].filter(Boolean).join(' · ')
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        {k.title('Impact', aside)}
        <Box marginTop={1} columnGap={1}>
          <Button key="imp-branch" plain dimColor label="measure branch" onPress={() => void measureBranch(io)} />
          <Button
            key="imp-copy"
            plain
            dimColor
            label="copy for PR"
            onPress={press =>
              void impactSummary(io).then(async text => {
                const isCopied = await io.copy(text, press.surface)
                io.toast(isCopied ? 'Blast radius copied — paste it under "Notes for the reviewer"' : 'Could not copy here')
              })
            }
          />
        </Box>
      </Box>
      {rows.length === 0 ? k.empty('No code edits yet. Edits show who depends on the file; "measure branch" checks a whole branch.') : null}
      {edits.length ? <Box marginTop={1}><Text dimColor>edited this session</Text></Box> : null}
      {edits.map(row)}
      {branch.length ? <Box marginTop={1}><Text dimColor>{`changed on ${repo?.branch ?? 'the branch'}`}</Text></Box> : null}
      {branch.map(row)}
    </Box>
  )
}
