import { db } from './db.js'
import type { User } from './auth.js'

const insert = db.prepare('INSERT INTO audit_log (at, actor_id, actor_name, action, detail) VALUES (?, ?, ?, ?, ?)')
const recent = db.prepare('SELECT id, at, actor_name AS actorName, action, detail FROM audit_log ORDER BY id DESC LIMIT ?')
const prune = db.prepare('DELETE FROM audit_log WHERE id <= (SELECT id FROM audit_log ORDER BY id DESC LIMIT 1 OFFSET 5000)')

/** Record an administrative action (who did what, to whom). */
export function audit(actor: Pick<User, 'id' | 'name'> | null, action: string, detail = ''): void {
  insert.run(Date.now(), actor?.id ?? null, actor?.name ?? 'System', action, detail.slice(0, 500))
  prune.run()
}

export const recentAudit = (limit = 100) => recent.all(Math.min(500, Math.max(1, limit)))
