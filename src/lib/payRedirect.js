import { monthNameFromKey } from './whatsapp.js'

// WhatsApp's link preview reads og:title, and Grow's payment page always sets
// it to the business name. So the student is sent a link to /api/pay, which
// serves its own og:title (the invoice text) and forwards the browser to Grow.
// Stateless: the Grow link id and the title travel in the URL, signed so
// nobody can mint a link on our domain with their own title.

const GROW_ORIGIN = 'https://pay.grow.link/'
const GROW_ID = /^[A-Za-z0-9~_-]{1,200}$/
const SIG_LENGTH = 16
const MAX_TITLE = 200
// The preview photo uploaded in Settings lives in Vercel Blob's public store.
// Only those URLs may ride in a link, so it can't point at someone else's image.
const PREVIEW_IMAGE = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/[A-Za-z0-9._/-]{1,200}$/

export function isPreviewImageUrl(url) {
  return typeof url === 'string' && PREVIEW_IMAGE.test(url)
}

// Same wording as the Make scenario's default product name, so the preview
// matches the invoice. Uses the month the app calculated, which the scenario
// derives as "last month" — the same month for a normal monthly run.
export function buildInvoiceTitle(student, monthStr, customDescription) {
  if (customDescription) return customDescription
  const [yyyy] = (monthStr ?? '').split('-')
  const monthName = monthNameFromKey(monthStr)
  if (!/^\d{4}$/.test(yyyy ?? '') || monthName === monthStr) return `פיתוח קול - ${student}`
  return `פיתוח קול - ${student} - תשלום ${monthName} ${yyyy.slice(2)}`
}

function toBase64Url(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

// The image is signed only when present, so links sent before it existed stay valid.
async function sign(secret, growId, encodedTitle, encodedImage) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const payload = encodedImage ? `${growId}\n${encodedTitle}\n${encodedImage}` : `${growId}\n${encodedTitle}`
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return toBase64Url(new Uint8Array(mac)).slice(0, SIG_LENGTH)
}

// Constant-time, so the signature can't be guessed a character at a time.
function sameString(a, b) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Returns the Grow link unchanged when it can't be wrapped (no secret, no base
// URL, or not a Grow link), so a missing env var never breaks sending. An
// image that isn't a preview-photo URL is dropped rather than failing the link.
export async function wrapPaymentLink({ growUrl, title, image, baseUrl, secret }) {
  if (!secret || !baseUrl || !growUrl?.startsWith(GROW_ORIGIN)) return growUrl
  const growId = growUrl.slice(GROW_ORIGIN.length)
  if (!GROW_ID.test(growId)) return growUrl
  const cleanTitle = (title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)
  const t = toBase64Url(new TextEncoder().encode(cleanTitle))
  const i = isPreviewImageUrl(image) ? toBase64Url(new TextEncoder().encode(image)) : ''
  const s = await sign(secret, growId, t, i)
  // Every value is already URL-safe; URLSearchParams would escape the ~.
  const imageParam = i ? `&i=${i}` : ''
  return `${baseUrl.replace(/\/+$/, '')}/api/pay?g=${growId}&t=${t}${imageParam}&s=${s}`
}

function decodeText(encoded) {
  return new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(encoded))
}

// Returns {growUrl, title, image?} for a genuine link, or null for anything else.
export async function readPaymentLink({ g, t, i, s }, secret) {
  if (!secret || typeof g !== 'string' || typeof t !== 'string' || typeof s !== 'string') return null
  if (i != null && (typeof i !== 'string' || !/^[A-Za-z0-9_-]{1,400}$/.test(i))) return null
  if (!GROW_ID.test(g) || !/^[A-Za-z0-9_-]{0,400}$/.test(t)) return null
  if (!sameString(await sign(secret, g, t, i), s)) return null
  let title, image
  try {
    title = decodeText(t)
    if (i) image = decodeText(i)
  } catch {
    return null
  }
  if (i && !isPreviewImageUrl(image)) return null
  return image ? { growUrl: GROW_ORIGIN + g, title, image } : { growUrl: GROW_ORIGIN + g, title }
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// A 200 page, not a 302: WhatsApp follows HTTP redirects and would read
// Grow's tags instead. No meta refresh or og:url for the same reason — the
// browser is forwarded by script, with a plain link as the fallback.
export function renderPaymentPage({ growUrl, title, image }) {
  const safeTitle = escapeHtml(title || 'תשלום')
  const imageTag = image ? `\n<meta property="og:image" content="${escapeHtml(image)}">` : ''
  const safeUrl = escapeHtml(growUrl)
  const jsUrl = JSON.stringify(growUrl).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${safeTitle}</title>
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="לתשלום מאובטח">
<meta property="og:type" content="website">${imageTag}
<script>location.replace(${jsUrl})</script>
</head>
<body style="font-family: system-ui, sans-serif; text-align: center; padding: 3rem 1rem">
<p>מעבירים אותך לדף התשלום…</p>
<p><a href="${safeUrl}">לחצו כאן אם הדף לא נפתח</a></p>
</body>
</html>
`
}

export function renderNotFoundPage() {
  return `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><meta name="robots" content="noindex"><title>הקישור לא תקין</title></head>
<body style="font-family: system-ui, sans-serif; text-align: center; padding: 3rem 1rem">
<p>הקישור לתשלום לא תקין. בקשו קישור חדש.</p>
</body>
</html>
`
}
