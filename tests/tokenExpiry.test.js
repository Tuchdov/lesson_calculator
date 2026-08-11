import { assertEquals } from '@std/assert'
import { computeExpiresAt, isTokenExpired, TOKEN_EXPIRY_BUFFER_MS } from '../src/lib/tokenExpiry.js'

Deno.test('computeExpiresAt adds expiresIn seconds to now', () => {
  const now = 1_000_000
  assertEquals(computeExpiresAt(3600, now), now + 3600 * 1000)
})

Deno.test('isTokenExpired: false well before expiry', () => {
  const now = 1_000_000
  const expiresAt = now + 60 * 60 * 1000 // 1 hour out
  assertEquals(isTokenExpired(expiresAt, TOKEN_EXPIRY_BUFFER_MS, now), false)
})

Deno.test('isTokenExpired: true once inside the buffer window', () => {
  const now = 1_000_000
  const expiresAt = now + TOKEN_EXPIRY_BUFFER_MS - 1 // 1ms inside the buffer
  assertEquals(isTokenExpired(expiresAt, TOKEN_EXPIRY_BUFFER_MS, now), true)
})

Deno.test('isTokenExpired: boundary at exactly the buffer edge counts as expired', () => {
  const now = 1_000_000
  const expiresAt = now + TOKEN_EXPIRY_BUFFER_MS
  assertEquals(isTokenExpired(expiresAt, TOKEN_EXPIRY_BUFFER_MS, now), true)
})

Deno.test('isTokenExpired: true for null expiresAt', () => {
  assertEquals(isTokenExpired(null), true)
})

Deno.test('isTokenExpired: true for 0 expiresAt', () => {
  assertEquals(isTokenExpired(0), true)
})

Deno.test('isTokenExpired: true for NaN expiresAt', () => {
  assertEquals(isTokenExpired(NaN), true)
})
