// Browser side of the WhatsApp preview photo: shrink it, then hand it to
// /api/upload-preview-image. Glue only a running app can exercise; the server
// checks live in src/api/previewImageService.js.

// WhatsApp shows the photo as a wide card and skips images that are too big.
const MAX_SIDE = 1200
const JPEG_QUALITY = 0.85

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
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

export async function uploadPreviewImage(getAccessToken, file) {
  let image
  try {
    image = await toJpegBase64(file)
  } catch {
    throw new Error('Could not read that file as an image.')
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
