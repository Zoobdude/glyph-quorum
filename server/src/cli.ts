/**
 * Recovery tool for when nobody can reach the admin centre:
 *   npm -w server run make-admin -- someone@example.com
 * Safe to run while the server is up.
 */
import { db } from './db.js'

const email = process.argv[2]
if (!email) { console.error('Usage: npm -w server run make-admin -- <email>'); process.exit(1) }
const result = db.prepare("UPDATE users SET role = 'admin', disabled_at = NULL WHERE email = ?").run(email)
console.log(result.changes ? `${email} is now an administrator.` : `No account found for ${email}.`)
process.exit(result.changes ? 0 : 1)
