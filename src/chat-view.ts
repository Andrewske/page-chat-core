/** Pure folding of page chat events into what the sheet renders. */
import { isBusy, type ChatEvent, type DeployMeta, type RepoChange, type RepoName, type ThreadStatus, type ToolMeta } from './protocol'

export type ChatItem =
  | { type: 'user'; id: number; text: string; screenshotId: number | null }
  | { type: 'reply'; id: number; text: string }
  | { type: 'tools'; id: number; tools: ToolMeta[] }
  | { type: 'error'; id: number; text: string }
  | { type: 'system'; id: number; text: string }
  | { type: 'ship'; id: number; repos: RepoChange[] }
  | { type: 'deploys'; id: number; steps: DeployMeta[] }

function isToolMeta(meta: ChatEvent['meta']): meta is ToolMeta {
  return meta !== null && 'name' in meta && 'target' in meta
}

function isShipMeta(meta: ChatEvent['meta']): meta is { repos: RepoChange[] } {
  return meta !== null && 'repos' in meta && Array.isArray(meta.repos)
}

function isDeployMeta(meta: ChatEvent['meta']): meta is DeployMeta {
  return meta !== null && 'state' in meta && 'repo' in meta
}

function toItem(event: ChatEvent): ChatItem {
  switch (event.kind) {
    case 'user':
      return { type: 'user', id: event.id, text: event.content, screenshotId: event.hasScreenshot ? event.id : null }
    case 'text':
      return { type: 'reply', id: event.id, text: event.content }
    case 'tool':
      return { type: 'tools', id: event.id, tools: [isToolMeta(event.meta) ? event.meta : { name: event.content, target: '' }] }
    case 'error':
      return { type: 'error', id: event.id, text: event.content }
    case 'system':
      return { type: 'system', id: event.id, text: event.content }
    case 'ship_ready':
      return { type: 'ship', id: event.id, repos: isShipMeta(event.meta) ? event.meta.repos : [] }
    case 'deploy':
      return isDeployMeta(event.meta)
        ? { type: 'deploys', id: event.id, steps: [event.meta] }
        : { type: 'system', id: event.id, text: event.content }
  }
}

/** A repo's newer deploy step replaces its older one, so each repo shows one live row. */
function mergeSteps(steps: DeployMeta[], next: DeployMeta[]): DeployMeta[] {
  return next.reduce((acc, step) => {
    const i = acc.findIndex((s) => s.repo === step.repo)
    return i === -1 ? [...acc, step] : [...acc.slice(0, i), step, ...acc.slice(i + 1)]
  }, steps)
}

/** Consecutive text chunks join into one reply; consecutive tool calls into one activity block. */
function merge(prev: ChatItem, next: ChatItem): ChatItem | null {
  if (prev.type === 'reply' && next.type === 'reply') return { ...prev, text: prev.text + next.text }
  if (prev.type === 'tools' && next.type === 'tools') return { ...prev, tools: [...prev.tools, ...next.tools] }
  if (prev.type === 'deploys' && next.type === 'deploys') return { ...prev, steps: mergeSteps(prev.steps, next.steps) }
  return null
}

export function foldEvents(events: readonly ChatEvent[]): ChatItem[] {
  return events.map(toItem).reduce<ChatItem[]>((items, item) => {
    const last = items[items.length - 1]
    const merged = last ? merge(last, item) : null
    return merged ? [...items.slice(0, -1), merged] : [...items, item]
  }, [])
}

/** Append polled events, dropping any already held (a poll can overlap a refetch). */
export function appendEvents(held: readonly ChatEvent[], incoming: readonly ChatEvent[]): ChatEvent[] {
  const lastId = held[held.length - 1]?.id ?? 0
  return [...held, ...incoming.filter((e) => e.id > lastId)]
}

/** Activity row text: "Read budget/page.tsx", "Grep formatCurrency". */
export function toolLine(tool: ToolMeta): string {
  return tool.target ? `${tool.name} ${tool.target}` : tool.name
}

/**
 * The ship card that can still be shipped: the newest ship_ready, provided
 * nothing happened after it that makes it stale (Kevin wrote again, or a ship
 * already started) and the thread isn't busy.
 */
export function shippableId(events: readonly ChatEvent[], status: ThreadStatus): number | null {
  if (isBusy(status)) return null
  const lastShip = [...events].reverse().find((e) => e.kind === 'ship_ready')
  if (!lastShip) return null
  const stale = events.some((e) => e.id > lastShip.id && (e.kind === 'user' || e.kind === 'deploy'))
  return stale ? null : lastShip.id
}

/**
 * When this thread's latest deploy of `repo` (the app the page is served by)
 * went live (ms), or null. The sheet offers "Reload" only if that's newer than
 * the page load, so the pill disappears once Kevin has reloaded.
 */
export function liveAt(events: readonly ChatEvent[], repo: RepoName): number | null {
  const live = [...events].reverse().find(
    (e) => e.kind === 'deploy' && isDeployMeta(e.meta) && e.meta.repo === repo && e.meta.state === 'live'
  )
  return live ? Date.parse(live.createdAt) : null
}
