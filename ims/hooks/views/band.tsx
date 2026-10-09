/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { RenderElement } from 'claude-code'

import type { Io } from '../lib/io'
import { C, G, kit } from '../lib/ui'
import type { Table } from '../lib/ui'

// The IMS line above the prompt: the tunnels and Redis as dots, which MySQL
// the running backends use (amber for the shared staging DB, green for a
// local one), how many worktree apps run — and a fix button when a tunnel or
// Redis is down. Other plugins' band lines are kept beside it.

export async function imsBand(io: Io, E: Table, cols: number, below: RenderElement, fix: () => void, open: () => void): Promise<RenderElement> {
  const { Box, Text, Button } = E
  const k = kit(E)
  const env = await io.s.env.get()
  const trees = await io.s.worktrees.get()
  if (!env) return below
  const dot = (up: boolean, label: string): RenderElement => (
    <Text>
      <Text dimColor>{`${label} `}</Text>
      <Text color={up ? C.ok : C.bad}>{up ? G.dot : G.ring}</Text>
    </Text>
  )
  const running = trees.filter(t => t.beUp || t.feUp).length
  const isDown = !env.mysql.up || !env.mongo.up || !env.redis
  const db =
    env.dbMode === 'staging' ? <Text color={C.warn}>db staging</Text>
    : env.dbMode === 'local' ? <Text color={C.ok}>db local</Text>
    : env.dbMode === 'mixed' ? <Text color={C.warn}>db mixed</Text>
    : null
  const stale = trees.filter(t => t.isUat).length

  const line = (
    <Box justifyContent="space-between" width={cols}>
      <Box flexShrink={1} overflow="hidden">
        <Text wrap="truncate-end">
          <Text color={C.accent} bold>IMS</Text>
          {k.sep()}
          {dot(env.mysql.up, 'MySQL')}
          <Text> </Text>
          {dot(env.mongo.up, 'Mongo')}
          <Text> </Text>
          {dot(env.redis, 'Redis')}
          {db ? k.sep() : null}
          {db}
          {running ? k.sep() : null}
          {running ? <Text>{`${G.half} ${running} running`}</Text> : null}
          {stale ? k.sep() : null}
          {stale ? <Text dimColor>{`${stale} UAT ${stale === 1 ? 'copy' : 'copies'}`}</Text> : null}
        </Text>
      </Box>
      <Box flexShrink={0} marginLeft={1} columnGap={1}>
        {isDown ? <Button key="ims-fix" plain variant="primary" label="fix tunnels" onPress={fix} /> : null}
        <Button key="ims-open" plain dimColor label="ims ▸" onPress={open} />
      </Box>
    </Box>
  )
  return (
    <Box flexDirection="column">
      {below}
      {line}
    </Box>
  )
}
