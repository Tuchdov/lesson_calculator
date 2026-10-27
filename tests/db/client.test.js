import { test } from 'node:test'
import assert from 'node:assert/strict'
import { billingRequest } from '../../src/lib/billingClient.js'

test('aborting while refreshing a token prevents the old account request from being sent', async t => {
  let release
  const token = new Promise(resolve => { release = resolve })
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => { calls++; return { ok: true, json: async () => ({}) } })
  const controller = new AbortController()
  const request = billingRequest(() => token, '/api/billing', { action: 'importLegacy' }, { owner: 'old@example.com', signal: controller.signal })
  controller.abort()
  release('new-account-token')
  await assert.rejects(request, { name: 'AbortError' })
  assert.equal(calls, 0)
})
