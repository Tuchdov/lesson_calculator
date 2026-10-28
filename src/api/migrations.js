import { transaction, query } from './db.js'

export async function migrate(db, migrations) {
  await db.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL)')
  return transaction(db, async tx => {
    const applied = await query(tx, 'SELECT * FROM schema_migrations ORDER BY version')
    for (const row of applied) {
      const migration = migrations.find(m => m.version === row.version)
      if (!migration || migration.checksum !== row.checksum) throw new Error('Unknown or modified database migration. Refusing to continue.')
    }
    for (const migration of migrations) {
      if (applied.some(m => m.version === migration.version)) continue
      for (const sql of migration.sql.split(';').map(s => s.trim()).filter(Boolean)) await tx.execute(sql)
      await tx.execute({ sql: 'INSERT INTO schema_migrations(version,checksum) VALUES(?,?)', args: [migration.version, migration.checksum] })
    }
  })
}
