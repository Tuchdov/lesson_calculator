import { readPaymentLink, renderPaymentPage, renderNotFoundPage } from '../src/lib/payRedirect.js'

// Public on purpose: students and WhatsApp's preview bot open this without
// signing in. The signature, not a login, is what makes a link genuine.
export default async function handler(req, res) {
  const { g, t, s } = req.query ?? {}
  const link = await readPaymentLink({ g, t, s }, process.env.PAY_LINK_SECRET)

  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('X-Robots-Tag', 'noindex')
  res.setHeader('Referrer-Policy', 'no-referrer')

  if (!link) {
    res.status(404).send(renderNotFoundPage())
    return
  }
  res.setHeader('Cache-Control', 'public, max-age=3600')
  res.status(200).send(renderPaymentPage(link))
}
