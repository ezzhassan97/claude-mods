/* @jsxRuntime classic */
/* @jsx h */
/* @jsxFrag Fragment */
import type { Elements, RenderElement } from 'claude-code'

import { HEX, iconSvg } from '../lib/ui'
import type { IconName } from '../lib/ui'

// Skin (desktop): an outlined icon beside every tool row, by kind (run, read,
// write, edit, search, web, agent, MCP, tasks), with a spinning Claude-orange
// ring while it runs and red when it failed. The engine's own row is kept
// whole beside it, so expanding diffs and outputs works exactly as before.

export function iconFor(tool: string): IconName {
  if (tool.startsWith('mcp__')) return 'mcp'
  if (/^(Bash|BashOutput|KillShell|KillBash|Monitor)$/.test(tool)) return 'run'
  if (/^(Read|NotebookRead)$/.test(tool)) return 'read'
  if (tool === 'Write') return 'write'
  if (/^(Edit|MultiEdit|NotebookEdit)$/.test(tool)) return 'edit'
  if (/^(Grep|Glob|LS|ToolSearch)$/.test(tool)) return 'search'
  if (/^(WebFetch|WebSearch)$/.test(tool)) return 'web'
  if (/^(Agent|Task|SendMessage)$/.test(tool)) return 'agent'
  if (/^(TodoWrite|TaskCreate|TaskUpdate|TaskList|TaskGet)$/.test(tool)) return 'todo'
  if (/PlanMode$/.test(tool)) return 'plan'
  if (tool === 'AskUserQuestion') return 'ask'
  return 'tool'
}

type ToolRow = { tool: string; isRunning: boolean; isErrored: boolean; isInterrupted: boolean }

/** The engine's own tool row with an icon beside it (desktop only). */
export function skinRow(E: Elements['desktop'], props: ToolRow, row: RenderElement): RenderElement {
  const { Box, Svg } = E
  const color = props.isErrored ? HEX.bad : props.isRunning ? HEX.accent : HEX.muted
  const icon = iconFor(props.tool)
  return (
    <Box flexDirection="row" gap={1}>
      <Box flexShrink={0}>
        <Svg source={iconSvg(icon, color, props.isRunning)} alt={`${icon} tool`} width={16} height={16} isInteractive={props.isRunning ? true : undefined} />
      </Box>
      <Box flexGrow={1} flexDirection="column">
        {row}
      </Box>
    </Box>
  )
}
