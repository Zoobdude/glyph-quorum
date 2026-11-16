import { createHash, randomBytes } from 'crypto'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import { db, newId, ASSETS_DIR } from './db.js'
import { signOutEverywhere, liveUserCount, type User } from './auth.js'
import { deleteDocument } from './documents.js'
import { hocuspocus } from './hocuspocus.js'

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/** A random password that is easy to read out or type: 4 groups of 4 unambiguous characters (~80 bits). */
export function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(16)
  let out = ''
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % alphabet.length] + (i % 4 === 3 && i < 15 ? '-' : '')
  return out
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface AdminUserRow extends User {
  createdAt: number
  lastLoginAt: number | null
  disabledAt: number | null
  documents: number
  storage: number
}

const selectUsers = db.prepare(`
  SELECT u.id, u.email, u.name, u.color, u.role, u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
         u.disabled_at AS disabledAt, (SELECT COUNT(*) FROM documents d WHERE d.owner_id = u.id) AS documents
  FROM users u ORDER BY u.created_at`)
const selectUser = db.prepare('SELECT id, email, name, color, role, disabled_at AS disabledAt FROM users WHERE id = ?')
const countActiveAdmins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL")
const setRoleStmt = db.prepare('UPDATE users SET role = ? WHERE id = ?')
const setDisabledStmt = db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?')
const setNameStmt = db.prepare('UPDATE users SET name = ? WHERE id = ?')
const ownedDocIds = db.prepare('SELECT id FROM documents WHERE owner_id = ?')
const transferDocs = db.prepare('UPDATE documents SET owner_id = ? WHERE owner_id = ?')
const dropRedundantMemberships = db.prepare('DELETE FROM doc_members WHERE user_id = ? AND doc_id IN (SELECT id FROM documents WHERE owner_id = ?)')
const deleteUserStmt = db.prepare('DELETE FROM users WHERE id = ?')
const docOwners = db.prepare('SELECT id, owner_id AS ownerId FROM documents')

export type UserRecord = User & { disabledAt: number | null }
export const getUser = (id: string) => selectUser.get(id) as UserRecord | undefined
export const activeAdminCount = (): number => (countActiveAdmins.get() as { n: number }).n

// Walking every asset folder is not free, so storage figures are cached briefly.
let storageCache: { at: number; byDoc: Map<string, number> } | null = null
function storageByDoc(): Map<string, number> {
  if (storageCache && Date.now() - storageCache.at < 60_000) return storageCache.byDoc
  const byDoc = new Map<string, number>()
  for (const dir of readdirSync(ASSETS_DIR)) {
    let total = 0
    try { for (const f of readdirSync(join(ASSETS_DIR, dir))) total += statSync(join(ASSETS_DIR, dir, f)).size } catch {}
    byDoc.set(dir, total)
  }
  storageCache = { at: Date.now(), byDoc }
  return byDoc
}

export function listUsers(): AdminUserRow[] {
  const byDoc = storageByDoc()
  const byOwner = new Map<string, number>()
  for (const d of docOwners.all() as { id: string; ownerId: string }[]) byOwner.set(d.ownerId, (byOwner.get(d.ownerId) ?? 0) + (byDoc.get(d.id) ?? 0))
  return (selectUsers.all() as Omit<AdminUserRow, 'storage'>[]).map(u => ({ ...u, storage: byOwner.get(u.id) ?? 0 }))
}

export function setRole(userId: string, role: User['role']): void { setRoleStmt.run(role, userId) }
export function setName(userId: string, name: string): void { setNameStmt.run(name, userId) }

export function setDisabled(userId: string, disabled: boolean): void {
  setDisabledStmt.run(disabled ? Date.now() : null, userId)
  if (disabled) signOutEverywhere(userId)
}

/**
 * Delete an account. Its documents are either handed to `transferTo` or deleted with it.
 * Documents shared with the user simply lose that member.
 */
export function deleteUser(userId: string, transferTo: string | null): { transferred: number; deleted: number } {
  signOutEverywhere(userId)
  const owned = (ownedDocIds.all(userId) as { id: string }[]).map(r => r.id)
  if (transferTo) {
    db.transaction(() => {
      transferDocs.run(transferTo, userId)
      dropRedundantMemberships.run(transferTo, transferTo)
      deleteUserStmt.run(userId)
    })()
    // Live editors re-connect and are re-authorised against the new owner.
    for (const id of owned) hocuspocus.closeConnections(id)
    return { transferred: owned.length, deleted: 0 }
  }
  for (const id of owned) { hocuspocus.closeConnections(id); deleteDocument(id) }
  deleteUserStmt.run(userId)
  storageCache = null
  return { transferred: 0, deleted: owned.length }
}

