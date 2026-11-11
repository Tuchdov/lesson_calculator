import { assertEquals } from '@std/assert'
import handler from '../api/pay.js'
import { wrapPaymentLink } from '../src/lib/payRedirect.js'

const SECRET = 'test-secret'
const PHOTO = 'https://abc123xyz.public.blob.vercel-storage.com/preview/photo-Ab12Cd.jpg'

// Stands in for Vercel's req/res: the query comes from the link's search params.
async function open(link) {
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value },
    status(code) { this.statusCode = code; return this },
    send(body) { this.body = body },
  }
  await handler({ query: Object.fromEntries(new URL(link).searchParams) }, res, SECRET)
  return res
}

// Value: protects=a link sent with the Settings photo opens the payment page; fails_when=the handler drops the i param before checking the signature; why_new=regression found in review; seam=Vercel req/res
Deno.test('pay handler: a link with a photo opens with og:image', async () => {
  const link = await wrapPaymentLink({ growUrl: 'https://pay.grow.link/abc', title: 'שיעורים', image: PHOTO, baseUrl: 'https://calc.example.com', secret: SECRET })
  const res = await open(link)
  assertEquals(res.statusCode, 200)
  assertEquals(res.body.includes(`<meta property="og:image" content="${PHOTO}">`), true)
})

Deno.test('pay handler: a link without a photo still opens', async () => {
  const link = await wrapPaymentLink({ growUrl: 'https://pay.grow.link/abc', title: 'שיעורים', baseUrl: 'https://calc.example.com', secret: SECRET })
  const res = await open(link)
  assertEquals(res.statusCode, 200)
  assertEquals(res.body.includes('og:image'), false)
})

Deno.test('pay handler: a link with a swapped photo is a 404', async () => {
  const link = new URL(await wrapPaymentLink({ growUrl: 'https://pay.grow.link/abc', title: 'שיעורים', image: PHOTO, baseUrl: 'https://calc.example.com', secret: SECRET }))
  link.searchParams.set('i', btoa('https://other.public.blob.vercel-storage.com/x.jpg').replace(/=+$/, ''))
  assertEquals((await open(link.href)).statusCode, 404)
})
