// Dev utility: verify the migration chain applies cleanly to a fresh SQLite DB
// (mirrors what `wrangler d1 migrations apply` does on a fresh D1 database, and
// what the dev mock D1 does on boot). Run: node scripts/test-migrations.mjs
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
const dir = path.join(process.cwd(), 'migrations')
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
const verbose = process.argv.includes('--statements')

let failed = false
for (const f of files) {
  const sql = fs.readFileSync(path.join(dir, f), 'utf8')
  try {
    db.exec(sql)
    console.log('OK   ' + f)
  } catch (e) {
    failed = true
    console.log('FAIL ' + f + ' :: ' + e.message)
    if (verbose) {
      // naive statement split to locate the failing statement
      const statements = sql.split(/;\s*(?:\r?\n|$)/)
      for (const st of statements) {
        const trimmed = st.trim()
        if (!trimmed) continue
        try {
          db.exec(trimmed + ';')
        } catch (err) {
          console.log('  STMT FAIL: ' + err.message)
          console.log('  ' + trimmed.slice(0, 200).replace(/\s+/g, ' '))
        }
      }
    }
  }
}
process.exit(failed ? 1 : 0)
