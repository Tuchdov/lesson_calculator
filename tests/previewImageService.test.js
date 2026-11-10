import { assertEquals, assertRejects } from '@std/assert'
import { uploadPreviewImage, MAX_PREVIEW_IMAGE_BYTES } from '../src/api/previewImageService.js'
import { ServiceError } from '../src/api/paymentLinkService.js'

const ALLOWED_EMAIL = 'teacher@example.com'
const CLIENT_ID = 'client-123.apps.googleusercontent.com'
const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3))
const URL_OUT = 'https://abc.public.blob.vercel-storage.com/preview/photo-x.jpg'

function tokeninfo(email = ALLOWED_EMAIL) {
  return async () => ({ ok: true, json: async () => ({ email, aud: CLIENT_ID, expires_in: '3599' }) })
}

function args(overrides = {}) {
  const calls = []
  return {
    calls,
    args: {
      accessToken: 'valid-token',
      image: JPEG,
      allowedEmail: ALLOWED_EMAIL,
      clientId: CLIENT_ID,
      blobToken: 'blob-token',
      fetchImpl: tokeninfo(),
      put: async (...a) => { calls.push(a); return { url: URL_OUT } },
      ...overrides,
    },
  }
}

// Value: protects=an uploaded photo is stored publicly under a fresh name; fails_when=the put options change or the URL isn't returned; why_new=new feature; seam=@vercel/blob put
Deno.test('uploadPreviewImage: stores the JPEG publicly with a random suffix and returns its URL', async () => {
  const { args: a, calls } = args()
  assertEquals(await uploadPreviewImage(a), { url: URL_OUT })
  assertEquals(calls.length, 1)
  assertEquals(calls[0][0], 'preview/photo.jpg')
  assertEquals(Array.from(calls[0][1]).slice(0, 3), [0xff, 0xd8, 0xff])
  assertEquals(calls[0][2], { access: 'public', contentType: 'image/jpeg', addRandomSuffix: true, token: 'blob-token' })
})

// Value: protects=only the teacher can write to public storage; fails_when=identity isn't checked before storing; why_new=new endpoint; seam=none
Deno.test('uploadPreviewImage: rejects another Google account without storing anything', async () => {
  const { args: a, calls } = args({ fetchImpl: tokeninfo('someone@example.com') })
  const err = await assertRejects(() => uploadPreviewImage(a), ServiceError)
  assertEquals(err.status, 403)
  assertEquals(calls.length, 0)
})

Deno.test('uploadPreviewImage: rejects non-JPEG, malformed and oversized data', async () => {
  const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47))
  const huge = btoa(String.fromCharCode(0xff, 0xd8, 0xff) + 'a'.repeat(MAX_PREVIEW_IMAGE_BYTES))
  for (const image of [png, 'not base64!', undefined, huge]) {
    const { args: a, calls } = args({ image })
    const err = await assertRejects(() => uploadPreviewImage(a), ServiceError)
    assertEquals(err.status, 400)
    assertEquals(calls.length, 0)
  }
})

// Value: protects=a store connected the new way (store id only, no token) can be written; fails_when=storeId isn't passed when there's no token; why_new=Vercel connects Blob with OIDC; seam=@vercel/blob put
Deno.test('uploadPreviewImage: without a token, writes to the connected store by id', async () => {
  const { args: a, calls } = args({ blobToken: undefined, blobStoreId: 'store_abc' })
  assertEquals(await uploadPreviewImage(a), { url: URL_OUT })
  assertEquals(calls[0][2], { access: 'public', contentType: 'image/jpeg', addRandomSuffix: true, storeId: 'store_abc' })
})

Deno.test('uploadPreviewImage: storage failures are retryable; no token or store id is a config error', async () => {
  const failing = args({ put: async () => { throw new Error('boom') } }).args
  const err = await assertRejects(() => uploadPreviewImage(failing), ServiceError)
  assertEquals([err.status, err.retryable], [502, true])
  const unconfigured = args({ blobToken: undefined }).args
  assertEquals((await assertRejects(() => uploadPreviewImage(unconfigured), ServiceError)).status, 500)
})
