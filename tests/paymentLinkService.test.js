import { assertEquals, assertRejects } from '@std/assert'
import { createPaymentLink, ServiceError } from '../src/api/paymentLinkService.js'

const ALLOWED_EMAIL = 'teacher@example.com'
const CLIENT_ID = 'client-123.apps.googleusercontent.com'
const WEBHOOK_URL = 'https://hook.eu1.make.com/fake'

function baseArgs(overrides = {}) {
  return {
    accessToken: 'valid-token',
    studentName: 'רחל כהן',
    phone: '050-1234567',
    amount: 487.5,
    month: '2026-08',
    allowedEmail: ALLOWED_EMAIL,
    clientId: CLIENT_ID,
    webhookUrl: WEBHOOK_URL,
    apiKey: undefined,
    ...overrides,
  }
}

function tokeninfoOk(overrides = {}) {
  return {
    ok: true,
    json: async () => ({
      email: ALLOWED_EMAIL,
      aud: CLIENT_ID,
      expires_in: '3599',
      ...overrides,
    }),
  }
}

function makeOk(url = 'https://pay.grow.link/abc123') {
  return {
    ok: true,
    json: async () => ({
      status: 1,
      err: {},
      data: { paymentLinkProcessId: 1, paymentLinkProcessToken: 'tok', url },
    }),
  }
}

// A queue of fetch responses/throws, consumed in order. First call is always
// tokeninfo; second (if reached) is the Make webhook.
function queueFetch(responses) {
  let i = 0
  return async () => {
    const next = responses[i]
    i++
    if (!next) throw new Error('no more mock responses queued')
    if (next instanceof Error) throw next
    return next
  }
}

// ── happy path ────────────────────────────────────────────────────────────

Deno.test('createPaymentLink: happy path returns the link', async () => {
  const fetchImpl = queueFetch([tokeninfoOk(), makeOk('https://pay.grow.link/xyz')])
  const result = await createPaymentLink(baseArgs({ fetchImpl }))
  assertEquals(result, { link: 'https://pay.grow.link/xyz' })
})

// ── 1. tokeninfo unreachable or throttled ────────────────────────────────

Deno.test('createPaymentLink: tokeninfo network failure is a retryable 503', async () => {
  const fetchImpl = queueFetch([new Error('network down')])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 503)
  assertEquals(err.retryable, true)
})

// ── 2. tokeninfo malformed response body ─────────────────────────────────

Deno.test('createPaymentLink: tokeninfo malformed body is treated as auth failure (401)', async () => {
  const fetchImpl = queueFetch([{ ok: true, json: async () => { throw new SyntaxError('bad json') } }])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 401)
})

// ── 3. expired token ──────────────────────────────────────────────────────

Deno.test('createPaymentLink: expired token (expires_in <= 0) is a 401', async () => {
  const fetchImpl = queueFetch([tokeninfoOk({ expires_in: '0' })])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 401)
})

Deno.test('createPaymentLink: tokeninfo non-ok response (Google rejects the token) is a 401', async () => {
  const fetchImpl = queueFetch([{ ok: false, json: async () => ({ error: 'invalid_token' }) }])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 401)
})

// ── 4. token from another Google app / another account ───────────────────

Deno.test('createPaymentLink: aud mismatch (token minted for a different app) is a 403', async () => {
  const fetchImpl = queueFetch([tokeninfoOk({ aud: 'someone-elses-client-id' })])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 403)
})

Deno.test('createPaymentLink: valid token from a different Google account is a 403', async () => {
  const fetchImpl = queueFetch([tokeninfoOk({ email: 'someone-else@example.com' })])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 403)
})

Deno.test('createPaymentLink: missing access token never reaches the network', async () => {
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ accessToken: null, fetchImpl: queueFetch([]) })),
    ServiceError,
  )
  assertEquals(err.status, 401)
})

// ── 5. Make timeout or 5xx ────────────────────────────────────────────────

Deno.test('createPaymentLink: Make network failure is a retryable 502', async () => {
  const fetchImpl = queueFetch([tokeninfoOk(), new Error('timeout')])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 502)
  assertEquals(err.retryable, true)
})

Deno.test('createPaymentLink: Make 5xx response is a retryable 502', async () => {
  const fetchImpl = queueFetch([tokeninfoOk(), { ok: false, json: async () => ({}) }])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 502)
  assertEquals(err.retryable, true)
})

// ── 6. Make 200 with no link in body ──────────────────────────────────────

Deno.test('createPaymentLink: Make success with no url in the body is a hard error, never "undefined"', async () => {
  const fetchImpl = queueFetch([tokeninfoOk(), { ok: true, json: async () => ({ status: 1, err: {}, data: {} }) }])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 502)
  assertEquals(err.message.includes('undefined'), false)
})

