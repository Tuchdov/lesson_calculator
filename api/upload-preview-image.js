import { put } from '@vercel/blob'
import { ServiceError } from '../src/api/paymentLinkService.js'
import { uploadPreviewImage } from '../src/api/previewImageService.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authHeader = req.headers.authorization || ''
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const { image } = req.body ?? {}

  try {
    const result = await uploadPreviewImage({
      accessToken,
      image,
      allowedEmail: process.env.ALLOWED_EMAIL,
      clientId: process.env.VITE_GOOGLE_CLIENT_ID,
      // The store was connected in Vercel with the PICTURE prefix. Connected
      // stores sign in with Vercel's OIDC token plus the store id; a
      // read-write token, if one is ever added, is used instead.
      blobToken: process.env.PICTURE_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN,
      blobStoreId: process.env.PICTURE_BLOB_STORE_ID || process.env.BLOB_STORE_ID,
      put,
    })
    res.status(200).json(result)
  } catch (err) {
    if (err instanceof ServiceError) {
      res.status(err.status).json({ error: err.message, retryable: !!err.retryable })
      return
    }
    res.status(500).json({ error: 'Unexpected server error.' })
  }
}
