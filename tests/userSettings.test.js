import { assertEquals } from '@std/assert'
import { loadUserSettings, saveUserSettings, sha256Hex } from '../src/lib/userSettings.js'

function makeStub() {
  const map = new Map()
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }
}

Deno.test('loadUserSettings: returns empty custom_prices when key absent', async () => {
  const stub = makeStub()
  const settings = await loadUserSettings('user@example.com', stub)
  assertEquals(settings, { custom_prices: {} })
})

Deno.test('saveUserSettings + loadUserSettings: round-trip persists data', async () => {
  const stub = makeStub()
  const data = { custom_prices: { Alice: { '60': 300, '45': 250, '30': 220 } } }
  await saveUserSettings('user@example.com', data, stub)
  const loaded = await loadUserSettings('user@example.com', stub)
  assertEquals(loaded, data)
})

Deno.test('sha256Hex: produces consistent hex string', async () => {
  const hash = await sha256Hex('hello')
  assertEquals(hash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  assertEquals(hash.length, 64)
})
