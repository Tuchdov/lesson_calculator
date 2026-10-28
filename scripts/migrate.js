import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createDatabase } from '../src/api/db.js'
import { migrate } from '../src/api/migrations.js'

export async function readMigrations() {
  const directory = new URL('../db/migrations/', import.meta.url)
  return Promise.all((await readdir(directory)).filter(f => /^\d+.*\.sql$/.test(f)).sort().map(async file => {
    const sql = await readFile(new URL(file, directory), 'utf8')
    return { version: Number(file.split('_')[0]), sql, checksum: createHash('sha256').update(sql).digest('hex') }
  }))
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  const db = createDatabase({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  try {
    await migrate(db, await readMigrations())
    console.log('Billing migrations applied. New databases start in recovery mode; reconcile and explicitly enable collection.')
  } finally {
    db.close()
  }
}
