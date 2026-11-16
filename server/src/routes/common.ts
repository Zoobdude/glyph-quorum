import type { Request } from 'express'
import type { User } from '../auth.js'
import { HttpError, str } from '../security.js'
import { ID_RE } from '../db.js'
import { getAccess, RANK, type DocRow, type Role } from '../documents.js'

/** Largest document text accepted for creation or compilation. */
export const MAX_CONTENT = 2 * 1024 * 1024

/** The signed-in user. Only call in routes registered after `requireUser`. */
export const me = (req: Request): User => req.user!
/** Rate-limit key for per-user limits. */
export const byUser = (req: Request): string => req.user!.id

export const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, color: u.color, role: u.role })

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function email(v: unknown): string {
  const e = str(v, 'Email', 3, 254).toLowerCase()
  if (!EMAIL_RE.test(e)) throw new HttpError(400, 'Enter a valid email address')
  return e
}

export function password(v: unknown, field = 'Password'): string {
  if (typeof v !== 'string' || v.length < 8) throw new HttpError(400, `${field} must be at least 8 characters`)
  if (v.length > 200) throw new HttpError(400, `${field} must be at most 200 characters`)
  return v
}

/** Resolve the document in the URL (`:id`) and check the caller holds at least `min` on it. */
export function access(req: Request, min: Role = 'viewer'): { doc: DocRow; role: Role } {
  const id = req.params.id
  const found = ID_RE.test(id) ? getAccess(me(req).id, id) : null
  // 404 for both "missing" and "no access", so document ids cannot be probed.
  if (!found) throw new HttpError(404, 'Document not found')
  if (RANK[found.role] < RANK[min]) throw new HttpError(403, min === 'owner' ? 'Only the owner can do that' : 'You have view-only access to this document')
  return found
}
