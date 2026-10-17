/** Client-safe shapes shared by the page-chat API, the desktop runner, and the UI. */

export const MAX_MESSAGE_CHARS = 4000

/** queued/running = an agent turn; ship_queued/shipping = the runner rebasing, checking, pushing, watching deploys. */
export type ThreadStatus = 'idle' | 'queued' | 'running' | 'ship_queued' | 'shipping' | 'error'

export function isBusy(status: ThreadStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'ship_queued' || status === 'shipping'
}

/**
 * user   — Kevin's message (meta: PageContext, maybe a screenshot)
 * text   — a chunk of the agent's reply (consecutive chunks render as one bubble)
 * tool   — one tool call, already summarized (meta: { name, target })
 * error  — a run failed; content says why
 * system — runner notes ("Desktop was asleep, waking it")
 * ship_ready — the run left commits in its worktrees (meta: ShipMeta); the UI shows Ship
 * deploy — one step of shipping a repo (meta: DeployMeta)
 */
export type EventKind = 'user' | 'text' | 'tool' | 'error' | 'system' | 'ship_ready' | 'deploy'

/** Kinds that count as the agent having answered (the runner's "unanswered messages" cursor). */
export const REPLY_KINDS: readonly EventKind[] = ['text', 'tool', 'error', 'ship_ready']

/** A repo the runner can edit and ship, e.g. 'agent-dashboard'. */
export type RepoName = string

export interface CommitLine {
  sha: string
  subject: string
}

export interface RepoChange {
  repo: RepoName
  commits: CommitLine[]
  /** `git diff --stat` file lines, capped. */
  files: string[]
  /** "3 files changed, 40 insertions(+), 2 deletions(-)" */
  shortstat: string
}

export interface ShipMeta {
  repos: RepoChange[]
}

export type DeployState = 'checking' | 'pushed' | 'live' | 'failed'

export interface DeployMeta {
  repo: RepoName
  state: DeployState
  sha: string | null
  /** Failure output or deploy log tail. */
  detail: string | null
}

export interface PageContext {
  path: string
  search: string
  title: string
  viewportW: number
  viewportH: number
  colorScheme: 'dark' | 'light'
  device: 'phone' | 'desktop'
  consoleErrors: string[]
}

export interface ToolMeta {
  name: string
  target: string
}

export interface ChatEvent {
  id: number
  kind: EventKind
  content: string
  meta: PageContext | ToolMeta | ShipMeta | DeployMeta | null
  hasScreenshot: boolean
  createdAt: string
}

export interface ThreadSummary {
  id: string
  sectionId: string
  agentHome: string | null
  originPath: string
  status: ThreadStatus
  updatedAt: string
}

/** A row in the sheet's history list. */
export interface ThreadListItem extends ThreadSummary {
  /** Kevin's first message, trimmed. */
  preview: string
  /** Whether any of its deploys went live. */
  shipped: boolean
}

export interface ThreadResponse {
  thread: ThreadSummary
  events: ChatEvent[]
}

export type DesktopState = 'online' | 'waking'

export interface SendResponse {
  threadId: string
  desktop: DesktopState
}
