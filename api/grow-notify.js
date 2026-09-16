// Grow's Create Payment Link requires a Notify URL and retries delivery at
// roughly 10, 20, and 30 minutes if nothing acknowledges it. Paid-status
// tracking is out of scope for now (see TODOS.md), so this just accepts the
// callback and returns 200 to stop the retries — the payload isn't read.
export default function handler(req, res) {
  res.status(200).json({ received: true })
}
