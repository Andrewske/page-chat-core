'use client'

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { appendEvents } from './chat-view'
import { createPageChatClient, errorStatus, type PageChatClient } from './client'
import { isBusy, type ChatEvent, type DesktopState, type PageContext, type ThreadListItem, type ThreadStatus, type ThreadSummary } from './protocol'

const POLL_ACTIVE_MS = 1_000
/** Reopen the section's latest thread only if it was touched this recently. */
const RESUME_WINDOW_MS = 12 * 60 * 60_000

/** React Query keys, all under 'page-chat' so an app can invalidate them together. */
export const pageChatKeys = {
  recent: (sectionId: string): readonly [string, string, string] => ['page-chat', 'recent', sectionId],
  history: (sectionId: string): readonly [string, string, string] => ['page-chat', 'history', sectionId],
}

const PageChatContext = createContext<PageChatClient | null>(null)

export interface PageChatProviderProps {
  /** Defaults to a same-origin client. */
  client?: PageChatClient
  /** Shorthand for createPageChatClient({ baseUrl }) when no client is given. */
  baseUrl?: string
  children?: React.ReactNode
}

/** Supplies the API client to the hooks. Must sit inside a QueryClientProvider. */
export function PageChatProvider({ client, baseUrl = '', children }: PageChatProviderProps): React.ReactElement {
  const value = useMemo(() => client ?? createPageChatClient({ baseUrl }), [client, baseUrl])
  return createElement(PageChatContext.Provider, { value }, children)
}

export function usePageChatClient(): PageChatClient {
  const client = useContext(PageChatContext)
  if (!client) throw new Error('usePageChatClient: no PageChatProvider above this component (wrap the app in <PageChatProvider>)')
  return client
}

function storageKey(sectionId: string): string {
  return `page-chat:thread:${sectionId}`
}

export interface UsePageChat {
  threadId: string | null
  events: ChatEvent[]
  status: ThreadStatus
  desktop: DesktopState | null
  sending: boolean
  error: string | null
  send: (message: string, context: PageContext, screenshot: Blob | null) => Promise<boolean>
  stop: () => void
  ship: () => void
  startNew: () => void
  openThread: (id: string) => void
}

/** The section's past conversations, newest first. Fetched only while the history list is open. */
export function usePageChatHistory(sectionId: string, enabled: boolean): UseQueryResult<ThreadListItem[]> {
  const client = usePageChatClient()
  return useQuery({
    queryKey: pageChatKeys.history(sectionId),
    queryFn: () => client.fetchRecent(sectionId).then(({ threads }) => threads),
    enabled,
    staleTime: 0,
  })
}

/** Which thread to show when the sheet opens: this tab's last one, else the section's recent one. */
function useInitialThread(sectionId: string, enabled: boolean): string | null | undefined {
  const client = usePageChatClient()
  const recent = useQuery({
    queryKey: pageChatKeys.recent(sectionId),
    queryFn: () => client.fetchRecent(sectionId).then(({ threads }) => resumable(threads[0])),
    enabled,
    staleTime: 0,
  })
  if (!enabled) return undefined
  const stored = typeof window === 'undefined' ? null : window.sessionStorage.getItem(storageKey(sectionId))
  if (stored) return stored
  if (recent.isError) return null
  return recent.isSuccess ? recent.data : undefined
}

function resumable(latest: ThreadSummary | undefined): string | null {
  return latest && Date.now() - Date.parse(latest.updatedAt) < RESUME_WINDOW_MS ? latest.id : null
}

/**
 * One chat thread with the section's agent. Events are polled by cursor
 * while the agent is working or a ship is in flight, so the sheet survives reloads and
 * the desktop sleeping: everything lives in the DB.
 */
export interface UsePageChatOptions {
  /** Send sectionId as an explicit `section` field. For apps whose paths don't map to a dashboard section. */
  explicitSection?: boolean
}

