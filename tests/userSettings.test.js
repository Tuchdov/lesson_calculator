import { assertEquals, assertRejects } from '@std/assert'
import { loadUserSettings, saveUserSettings, sha256Hex } from '../src/lib/userSettings.js'

function makeStub() {
  const map = new Map()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }
}

Deno.test('loadUserSettings: returns defaults when key absent', async () => {
  const stub = makeStub()
  const settings = await loadUserSettings('user@example.com', stub)
  assertEquals(settings, { custom_prices: {}, customer_details: {}, default_prices: {}, default_message: '', paid_cancellation_phrases: null, cancelled_keywords: null })
})

Deno.test('saveUserSettings + loadUserSettings: round-trip persists data', async () => {
  const stub = makeStub()
  const data = {
    custom_prices: { Alice: { '60': 300, '45': 250, '30': 220 } },
    customer_details: {},
    default_prices: { regular: { '60': 260, '45': 210, '30': 190 }, non_regular: { '60': 280, '45': 230, '30': 210 } },
    default_message: 'Hi {student}, you owe ₪{amount} for {month}',
    paid_cancellation_phrases: ['ביטול בתשלום', 'cancelled - billed'],
    cancelled_keywords: ['בוטל', 'מבוטל', 'cancelled'],
  }
  await saveUserSettings('user@example.com', data, stub)
  const loaded = await loadUserSettings('user@example.com', stub)
  assertEquals(loaded, data)
})

Deno.test('loadUserSettings: back-fills customer_details when loading legacy settings', async () => {
  const stub = makeStub()
  // Simulate settings saved before customer_details was added
  const key = 'vocalCalc:settings:' + await sha256Hex('user@example.com')
  stub.setItem(key, JSON.stringify({ custom_prices: { Bob: { '60': 200 } } }))
  const loaded = await loadUserSettings('user@example.com', stub)
  assertEquals(loaded.customer_details, {})
  assertEquals(loaded.custom_prices, { Bob: { '60': 200 } })
})

Deno.test('sha256Hex: produces consistent hex string', async () => {
  const hash = await sha256Hex('hello')
  assertEquals(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  assertEquals(hash.length, 64)
})

Deno.test('loadUserSettings: returns defaults when stored JSON is corrupt', async () => {
  const stub = makeStub()
  const key = 'vocalCalc:settings:' + await sha256Hex('user@example.com')
  stub.setItem(key, '{ this is not valid JSON !!!')
  const settings = await loadUserSettings('user@example.com', stub)
  assertEquals(settings, { custom_prices: {}, customer_details: {}, default_prices: {}, default_message: '', paid_cancellation_phrases: null, cancelled_keywords: null })
})

Deno.test('loadUserSettings: back-fills default_prices/default_message when loading legacy settings', async () => {
  const stub = makeStub()
  const key = 'vocalCalc:settings:' + await sha256Hex('user@example.com')
  stub.setItem(key, JSON.stringify({ custom_prices: {}, customer_details: {} }))
  const loaded = await loadUserSettings('user@example.com', stub)
  assertEquals(loaded.default_prices, {})
  assertEquals(loaded.default_message, '')
})

Deno.test('loadUserSettings: back-fills paid_cancellation_phrases (as null = not customized) when loading legacy settings', async () => {
  const stub = makeStub()
  const key = 'vocalCalc:settings:' + await sha256Hex('user@example.com')
  stub.setItem(key, JSON.stringify({ custom_prices: {}, customer_details: {}, default_prices: {}, default_message: '' }))
  const loaded = await loadUserSettings('user@example.com', stub)
  assertEquals(loaded.paid_cancellation_phrases, null)
})

Deno.test('loadUserSettings: back-fills cancelled_keywords (as null = not customized) when loading legacy settings', async () => {
  const stub = makeStub()
  const key = 'vocalCalc:settings:' + await sha256Hex('user@example.com')
  stub.setItem(key, JSON.stringify({
    custom_prices: {}, customer_details: {}, default_prices: {}, default_message: '', paid_cancellation_phrases: null,
  }))
  const loaded = await loadUserSettings('user@example.com', stub)
  assertEquals(loaded.cancelled_keywords, null)
})

// Regression guard for plan-eng-review outside-voice finding 1: useUserSettings
// .saveSettings persists BEFORE updating in-memory state precisely because
// saveUserSettings must reject on a storage failure rather than swallow it —
// otherwise a failed save (e.g. QuotaExceededError) would look identical to a
// successful one to the caller, and the in-memory state would already have
// been optimistically updated. This test pins the propagation contract the
// hook-level fix depends on.
Deno.test('saveUserSettings: propagates a storage error instead of swallowing it', async () => {
  const throwingStorage = {
    getItem: () => null,
    setItem: () => {
      const err = new Error('quota exceeded')
      err.name = 'QuotaExceededError'
      throw err
    },
  }
  await assertRejects(
    () => saveUserSettings('user@example.com', { custom_prices: {} }, throwingStorage),
    Error,
    'quota exceeded',
  )
})

Deno.test('loadUserSettings: preserves an intentionally emptied list, distinct from never-customized null', async () => {
  const stub = makeStub()
  const data = {
    custom_prices: {}, customer_details: {}, default_prices: {}, default_message: '',
    paid_cancellation_phrases: [], cancelled_keywords: [],
  }
  await saveUserSettings('user@example.com', data, stub)
  const loaded = await loadUserSettings('user@example.com', stub)
  assertEquals(loaded.paid_cancellation_phrases, [])
  assertEquals(loaded.cancelled_keywords, [])
})
