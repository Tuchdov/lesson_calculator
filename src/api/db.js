import { createClient } from '@libsql/client'
import { ServiceError } from './serviceError.js'

// Server-only: callers supply environment values; never import from React code.
export function createDatabase({ url, authToken }) {
  if (!url) throw new ServiceError(503, 'Billing database is not configured.')
  return createClient({ url, authToken, intMode: 'number' })
}

export async function transaction(db, work, mode = 'write') {
  const tx = await db.transaction(mode)
  try {
    const result = await work(tx)
    await tx.commit()
    return result
  } finally {
    tx.close()
  }
}

export async function query(db, sql, args = []) {
  return (await db.execute({ sql, args })).rows
}

export async function one(db, sql, args = []) {
  return (await query(db, sql, args))[0] ?? null
}
