// Browser side of the WhatsApp preview photo: shrink it, then hand it to
// /api/upload-preview-image. Glue only a running app can exercise; the server
// checks live in src/api/previewImageService.js.

// WhatsApp shows the photo as a wide card and skips images that are too big.
const MAX_SIDE = 1200
const JPEG_QUALITY = 0.85
// Mirrors MAX_PREVIEW_IMAGE_BYTES in src/api/previewImageService.js, so a photo
// the server would refuse is turned away here with a clear message instead.
const MAX_JPEG_BYTES = 1024 * 1024
class TooLargeError extends Error {}

async function toJpegBase64(file) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  // JPEG has no transparency; a white backdrop beats black for PNG logos.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  if (base64.length * 3 / 4 > MAX_JPEG_BYTES) throw new TooLargeError()
  return base64
}

export async function uploadPreviewImage(getAccessToken, file) {
  let image
  try {
    image = await toJpegBase64(file)
  } catch (err) {
    if (err instanceof TooLargeError) throw new Error('That photo is too large. Choose a smaller or simpler one.', { cause: err })
    throw new Error('Could not read that file as an image.', { cause: err })
  }
  const token = await getAccessToken()
  const res = await fetch('/api/upload-preview-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`)
  return body.url
}