Deno.test('createPaymentLink: Make response that is not valid JSON is a retryable 502', async () => {
  const fetchImpl = queueFetch([tokeninfoOk(), { ok: true, json: async () => { throw new SyntaxError('bad json') } }])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 502)
  assertEquals(err.retryable, true)
})

// ── 7. Make returns a non-https string ────────────────────────────────────

Deno.test('createPaymentLink: a non-https link is rejected before it could be stored', async () => {
  const fetchImpl = queueFetch([tokeninfoOk(), makeOk('http://not-secure.example/abc')])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 502)
})

// ── 8. amount negative, zero, or non-finite ───────────────────────────────

Deno.test('createPaymentLink: zero amount is rejected before the Make request', async () => {
  const fetchImpl = queueFetch([tokeninfoOk()])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ amount: 0, fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 400)
})

Deno.test('createPaymentLink: negative amount is rejected before the Make request', async () => {
  const fetchImpl = queueFetch([tokeninfoOk()])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ amount: -50, fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 400)
})

Deno.test('createPaymentLink: non-finite amount is rejected before the Make request', async () => {
  const fetchImpl = queueFetch([tokeninfoOk()])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ amount: NaN, fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 400)
})

// ── phone validation (code-review finding: the UI validates before send,
// but the service itself accepted anything) ────────────────────────────────

Deno.test('createPaymentLink: malformed phone is rejected before the Make request', async () => {
  const fetchImpl = queueFetch([tokeninfoOk()])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ phone: '123', fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 400)
})

Deno.test('createPaymentLink: missing phone is rejected before the Make request', async () => {
  const fetchImpl = queueFetch([tokeninfoOk()])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ phone: undefined, fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 400)
})

Deno.test('createPaymentLink: phone with dashes/spaces is accepted (validated the same way the UI does)', async () => {
  const fetchImpl = queueFetch([tokeninfoOk(), makeOk()])
  const result = await createPaymentLink(baseArgs({ phone: '050 123 4567', fetchImpl }))
  assertEquals(result.link, 'https://pay.grow.link/abc123')
})

// ── payload shape sent to Make ─────────────────────────────────────────────

Deno.test('createPaymentLink: sends phone normalized for Grow and a Hebrew description naming the month', async () => {
  let capturedBody
  const fetchImpl = async (url, opts) => {
    if (String(url).includes('tokeninfo')) return tokeninfoOk()
    capturedBody = JSON.parse(opts.body)
    return makeOk()
  }
  await createPaymentLink(baseArgs({ fetchImpl }))
  assertEquals(capturedBody.phone, '0501234567')
  assertEquals(capturedBody.amount, 487.5)
  assertEquals(capturedBody.description.includes('אוגוסט'), true)
  assertEquals(capturedBody.description.includes('רחל כהן'), true)
})

function captureMakeBody() {
  const captured = {}
  const fetchImpl = async (url, opts) => {
    if (String(url).includes('tokeninfo')) return tokeninfoOk()
    captured.body = JSON.parse(opts.body)
    return makeOk()
  }
  return { captured, fetchImpl }
}

Deno.test('createPaymentLink: defaults — standard profile, no custom invoice text, no lesson count', async () => {
  const { captured, fetchImpl } = captureMakeBody()
  await createPaymentLink(baseArgs({ fetchImpl }))
  assertEquals(captured.body.payment_profile, 'standard')
  assertEquals(captured.body.invoice_description, '')
  assertEquals('number_of_lessons' in captured.body, false)
})

Deno.test('createPaymentLink: sends number_of_lessons, payment_profile and a rendered custom invoice description', async () => {
  const { captured, fetchImpl } = captureMakeBody()
  await createPaymentLink(baseArgs({
    fetchImpl,
    numberOfLessons: 4,
    paymentProfile: ' extended ',
    invoiceDescription: 'ייעוץ קולי - {student} - {month}',
  }))
  assertEquals(captured.body.number_of_lessons, 4)
  assertEquals(captured.body.payment_profile, 'extended')
  assertEquals(captured.body.invoice_description, 'ייעוץ קולי - רחל כהן - אוגוסט')
  assertEquals(captured.body.description, 'ייעוץ קולי - רחל כהן - אוגוסט')
})

// Value: protects=a review-only row (0 standard lessons, fixed price) still mints a link carrying number_of_lessons: 0; fails_when=validation or payload uses truthiness (!n / n ? ...); why_new=only 4 and undefined were tested; seam=none
Deno.test('createPaymentLink: zero lessons is valid and sent as number_of_lessons 0', async () => {
  const { captured, fetchImpl } = captureMakeBody()
  await createPaymentLink(baseArgs({ fetchImpl, numberOfLessons: 0 }))
  assertEquals(captured.body.number_of_lessons, 0)
})

