import { describe, expect, test } from 'bun:test'
import { appendEvents, foldEvents, liveAt, shippableId, toolLine } from './chat-view'
import type { ChatEvent, DeployMeta, PageContext, ShipMeta } from './protocol'

const CONTEXT: PageContext = {
  path: '/budget/debt',
  search: '?tab=cards',
  title: 'Debt',
  viewportW: 390,
  viewportH: 844,
  colorScheme: 'dark',
  device: 'phone',
  consoleErrors: [],
}

function event(id: number, kind: ChatEvent['kind'], content: string, meta: ChatEvent['meta'] = null): ChatEvent {
  return { id, kind, content, meta, hasScreenshot: false, createdAt: '2026-10-12T00:00:00Z' }
}

const SHIP: ShipMeta = {
  repos: [{ repo: 'agent-dashboard', commits: [{ sha: 'abc1234', subject: 'fix(budget): x' }], files: ['a.tsx | 2 +-'], shortstat: '1 file changed' }],
}
const live = (repo: DeployMeta['repo']): DeployMeta => ({ repo, state: 'live', sha: 'abc1234', detail: null })

describe('chat view', () => {
  test('folds consecutive text and tool events', () => {
    const items = foldEvents([
      event(1, 'user', 'why?', CONTEXT),
      event(2, 'tool', 'Read', { name: 'Read', target: 'a.tsx' }),
      event(3, 'tool', 'Grep', { name: 'Grep', target: 'foo' }),
      event(4, 'text', 'Because '),
      event(5, 'text', 'reasons.'),
      event(6, 'error', 'boom'),
    ])
    expect(items.map((i) => i.type)).toEqual(['user', 'tools', 'reply', 'error'])
    expect(items[1]?.type === 'tools' && items[1].tools.length).toBe(2)
    expect(items[2]?.type === 'reply' && items[2].text).toBe('Because reasons.')
    expect(toolLine({ name: 'Read', target: 'a.tsx' })).toBe('Read a.tsx')
  })

  test('append drops events already held', () => {
    const held = [event(1, 'user', 'a'), event(2, 'text', 'b')]
    expect(appendEvents(held, [event(2, 'text', 'b'), event(3, 'text', 'c')]).map((e) => e.id)).toEqual([1, 2, 3])
  })
})

describe('ship view', () => {
  test('only the newest ship card is shippable, and only until something newer happens', () => {
    const base = [event(1, 'user', 'fix it'), event(2, 'text', 'done'), event(3, 'ship_ready', 'x', SHIP)]
    expect(shippableId(base, 'idle')).toBe(3)
    expect(shippableId(base, 'running')).toBeNull()
    expect(shippableId([...base, event(4, 'user', 'also this')], 'idle')).toBeNull()
    expect(shippableId([...base, event(4, 'deploy', 'x', live('agent-dashboard'))], 'idle')).toBeNull()
    expect(shippableId([...base, event(4, 'user', 'deploy'), event(5, 'ship_ready', 'x', SHIP)], 'idle')).toBe(5)
    expect(shippableId([event(1, 'user', 'q'), event(2, 'text', 'a')], 'idle')).toBeNull()
  })

  test('deploy steps fold into one row per repo, newest state wins', () => {
    const checking: DeployMeta = { repo: 'agent-dashboard', state: 'checking', sha: null, detail: null }
    const items = foldEvents([
      event(1, 'ship_ready', 'x', SHIP),
      event(2, 'deploy', 'x', checking),
      event(3, 'deploy', 'x', { ...checking, repo: 'agent-services' }),
      event(4, 'deploy', 'x', live('agent-dashboard')),
    ])
    expect(items.map((i) => i.type)).toEqual(['ship', 'deploys'])
    const rows = items[1]?.type === 'deploys' ? items[1].steps : []
    expect(rows.map((r) => `${r.repo}:${r.state}`)).toEqual(['agent-dashboard:live', 'agent-services:checking'])
  })
})

describe('liveAt', () => {
  const at = Date.parse('2026-10-12T00:00:00Z')

  test('only the given repo going live counts', () => {
    expect(liveAt([event(1, 'deploy', 'x', live('agent-services'))], 'agent-dashboard')).toBeNull()
    expect(liveAt([event(1, 'deploy', 'x', live('agent-dashboard'))], 'agent-dashboard')).toBe(at)
    expect(liveAt([event(1, 'deploy', 'x', live('music-minion'))], 'music-minion')).toBe(at)
  })

  test('non-live states and non-deploy events are ignored; newest live wins', () => {
    const pushed: DeployMeta = { ...live('music-minion'), state: 'pushed' }
    expect(liveAt([event(1, 'deploy', 'x', pushed), event(2, 'text', 'hi')], 'music-minion')).toBeNull()
    const later = { ...event(2, 'deploy', 'x', live('music-minion')), createdAt: '2026-10-13T00:00:00Z' }
    expect(liveAt([event(1, 'deploy', 'x', live('music-minion')), later], 'music-minion')).toBe(Date.parse('2026-10-13T00:00:00Z'))
    expect(liveAt([], 'music-minion')).toBeNull()
  })
})
