import { Router } from 'express'
import {
  requireUser, startSession, endSession, endOtherSessions,
  findUserByEmail, createUser, verifyPassword, fakeVerify, saveProfile, checkUserPassword, changePassword,
  USER_COLORS,
} from '../auth.js'
import { h, str, HttpError, rateLimit, allow } from '../security.js'
import { getSettings, setupRequired } from '../settings.js'
import { findInvite, inviteProblem, claimInvite, releaseInvite } from '../admin.js'
import { audit } from '../audit.js'
import { me, byUser, publicUser, email, password } from './common.js'

/** Sign-up, sign-in, sign-out and profile. The first three are the only routes reachable without a session. */
export const accounts = Router()
const router = accounts

/** Everything the client needs to decide which screen to show. Safe to expose to signed-out visitors. */
router.get('/auth/me', (req, res) => {
  const { serverName, registration } = getSettings()
  res.json({
    user: req.user ? publicUser(req.user) : null,
    setupRequired: setupRequired(),
    serverName,
    registration,
    colors: USER_COLORS,
  })
})

/** Lets the sign-up page show who an invite is for before the form is filled in. */
router.get('/auth/invite/:token', rateLimit('invite-check', 30, 15 * 60_000), h((req, res) => {
  const invite = findInvite(req.params.token)
  const problem = inviteProblem(invite)
  if (problem) throw new HttpError(404, problem)
  res.json({ email: invite!.email })
}))

router.post('/auth/register', rateLimit('register', 10, 3600_000), h(async (req, res) => {
  if (setupRequired()) throw new HttpError(409, 'This server has not been set up yet')
  const { registration } = getSettings()
  const token = typeof req.body.invite === 'string' ? req.body.invite : ''
  const invite = token ? findInvite(token) : undefined

  const addr = email(req.body.email)
  const name = str(req.body.name, 'Name', 1, 60)
  const pw = password(req.body.password)

  if (token) {
    const problem = inviteProblem(invite, addr)
    if (problem) throw new HttpError(403, problem)
  } else if (registration === 'invite') {
    throw new HttpError(403, 'You need an invite link to create an account on this server')
  }
  if (registration === 'closed') throw new HttpError(403, 'Registration is closed on this server')
  if (findUserByEmail(addr)) throw new HttpError(409, 'An account with that email already exists')

  if (token && !claimInvite(token)) throw new HttpError(403, 'This invite link has already been used.')
  let user
  try {
    user = await createUser(addr, name, pw, invite?.role ?? 'user')
  } catch (e) {
    if (token) releaseInvite(token)
    throw e
  }
  if (invite) audit(user, 'invite.accepted', `${user.email} joined as ${user.role}`)
  startSession(req, res, user.id)
  res.status(201).json({ user: publicUser(user) })
}))

router.post('/auth/login', rateLimit('login-ip', 30, 15 * 60_000), h(async (req, res) => {
  const addr = email(req.body.email)
  const pw = typeof req.body.password === 'string' ? req.body.password.slice(0, 200) : ''
  // Per-account limit as well, so one address cannot be brute-forced from many IPs.
  if (!allow(`login-email:${addr}`, 10, 15 * 60_000)) throw new HttpError(429, 'Too many sign-in attempts — try again in a few minutes.')
  const user = findUserByEmail(addr)
  const ok = user ? await verifyPassword(pw, user.passwordHash) : (await fakeVerify(pw), false)
  if (!user || !ok) throw new HttpError(401, 'Incorrect email or password')
  if (user.disabledAt) throw new HttpError(403, 'This account has been disabled. Contact an administrator.')
  startSession(req, res, user.id)
  res.json({ user: publicUser(user) })
}))

router.post('/auth/logout', (req, res) => {
  endSession(req, res)
  res.json({ ok: true })
})

// ── Signed-in account management ─────────────────────────────────────────────

router.patch('/auth/me', requireUser, h((req, res) => {
  const user = { ...me(req) }
  if (req.body.name !== undefined) user.name = str(req.body.name, 'Name', 1, 60)
  if (req.body.color !== undefined) {
    if (!USER_COLORS.includes(req.body.color)) throw new HttpError(400, 'Unknown colour')
    user.color = req.body.color
  }
  saveProfile(user)
  res.json({ user: publicUser(user) })
}))

router.post('/auth/password', requireUser, rateLimit('password', 10, 15 * 60_000, byUser), h(async (req, res) => {
  const next = password(req.body.next, 'New password')
  if (!(await checkUserPassword(me(req).id, String(req.body.current ?? '').slice(0, 200)))) {
    throw new HttpError(403, 'Current password is incorrect')
  }
  await changePassword(me(req).id, next)
  endOtherSessions(me(req).id, req.sessionHash!) // sign out everywhere else
  res.json({ ok: true })
}))
