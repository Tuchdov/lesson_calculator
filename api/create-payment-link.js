import { createPaymentLink, ServiceError } from '../src/api/paymentLinkService.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const authHeader = req.headers.authorization || ''
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  const { studentName, phone, amount, month } = req.body ?? {}

  try {
    const result = await createPaymentLink({
      accessToken,
      studentName,
      phone,
      amount,
      month,
      allowedEmail: process.env.ALLOWED_EMAIL,
      clientId: process.env.VITE_GOOGLE_CLIENT_ID,
      webhookUrl: process.env.MAKE_WEBHOOK_URL,
      apiKey: process.env.MAKE_API_KEY,
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