export function usePageChat(sectionId: string, open: boolean, options: UsePageChatOptions = {}): UsePageChat {
  const client = usePageChatClient()
  const section = options.explicitSection ? sectionId : undefined
  const initial = useInitialThread(sectionId, open)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [events, setEvents] = useState<ChatEvent[]>([])
  const [status, setStatus] = useState<ThreadStatus>('idle')
  const [desktop, setDesktop] = useState<DesktopState | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eventsRef = useRef<ChatEvent[]>([])
  const adopted = useRef(false)

  const showThread = useCallback((id: string | null): void => {
    eventsRef.current = []
    setEvents([])
    setThreadId(id)
    setStatus(id ? 'queued' : 'idle') // queued forces one fetch; the poll settles the real status
    setDesktop(null)
  }, [])

  useEffect(() => {
    if (initial === undefined || adopted.current) return
    adopted.current = true
    showThread(initial)
  }, [initial, showThread])

  // The remembered thread was deleted: forget it and start clean instead of polling 404s forever.
  const onMissing = useCallback((): void => {
    window.sessionStorage.removeItem(storageKey(sectionId))
    showThread(null)
  }, [sectionId, showThread])

  usePoll(client, threadId, status, eventsRef, { setEvents, setStatus, setError, onMissing })

  const send = useCallback(
    async (message: string, context: PageContext, screenshot: Blob | null): Promise<boolean> => {
      setSending(true)
      setError(null)
      try {
        const res = await client.send({ message, context, threadId, screenshot, section })
        window.sessionStorage.setItem(storageKey(sectionId), res.threadId)
        if (res.threadId !== threadId) showThread(res.threadId)
        setStatus('queued')
        setDesktop(res.desktop)
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send message')
        return false
      } finally {
        setSending(false)
      }
    },
    [client, section, sectionId, threadId, showThread]
  )

  const stop = useCallback((): void => {
    if (!threadId) return
    client.stop(threadId).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to stop'))
  }, [client, threadId])

  const ship = useCallback((): void => {
    if (!threadId) return
    setError(null)
    client.ship(threadId)
      .then((res) => {
        setStatus('ship_queued')
        setDesktop(res.desktop)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to start the ship'))
  }, [client, threadId])

  const startNew = useCallback((): void => {
    window.sessionStorage.removeItem(storageKey(sectionId))
    showThread(null)
  }, [sectionId, showThread])

  const openThread = useCallback(
    (id: string): void => {
      window.sessionStorage.setItem(storageKey(sectionId), id)
      showThread(id)
    },
    [sectionId, showThread]
  )

  return { threadId, events, status, desktop, sending, error, send, stop, ship, startNew, openThread }
}

interface PollSinks {
  setEvents: (events: ChatEvent[]) => void
  setStatus: (status: ThreadStatus) => void
  setError: (error: string | null) => void
  onMissing: () => void
}

function usePoll(client: PageChatClient, threadId: string | null, status: ThreadStatus, eventsRef: React.RefObject<ChatEvent[]>, sinks: PollSinks): void {
  const { setEvents, setStatus, setError, onMissing } = sinks
  const active = isBusy(status)
  useEffect(() => {
    if (!threadId || !active) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const after = eventsRef.current[eventsRef.current.length - 1]?.id ?? 0
        const res = await client.fetchThread(threadId, after)
        if (cancelled) return
        eventsRef.current = appendEvents(eventsRef.current, res.events)
        setEvents(eventsRef.current)
        setStatus(res.thread.status)
        setError(null) // a ship's own deploy restarts the dashboard; recover quietly once it's back
      } catch (err) {
        if (cancelled) return
        if (errorStatus(err) === 404) return onMissing()
        setError(err instanceof Error ? err.message : 'Failed to load chat')
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), POLL_ACTIVE_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [client, threadId, active, eventsRef, setEvents, setStatus, setError, onMissing])
}