// ── Overview ─────────────────────────────────────────────────────────────────

const counts = db.prepare(`SELECT
  (SELECT COUNT(*) FROM users) AS users,
  (SELECT COUNT(*) FROM users WHERE role = 'admin') AS admins,
  (SELECT COUNT(*) FROM users WHERE disabled_at IS NOT NULL) AS disabled,
  (SELECT COUNT(*) FROM users WHERE last_login_at > @week) AS activeWeek,
  (SELECT COUNT(*) FROM documents WHERE trashed_at IS NULL) AS documents,
  (SELECT COUNT(*) FROM documents WHERE trashed_at IS NOT NULL) AS trashed,
  (SELECT COUNT(*) FROM documents WHERE updated_at > @week) AS editedWeek,
  (SELECT COUNT(*) FROM sessions WHERE expires_at > @now) AS sessions`)
const dbSize = db.prepare('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()')

export function overview() {
  const now = Date.now()
  const c = counts.get({ now, week: now - 7 * 86400_000 }) as Record<string, number>
  let files = 0
  for (const v of storageByDoc().values()) files += v
  return {
    ...c,
    liveUsers: liveUserCount(),
    openDocuments: hocuspocus.getDocumentsCount(),
    storage: { database: (dbSize.get() as { bytes: number }).bytes, files },
    uptime: Math.round(process.uptime()),
    version: process.env.npm_package_version ?? '0.1.0',
  }
}

// ── Invites ──────────────────────────────────────────────────────────────────

export interface Invite {
  id: string
  email: string | null
  role: User['role']
  createdBy: string | null
  createdAt: number
  expiresAt: number
  maxUses: number
  uses: number
  revokedAt: number | null
}

const INVITE_COLS = `i.id, i.email, i.role, u.name AS createdBy, i.created_at AS createdAt, i.expires_at AS expiresAt,
  i.max_uses AS maxUses, i.uses, i.revoked_at AS revokedAt`
const insertInvite = db.prepare(`INSERT INTO invites (token_hash, id, email, role, created_by, created_at, expires_at, max_uses)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
const selectInvites = db.prepare(`SELECT ${INVITE_COLS} FROM invites i LEFT JOIN users u ON u.id = i.created_by ORDER BY i.created_at DESC LIMIT 200`)
const selectInviteByToken = db.prepare(`SELECT ${INVITE_COLS} FROM invites i LEFT JOIN users u ON u.id = i.created_by WHERE i.token_hash = ?`)
const revokeInviteStmt = db.prepare('UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
const useInvite = db.prepare('UPDATE invites SET uses = uses + 1 WHERE token_hash = ? AND uses < max_uses AND revoked_at IS NULL AND expires_at > ?')
const refundInvite = db.prepare('UPDATE invites SET uses = uses - 1 WHERE token_hash = ? AND uses > 0')
const pruneInvites = db.prepare('DELETE FROM invites WHERE expires_at < ?')

setInterval(() => pruneInvites.run(Date.now() - 30 * 86400_000), 3600_000).unref()

export function createInvite(by: User, opts: { email: string | null; role: User['role']; days: number; maxUses: number }): { invite: Invite; token: string } {
  const token = randomBytes(24).toString('base64url')
  const id = newId()
  const now = Date.now()
  insertInvite.run(sha256(token), id, opts.email, opts.role, by.id, now, now + opts.days * 86400_000, opts.maxUses)
  return { token, invite: listInvites().find(i => i.id === id)! }
}

export const listInvites = () => selectInvites.all() as Invite[]
export const revokeInvite = (id: string): boolean => revokeInviteStmt.run(Date.now(), id).changes === 1

/** Why an invite cannot be used, or null when it is valid (optionally for a specific email address). */
export function inviteProblem(invite: Invite | undefined, email?: string): string | null {
  if (!invite || invite.revokedAt) return 'This invite link is not valid. Ask an administrator for a new one.'
  if (invite.expiresAt < Date.now()) return 'This invite link has expired. Ask an administrator for a new one.'
  if (invite.uses >= invite.maxUses) return 'This invite link has already been used.'
  if (email && invite.email && invite.email.toLowerCase() !== email.toLowerCase()) return `This invite is for ${invite.email}.`
  return null
}

export const findInvite = (token: string): Invite | undefined =>
  token.length > 0 && token.length < 100 ? selectInviteByToken.get(sha256(token)) as Invite | undefined : undefined

/** Atomically take one use of an invite. Returns false if it was used up or revoked in the meantime. */
export const claimInvite = (token: string): boolean => useInvite.run(sha256(token), Date.now()).changes === 1
export const releaseInvite = (token: string): void => { refundInvite.run(sha256(token)) }
