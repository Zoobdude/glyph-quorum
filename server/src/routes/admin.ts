import { Router, type Request } from 'express'
import { requireAdmin, findUserByEmail, createUser, changePassword, signOutEverywhere, type User } from '../auth.js'
import { h, str, HttpError, rateLimit } from '../security.js'
import { ID_RE } from '../db.js'
import { getSettings, saveSettings, REGISTRATION_MODES, type RegistrationMode, type ServerSettings } from '../settings.js'
import {
  listUsers, getUser, activeAdminCount, setRole, setName, setDisabled, deleteUser, overview, temporaryPassword,
  createInvite, listInvites, revokeInvite, type UserRecord,
} from '../admin.js'
import { audit, recentAudit } from '../audit.js'
import { me, byUser, email } from './common.js'

/** The admin centre: server overview, user management, invites and settings. Administrators only. */
export const admin = Router()
admin.use('/admin', requireAdmin)

const role = (v: unknown): User['role'] => {
  if (v !== 'admin' && v !== 'user') throw new HttpError(400, 'Invalid role')
  return v
}

/** The account named in the URL. */
function target(req: Request): UserRecord {
  const user = ID_RE.test(req.params.userId) ? getUser(req.params.userId) : undefined
  if (!user) throw new HttpError(404, 'User not found')
  return user
}

/** Refuse changes that would leave the server with nobody able to administer it. */
function protectLastAdmin(user: UserRecord): void {
  if (user.role === 'admin' && !user.disabledAt && activeAdminCount() <= 1) {
    throw new HttpError(409, 'This is the only administrator. Make someone else an administrator first.')
  }
}

// ── Overview ─────────────────────────────────────────────────────────────────

admin.get('/admin/overview', h((_req, res) => {
  res.json({ stats: overview(), activity: recentAudit(12) })
}))

admin.get('/admin/audit', h((req, res) => {
  res.json({ entries: recentAudit(Number(req.query.limit) || 200) })
}))

// ── Users ────────────────────────────────────────────────────────────────────

admin.get('/admin/users', h((_req, res) => {
  res.json({ users: listUsers() })
}))

/** Create an account on someone's behalf. The temporary password is returned once and never stored in clear. */
admin.post('/admin/users', rateLimit('admin-create', 60, 3600_000, byUser), h(async (req, res) => {
  const addr = email(req.body.email)
  const name = str(req.body.name, 'Name', 1, 60)
  const r = role(req.body.role ?? 'user')
  if (findUserByEmail(addr)) throw new HttpError(409, 'An account with that email already exists')
  const pw = temporaryPassword()
  const user = await createUser(addr, name, pw, r)
  audit(me(req), 'user.created', `${user.email} (${r})`)
  res.status(201).json({ user, temporaryPassword: pw })
}))

admin.patch('/admin/users/:userId', h((req, res) => {
  const user = target(req)
  const self = user.id === me(req).id
  const body = req.body as { role?: unknown; disabled?: unknown; name?: unknown }

  if (body.name !== undefined) {
    const name = str(body.name, 'Name', 1, 60)
    setName(user.id, name)
    audit(me(req), 'user.renamed', `${user.email}: ${user.name} → ${name}`)
  }
  if (body.role !== undefined && role(body.role) !== user.role) {
    if (self) throw new HttpError(400, 'You cannot change your own role. Ask another administrator.')
    if (body.role === 'user') protectLastAdmin(user)
    setRole(user.id, role(body.role))
    audit(me(req), 'user.role', `${user.email} is now ${body.role === 'admin' ? 'an administrator' : 'a standard user'}`)
  }
  if (body.disabled !== undefined && (body.disabled === true) !== !!user.disabledAt) {
    if (self) throw new HttpError(400, 'You cannot disable your own account.')
    if (body.disabled === true) protectLastAdmin(user)
    setDisabled(user.id, body.disabled === true) // disabling also signs the user out everywhere
    audit(me(req), body.disabled === true ? 'user.disabled' : 'user.enabled', user.email)
  }
  res.json({ ok: true })
}))

/** Replace a user's password with a fresh temporary one and sign them out everywhere. */
admin.post('/admin/users/:userId/reset-password', rateLimit('admin-reset', 30, 3600_000, byUser), h(async (req, res) => {
  const user = target(req)
  const pw = temporaryPassword()
  await changePassword(user.id, pw)
  if (user.id !== me(req).id) signOutEverywhere(user.id)
  audit(me(req), 'user.password-reset', user.email)
  res.json({ temporaryPassword: pw })
}))

/** Sign a user out of every device without changing anything else. */
admin.post('/admin/users/:userId/sign-out', h((req, res) => {
  const user = target(req)
  signOutEverywhere(user.id)
  audit(me(req), 'user.signed-out', user.email)
  res.json({ ok: true })
}))

/** Delete an account. `?documents=delete` removes its documents too; the default hands them to the acting admin. */
admin.delete('/admin/users/:userId', h((req, res) => {
  const user = target(req)
  if (user.id === me(req).id) throw new HttpError(400, 'You cannot delete your own account from here.')
  protectLastAdmin(user)
  const result = deleteUser(user.id, req.query.documents === 'delete' ? null : me(req).id)
  audit(me(req), 'user.deleted', `${user.email}; ${result.transferred ? `${result.transferred} document(s) transferred` : `${result.deleted} document(s) deleted`}`)
  res.json(result)
}))

// ── Invites ──────────────────────────────────────────────────────────────────

admin.get('/admin/invites', h((_req, res) => {
  res.json({ invites: listInvites() })
}))

/** The invite token is only ever returned here; the database keeps a hash. */
admin.post('/admin/invites', rateLimit('admin-invite', 120, 3600_000, byUser), h((req, res) => {
  const addr = req.body.email ? email(req.body.email) : null
  if (addr && findUserByEmail(addr)) throw new HttpError(409, 'An account with that email already exists')
  const days = Math.min(90, Math.max(1, Math.round(Number(req.body.days) || 7)))
  const maxUses = addr ? 1 : Math.min(500, Math.max(1, Math.round(Number(req.body.maxUses) || 1)))
  const { invite, token } = createInvite(me(req), { email: addr, role: role(req.body.role ?? 'user'), days, maxUses })
  audit(me(req), 'invite.created', `${addr ?? `${maxUses} use(s)`}, ${invite.role}, ${days} day(s)`)
  res.status(201).json({ invite, token })
}))

admin.delete('/admin/invites/:inviteId', h((req, res) => {
  if (!ID_RE.test(req.params.inviteId) || !revokeInvite(req.params.inviteId)) throw new HttpError(404, 'Invite not found')
  audit(me(req), 'invite.revoked')
  res.json({ ok: true })
}))

// ── Settings ─────────────────────────────────────────────────────────────────

admin.get('/admin/settings', h((_req, res) => {
  res.json({ settings: getSettings() })
}))

admin.patch('/admin/settings', h((req, res) => {
  const patch: Partial<ServerSettings> = {}
  if (req.body.serverName !== undefined) patch.serverName = str(req.body.serverName, 'Server name', 1, 40)
  if (req.body.registration !== undefined) {
    if (!REGISTRATION_MODES.includes(req.body.registration)) throw new HttpError(400, 'Invalid registration mode')
    patch.registration = req.body.registration as RegistrationMode
  }
  const settings = saveSettings(patch)
  audit(me(req), 'settings.changed', Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(', '))
  res.json({ settings })
}))
