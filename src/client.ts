/* Fetch client for the page-chat API. Pure factory: no module state, so an
   app can point it at its own origin (default, relative URLs) or another one. */
import type { DesktopState, PageContext, SendResponse, ThreadListItem, ThreadResponse } from './protocol'

export interface SendMessageInput {
  message: string
  context: PageContext
  threadId: string | null
  screenshot: Blob | null
  /** Explicit section for apps outside the dashboard; the server derives it from context.path otherwise. */
  section?: string
}

export interface PageChatClient {
  send: (input: SendMessageInput) => Promise<SendResponse>
  fetchThread: (threadId: string, after: number) => Promise<ThreadResponse>
  fetchRecent: (sectionId: string) => Promise<{ threads: ThreadListItem[] }>
  stop: (threadId: string) => Promise<void>
  ship: (threadId: string) => Promise<{ desktop: DesktopState }>
  screenshotUrl: (eventId: number) => string
}

export interface PageChatClientOptions {
  /** Origin (and optional prefix) of the page-chat API. '' means same-origin relative URLs. */
  baseUrl?: string
  /** Injectable for tests. Defaults to the global fetch. */
  fetch?: FetchFn
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

interface RequestOptions {
  method?: string
  body?: FormData
  fallback: string
}

/* Non-JSON error bodies (e.g. a bare 502 from the proxy) must not turn into
   SyntaxErrors: parse failures fall through to the fallback message. */
async function apiError(res: Response, fallback: string): Promise<Error & { status: number }> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return Object.assign(new Error(body?.error ?? fallback), { status: res.status })
}

/** HTTP status of an error thrown by the client, if it came from a response. */
export function errorStatus(error: unknown): number | null {
  return error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : null
}

/** The multipart body POST /api/page-chat expects. */
export function sendForm(input: SendMessageInput): FormData {
  const form = new FormData()
  form.append('message', input.message)
  form.append('context', JSON.stringify(input.context))
  if (input.threadId) form.append('threadId', input.threadId)
  if (input.section) form.append('section', input.section)
  if (input.screenshot) form.append('screenshot', input.screenshot, 'screenshot.png')
  return form
}

export interface PageChatUrls {
  send: () => string
  thread: (threadId: string, after: number) => string
  recent: (sectionId: string) => string
  stop: (threadId: string) => string
  ship: (threadId: string) => string
  screenshot: (eventId: number) => string
}

/** URL builders, exposed for tests and for apps that need a raw link. */
export function pageChatUrls(baseUrl = ''): PageChatUrls {
  const root = `${baseUrl.replace(/\/+$/, '')}/api/page-chat`
  return {
    send: () => root,
    thread: (threadId: string, after: number) => `${root}/${threadId}?after=${after}`,
    recent: (sectionId: string) => `${root}?section=${encodeURIComponent(sectionId)}`,
    stop: (threadId: string) => `${root}/${threadId}/stop`,
    ship: (threadId: string) => `${root}/${threadId}/ship`,
    screenshot: (eventId: number) => `${root}/screenshot/${eventId}`,
  }
}

type Requester = (url: string, opts: RequestOptions) => Promise<Response>

function requester(fetchFn: FetchFn): Requester {
  return async (url: string, opts: RequestOptions): Promise<Response> => {
    const res = await fetchFn(url, { method: opts.method, body: opts.body })
    if (!res.ok) throw await apiError(res, opts.fallback)
    return res
  }
}

export function createPageChatClient({ baseUrl = '', fetch: fetchFn }: PageChatClientOptions = {}): PageChatClient {
  const urls = pageChatUrls(baseUrl)
  const request = requester(fetchFn ?? ((url, init) => fetch(url, init)))
  const json = <T>(url: string, opts: RequestOptions): Promise<T> => request(url, opts).then((res) => res.json() as Promise<T>)
  return {
    send: (input) => json(urls.send(), { method: 'POST', body: sendForm(input), fallback: 'Failed to send message' }),
    fetchThread: (threadId, after) => json(urls.thread(threadId, after), { fallback: 'Failed to load chat' }),
    fetchRecent: (sectionId) => json(urls.recent(sectionId), { fallback: 'Failed to load chats' }),
    stop: (threadId) => request(urls.stop(threadId), { method: 'POST', fallback: 'Failed to stop the agent' }).then(() => undefined),
    ship: (threadId) => json(urls.ship(threadId), { method: 'POST', fallback: 'Failed to start the ship' }),
    screenshotUrl: urls.screenshot,
  }
}
