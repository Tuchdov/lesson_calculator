import { createDatabase, one, transaction } from '../src/api/db.js'

const environment = process.env.GROW_ENVIRONMENT
const merchant = process.env.GROW_MERCHANT_ID
if (!['sandbox', 'production'].includes(environment) || !merchant) throw new Error('Set GROW_ENVIRONMENT and GROW_MERCHANT_ID first.')
const enable = process.argv.includes('--enable-collection')
if (enable && !process.env.BILLING_RECONCILIATION_NOTE?.trim()) throw new Error('BILLING_RECONCILIATION_NOTE is required to confirm the setup/recovery checklist.')
const db = createDatabase({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
try {
  await transaction(db, async tx => {
    const control = await one(tx, 'SELECT * FROM billing_control WHERE id=1')
    if (control.environment && (control.environment !== environment || control.merchant !== merchant)) throw new Error('Refusing to rebind this ledger to another environment/merchant.')
    await tx.execute({ sql: 'UPDATE billing_control SET environment=?,merchant=?,mode=?,checkpoint=?,signed_off_at=? WHERE id=1', args: [environment, merchant, enable ? 'normal' : 'recovery', enable ? process.env.BILLING_RECONCILIATION_NOTE : control.checkpoint, enable ? new Date().toISOString() : null] })
  })
  console.log(enable ? 'Billing checkpoint signed off. Collection still requires BILLING_MODE=live on the server.' : 'Database bound to its environment/merchant. Collection remains in recovery mode.')
} finally { db.close() }