// Value: protects=Hebrew profile names reach the Make router; blank per-student fields fall back to defaults; fails_when=pattern loses \p{L}/u, or whitespace-only text is sent as custom; why_new=only latin profile and real template tested; seam=none
Deno.test('createPaymentLink: Hebrew profile is accepted; whitespace-only profile and invoice text use the defaults', async () => {
  const hebrew = captureMakeBody()
  await createPaymentLink(baseArgs({ fetchImpl: hebrew.fetchImpl, paymentProfile: 'מורחב' }))
  assertEquals(hebrew.captured.body.payment_profile, 'מורחב')

  const blank = captureMakeBody()
  await createPaymentLink(baseArgs({ fetchImpl: blank.fetchImpl, paymentProfile: '   ', invoiceDescription: '  \n ' }))
  assertEquals(blank.captured.body.payment_profile, 'standard')
  assertEquals(blank.captured.body.invoice_description, '')
  assertEquals(blank.captured.body.description, 'תשלום עבור שיעורי שירה - רחל כהן - אוגוסט')
})

for (const [label, overrides, message] of [
  ['negative lesson count', { numberOfLessons: -1 }, 'Invalid number of lessons.'],
  ['fractional lesson count', { numberOfLessons: 1.5 }, 'Invalid number of lessons.'],
  ['profile with spaces', { paymentProfile: 'two words' }, 'Invalid payment profile.'],
  ['non-string profile', { paymentProfile: 42 }, 'Invalid payment profile.'],
  ['non-string student name', { lessonStudent: 7 }, 'Invalid student name.'],
  ['non-string invoice text', { invoiceDescription: 42 }, 'Invalid invoice description.'],
  ['over-long invoice text', { invoiceDescription: 'א'.repeat(201) }, 'Invoice description is too long.'],
]) {
  Deno.test(`createPaymentLink: rejects ${label} with a 400 before calling Make`, async () => {
    const fetchImpl = queueFetch([tokeninfoOk()])
    const err = await assertRejects(() => createPaymentLink(baseArgs({ fetchImpl, ...overrides })), ServiceError)
    assertEquals(err.status, 400)
    assertEquals(err.message, message)
  })
}

Deno.test('createPaymentLink: includes x-make-apikey header only when an apiKey is configured', async () => {
  let capturedHeaders
  const fetchImpl = async (url, opts) => {
    if (String(url).includes('tokeninfo')) return tokeninfoOk()
    capturedHeaders = opts.headers
    return makeOk()
  }
  await createPaymentLink(baseArgs({ fetchImpl, apiKey: 'secret-key' }))
  assertEquals(capturedHeaders['x-make-apikey'], 'secret-key')
})

Deno.test('createPaymentLink: no apiKey means no x-make-apikey header', async () => {
  let capturedHeaders
  const fetchImpl = async (url, opts) => {
    if (String(url).includes('tokeninfo')) return tokeninfoOk()
    capturedHeaders = opts.headers
    return makeOk()
  }
  await createPaymentLink(baseArgs({ fetchImpl, apiKey: undefined }))
  assertEquals('x-make-apikey' in capturedHeaders, false)
})

// ── misconfiguration ─────────────────────────────────────────────────────

Deno.test('createPaymentLink: missing webhookUrl is a 500 before any Make request', async () => {
  const fetchImpl = queueFetch([tokeninfoOk()])
  const err = await assertRejects(
    () => createPaymentLink(baseArgs({ webhookUrl: undefined, fetchImpl })),
    ServiceError,
  )
  assertEquals(err.status, 500)
})

// Value: protects=the payer's name goes to Grow while the product line and invoice text name the child; fails_when=lessonStudent is ignored or replaces customer_name; why_new=lessonStudent is new; seam=none
Deno.test('createPaymentLink: sends the payer as customer_name and the child as student_name', async () => {
  const { captured, fetchImpl } = captureMakeBody()
  await createPaymentLink(baseArgs({ fetchImpl, studentName: 'עינת שמש', lessonStudent: 'ענבר', invoiceDescription: 'ייעוץ - {student} - {month}' }))
  assertEquals(captured.body.customer_name, 'עינת שמש')
  assertEquals(captured.body.student_name, 'ענבר')
  assertEquals(captured.body.invoice_description, 'ייעוץ - ענבר - אוגוסט')
})

// Value: protects=older clients without lessonStudent keep the payer in the product line; fails_when=student_name is blank when lessonStudent is missing; why_new=new field; seam=none
Deno.test('createPaymentLink: without lessonStudent, student_name falls back to the payer', async () => {
  const { captured, fetchImpl } = captureMakeBody()
  await createPaymentLink(baseArgs({ fetchImpl }))
  assertEquals(captured.body.student_name, 'רחל כהן')
  assertEquals(captured.body.description.includes('רחל כהן'), true)
})
