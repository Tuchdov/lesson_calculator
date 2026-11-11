import { verifyCaller, ServiceError } from './paymentLinkService.js'

// The browser shrinks the photo and re-encodes it as JPEG before sending, so
// anything bigger or not a JPEG didn't come from the app.
export const MAX_PREVIEW_IMAGE_BYTES = 1024 * 1024
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

function decodeJpeg(base64) {
  if (typeof base64 !== 'string' || !BASE64.test(base64)) return null
  if (base64.length > Math.ceil(MAX_PREVIEW_IMAGE_BYTES / 3) * 4) return null
  let bytes
  try {
    bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null
  return bytes
}

// Stores the WhatsApp preview photo publicly — the preview bot can't sign in —
// and returns its URL. Each upload gets a new name, so links already sent keep
// the photo they were sent with. `put` is @vercel/blob's, injected for tests.
export async function uploadPreviewImage({
  accessToken,
  image,
  allowedEmail,
  clientId,
  blobToken,
  blobStoreId,
  put,
  fetchImpl = fetch,
}) {
  await verifyCaller(accessToken, { allowedEmail, clientId, fetchImpl })

  const bytes = decodeJpeg(image)
  if (!bytes) throw new ServiceError(400, 'The photo must be a JPEG under 1 MB.')

  if (!blobToken && !blobStoreId) throw new ServiceError(500, 'Photo storage is not configured.')

  let result
  try {
    result = await put('preview/photo.jpg', bytes, {
      access: 'public',
      contentType: 'image/jpeg',
      addRandomSuffix: true,
      ...(blobToken ? { token: blobToken } : { storeId: blobStoreId }),
    })
  } catch {
    throw new ServiceError(502, 'Could not save the photo. Try again.', { retryable: true })
  }
  return { url: result.url }
}
