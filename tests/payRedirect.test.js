import { assertEquals } from '@std/assert'
import { buildInvoiceTitle, wrapPaymentLink, readPaymentLink, renderPaymentPage } from '../src/lib/payRedirect.js'

const SECRET = 'test-secret'
const BASE = 'https://calc.example.com'

async function paramsOf(link) {
  return Object.fromEntries(new URL(link).searchParams)
}

// ── buildInvoiceTitle ─────────────────────────────────────────────────────

// Value: protects=the preview title matches the Make scenario's default product name; fails_when=wording, month name or 2-digit year drift; why_new=new feature; seam=none
Deno.test('buildInvoiceTitle: default wording matches the invoice line', () => {
  assertEquals(buildInvoiceTitle('ענבר', '2026-10', ''), 'פיתוח קול - ענבר - תשלום אוקטובר 26')
})

Deno.test('buildInvoiceTitle: custom invoice text wins', () => {
  assertEquals(buildInvoiceTitle('ענבר', '2026-10', 'ייעוץ - ענבר'), 'ייעוץ - ענבר')
})

Deno.test('buildInvoiceTitle: missing or bad month drops the month part instead of printing junk', () => {
  assertEquals(buildInvoiceTitle('ענבר', undefined, ''), 'פיתוח קול - ענבר')
  assertEquals(buildInvoiceTitle('ענבר', '2026-13', ''), 'פיתוח קול - ענבר')
})

// ── wrap / read round trip ────────────────────────────────────────────────

// Value: protects=a genuine link opens the right Grow page with the Hebrew title intact; fails_when=encoding or signing breaks the round trip; why_new=new feature; seam=none
Deno.test('wrapPaymentLink → readPaymentLink round-trips the Grow link and Hebrew title', async () => {
  const link = await wrapPaymentLink({ growUrl: 'https://pay.grow.link/OTgx~ab-Nw', title: 'פיתוח קול - ענבר - תשלום אוקטובר 26', baseUrl: BASE + '/', secret: SECRET })
  assertEquals(link.startsWith(`${BASE}/api/pay?`), true)
  assertEquals(await readPaymentLink(await paramsOf(link), SECRET), {
    growUrl: 'https://pay.grow.link/OTgx~ab-Nw',
    title: 'פיתוח קול - ענבר - תשלום אוקטובר 26',
  })
})

Deno.test('wrapPaymentLink: leaves the link alone without a secret, a base URL, or a Grow link', async () => {
  const grow = 'https://pay.grow.link/abc'
  assertEquals(await wrapPaymentLink({ growUrl: grow, title: 't', baseUrl: BASE, secret: '' }), grow)
  assertEquals(await wrapPaymentLink({ growUrl: grow, title: 't', baseUrl: undefined, secret: SECRET }), grow)
  assertEquals(await wrapPaymentLink({ growUrl: 'https://evil.example/abc', title: 't', baseUrl: BASE, secret: SECRET }), 'https://evil.example/abc')
})

// Value: protects=nobody can mint a link on our domain with their own title or target; fails_when=the signature doesn't cover both g and t; why_new=new feature; seam=none
Deno.test('readPaymentLink: rejects a changed title, a changed Grow id, a wrong secret and missing params', async () => {
  const p = await paramsOf(await wrapPaymentLink({ growUrl: 'https://pay.grow.link/abc', title: 'שיעורים', baseUrl: BASE, secret: SECRET }))
  const other = await paramsOf(await wrapPaymentLink({ growUrl: 'https://pay.grow.link/abc', title: 'משהו אחר', baseUrl: BASE, secret: SECRET }))
  assertEquals(await readPaymentLink({ ...p, t: other.t }, SECRET), null)
  assertEquals(await readPaymentLink({ ...p, g: 'abd' }, SECRET), null)
  assertEquals(await readPaymentLink(p, 'other-secret'), null)
  assertEquals(await readPaymentLink({ g: p.g, t: p.t }, SECRET), null)
  assertEquals(await readPaymentLink(p, undefined), null)
})

Deno.test('readPaymentLink: rejects a Grow id that could leave pay.grow.link', async () => {
  assertEquals(await readPaymentLink({ g: '..%2F@evil.example', t: '', s: 'x' }, SECRET), null)
  assertEquals(await readPaymentLink({ g: 'a/b', t: '', s: 'x' }, SECRET), null)
})

// ── renderPaymentPage ─────────────────────────────────────────────────────

// Value: protects=WhatsApp reads the invoice text as og:title and the page can't be used for HTML/script injection; fails_when=title is unescaped or og:title missing; why_new=new feature; seam=none
Deno.test('renderPaymentPage: sets og:title to the escaped title and forwards to Grow', () => {
  const html = renderPaymentPage({ growUrl: 'https://pay.grow.link/abc', title: 'שיר "x" <script>alert(1)</script>' })
  assertEquals(html.includes('<meta property="og:title" content="שיר &quot;x&quot; &lt;script&gt;alert(1)&lt;/script&gt;">'), true)
  assertEquals(html.includes('<script>alert(1)'), false)
  assertEquals(html.includes('location.replace("https://pay.grow.link/abc")'), true)
  assertEquals(html.includes('http-equiv="refresh"'), false)
})
