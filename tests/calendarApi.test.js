import { assertEquals, assertRejects } from '@std/assert'
import { fetchCalendarEvents, formatCalendarApiError } from '../src/api/calendarApi.js'

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function textResponse(status, text) {
  return new Response(text, { status })
}

function withMockFetch(responses, testFn) {
  return async () => {
    const originalFetch = globalThis.fetch
    const calls = []
    let i = 0
    globalThis.fetch = async (url) => {
      calls.push(String(url))
      const resp = responses[i]
      i++
      if (!resp) throw new Error('no more mock responses queued')
      return resp
    }
    try {
      await testFn(calls)
    } finally {
      globalThis.fetch = originalFetch
    }
  }
}

const TIME_MIN = new Date('2026-01-01')
const TIME_MAX = new Date('2026-02-01')

// --- formatCalendarApiError ---

Deno.test('formatCalendarApiError: 401 returns friendly session-expired message', () => {
  const msg = formatCalendarApiError(401, JSON.stringify({ error: { message: 'Invalid Credentials' } }))
  assertEquals(msg, 'Your Google session has expired. Please sign in again.')
})

Deno.test('formatCalendarApiError: 403 with parseable body includes the message', () => {
  const msg = formatCalendarApiError(403, JSON.stringify({ error: { message: 'Calendar not shared' } }))
  assertEquals(msg, 'Calendar access denied: Calendar not shared')
})

Deno.test('formatCalendarApiError: 403 with unparseable body uses a generic message', () => {
  const msg = formatCalendarApiError(403, 'not json')
  assertEquals(msg, 'Calendar access denied — check calendar sharing permissions.')
})

Deno.test('formatCalendarApiError: other status with parseable body includes the message', () => {
  const msg = formatCalendarApiError(500, JSON.stringify({ error: { message: 'Internal error' } }))
  assertEquals(msg, 'Failed to load calendar events: Internal error')
})

Deno.test('formatCalendarApiError: other status with unparseable body uses a generic message', () => {
  const msg = formatCalendarApiError(500, 'not json')
  assertEquals(msg, 'Failed to load calendar events (error 500).')
})

// --- fetchCalendarEvents ---

Deno.test('fetchCalendarEvents: single page success', withMockFetch(
  [jsonResponse(200, { items: [{ id: '1' }, { id: '2' }] })],
  async (calls) => {
    const getAccessToken = async () => 'tok'
    const events = await fetchCalendarEvents(getAccessToken, 'primary', TIME_MIN, TIME_MAX)
    assertEquals(events.map(e => e.id), ['1', '2'])
    assertEquals(calls.length, 1)
  },
))

Deno.test('fetchCalendarEvents: 401 on the very first page retries and succeeds', withMockFetch(
  [
    textResponse(401, JSON.stringify({ error: { message: 'Invalid Credentials' } })),
    jsonResponse(200, { items: [{ id: '1' }] }),
  ],
  async (calls) => {
    let forceRefreshCalls = 0
    const getAccessToken = async (opts) => {
      if (opts?.forceRefresh) forceRefreshCalls++
      return 'tok'
    }
    const events = await fetchCalendarEvents(getAccessToken, 'primary', TIME_MIN, TIME_MAX)
    assertEquals(events.map(e => e.id), ['1'])
    assertEquals(forceRefreshCalls, 1)
    assertEquals(calls.length, 2)
  },
))

Deno.test('fetchCalendarEvents: multi-page pagination', withMockFetch(
  [
    jsonResponse(200, { items: [{ id: '1' }], nextPageToken: 'page2' }),
    jsonResponse(200, { items: [{ id: '2' }] }),
  ],
  async (calls) => {
    const getAccessToken = async () => 'tok'
    const events = await fetchCalendarEvents(getAccessToken, 'primary', TIME_MIN, TIME_MAX)
    assertEquals(events.map(e => e.id), ['1', '2'])
    assertEquals(calls.length, 2)
    assertEquals(calls[1].includes('pageToken=page2'), true)
  },
))

Deno.test('fetchCalendarEvents: 401 mid-pagination retries the SAME page, not the next one', withMockFetch(
  [
    jsonResponse(200, { items: [{ id: '1' }], nextPageToken: 'page2' }),
    textResponse(401, JSON.stringify({ error: { message: 'Invalid Credentials' } })),
    jsonResponse(200, { items: [{ id: '2' }] }),
  ],
  async (calls) => {
    let forceRefreshCalls = 0
    const getAccessToken = async (opts) => {
      if (opts?.forceRefresh) forceRefreshCalls++
      return 'tok'
    }
    const events = await fetchCalendarEvents(getAccessToken, 'primary', TIME_MIN, TIME_MAX)
    assertEquals(events.map(e => e.id), ['1', '2'])
    assertEquals(forceRefreshCalls, 1)
    assertEquals(calls.length, 3)
    assertEquals(calls[1].includes('pageToken=page2'), true)
    assertEquals(calls[2].includes('pageToken=page2'), true)
  },
))

Deno.test('fetchCalendarEvents: retry budget is spent once per call, not reset per page', withMockFetch(
  [
    textResponse(401, JSON.stringify({ error: { message: 'Invalid Credentials' } })), // page1, first attempt
    jsonResponse(200, { items: [{ id: '1' }], nextPageToken: 'page2' }), // page1 retry succeeds
    textResponse(401, JSON.stringify({ error: { message: 'Invalid Credentials' } })), // page2 401s, no budget left
  ],
  async (calls) => {
    const getAccessToken = async () => 'tok'
    await assertRejects(
      () => fetchCalendarEvents(getAccessToken, 'primary', TIME_MIN, TIME_MAX),
      Error,
      'Your Google session has expired. Please sign in again.',
    )
    assertEquals(calls.length, 3)
  },
))

Deno.test('fetchCalendarEvents: 401 twice throws after the single retry is spent', withMockFetch(
  [
    textResponse(401, JSON.stringify({ error: { message: 'Invalid Credentials' } })),
    textResponse(401, JSON.stringify({ error: { message: 'Invalid Credentials' } })),
  ],
  async (calls) => {
    const getAccessToken = async () => 'tok'
    await assertRejects(
      () => fetchCalendarEvents(getAccessToken, 'primary', TIME_MIN, TIME_MAX),
      Error,
      'Your Google session has expired. Please sign in again.',
    )
    assertEquals(calls.length, 2)
  },
))

Deno.test('fetchCalendarEvents: non-401 error throws immediately without retrying', withMockFetch(
  [textResponse(500, JSON.stringify({ error: { message: 'Server error' } }))],
  async (calls) => {
    const getAccessToken = async () => 'tok'
    await assertRejects(
      () => fetchCalendarEvents(getAccessToken, 'primary', TIME_MIN, TIME_MAX),
      Error,
      'Failed to load calendar events: Server error',
    )
    assertEquals(calls.length, 1)
  },
))
