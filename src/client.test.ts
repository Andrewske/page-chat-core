import { describe, expect, test } from 'bun:test'
import { createPageChatClient, errorStatus, pageChatUrls, sendForm, type FetchFn, type SendMessageInput } from './client'
import type { PageContext } from './protocol'

const CONTEXT: PageContext = {
  path: '/comparison',
  search: '',
  title: 'Compare',
  viewportW: 390,
  viewportH: 844,
  colorScheme: 'dark',
  device: 'phone',
  consoleErrors: [],
}
const INPUT: SendMessageInput = { message: 'hi', context: CONTEXT, threadId: null, screenshot: null }

interface Call {
  url: string
  init: RequestInit | undefined
}

function fakeFetch(body: unknown, status = 200): { calls: Call[]; fetch: FetchFn } {
  const calls: Call[] = []
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }
  return { calls, fetch: fn }
}

describe('pageChatUrls', () => {
  test('relative by default', () => {
    const urls = pageChatUrls()
    expect(urls.send()).toBe('/api/page-chat')
    expect(urls.thread('t1', 4)).toBe('/api/page-chat/t1?after=4')
    expect(urls.recent('music minion')).toBe('/api/page-chat?section=music%20minion')
    expect(urls.stop('t1')).toBe('/api/page-chat/t1/stop')
    expect(urls.ship('t1')).toBe('/api/page-chat/t1/ship')
    expect(urls.screenshot(17)).toBe('/api/page-chat/screenshot/17')
  })

  test('prefixed with baseUrl, trailing slashes trimmed', () => {
    expect(pageChatUrls('https://dash.example').thread('t1', 0)).toBe('https://dash.example/api/page-chat/t1?after=0')
    expect(pageChatUrls('https://dash.example/').screenshot(3)).toBe('https://dash.example/api/page-chat/screenshot/3')
  })
})

describe('createPageChatClient', () => {
  test('hits relative URLs without baseUrl', async () => {
    const fake = fakeFetch({ threads: [] })
    const client = createPageChatClient({ fetch: fake.fetch })
    await client.fetchRecent('budget')
    await client.stop('t1')
    expect(fake.calls.map((c) => [c.init?.method, c.url])).toEqual([
      [undefined, '/api/page-chat?section=budget'],
      ['POST', '/api/page-chat/t1/stop'],
    ])
    expect(client.screenshotUrl(9)).toBe('/api/page-chat/screenshot/9')
  })

  test('hits absolute URLs with baseUrl', async () => {
    const fake = fakeFetch({ threadId: 't2', desktop: 'online' })
    const client = createPageChatClient({ baseUrl: 'http://piserver:3000', fetch: fake.fetch })
    expect(await client.send(INPUT)).toEqual({ threadId: 't2', desktop: 'online' })
    await client.ship('t2')
    expect(fake.calls.map((c) => c.url)).toEqual(['http://piserver:3000/api/page-chat', 'http://piserver:3000/api/page-chat/t2/ship'])
    expect(client.screenshotUrl(9)).toBe('http://piserver:3000/api/page-chat/screenshot/9')
  })

  test('errors carry the server message and status', async () => {
    const client = createPageChatClient({ fetch: fakeFetch({ error: 'Thread not found' }, 404).fetch })
    const err = await client.fetchThread('gone', 0).catch((e: unknown) => e)
    expect(err instanceof Error && err.message).toBe('Thread not found')
    expect(errorStatus(err)).toBe(404)
  })

  test('non-JSON error bodies fall back to the default message', async () => {
    const fn: FetchFn = async () => new Response('Bad Gateway', { status: 502 })
    const err = await createPageChatClient({ fetch: fn }).stop('t1').catch((e: unknown) => e)
    expect(err instanceof Error && err.message).toBe('Failed to stop the agent')
    expect(errorStatus(err)).toBe(502)
  })
})

describe('sendForm', () => {
  test('omits optional fields when absent', () => {
    const form = sendForm(INPUT)
    expect(form.get('message')).toBe('hi')
    expect(JSON.parse(String(form.get('context')))).toEqual(CONTEXT)
    expect(form.has('threadId')).toBe(false)
    expect(form.has('section')).toBe(false)
    expect(form.has('screenshot')).toBe(false)
  })

  test('includes threadId, section and screenshot when present', () => {
    const form = sendForm({ ...INPUT, threadId: 't1', section: 'music-minion', screenshot: new Blob(['x'], { type: 'image/png' }) })
    expect(form.get('threadId')).toBe('t1')
    expect(form.get('section')).toBe('music-minion')
    expect(form.get('screenshot')).toBeInstanceOf(Blob)
  })
})
