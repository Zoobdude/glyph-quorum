import { scrypt, randomBytes, timingSafeEqual, createHash } from 'crypto'
import type { IncomingMessage } from 'http'
import type { Request, Response, NextFunction } from 'express'
import { db, newId } from './db.js'

export interface User {
  id: string
  email: string
  name: string
  color: string
  role: 'admin' | 'user'
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User
    sessionHash?: string
  }
}

export const USER_COLORS = ['#2563eb', '#16a34a', '#dc2626', '#ea580c', '#7c3aed', '#0891b2', '#be185d', '#4d7c0f']

// ── Password hashing (scrypt, per-password random salt) ──────────────────────

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }
const KEY_LEN = 32

function scryptAsync(password: string, salt: Buffer, opts = SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LEN, opts, (err, key) => (err ? reject(err) : resolve(key))))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt') return false
  const expected = Buffer.from(hash, 'base64')
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Burn the same CPU as a real check so unknown emails are not distinguishable by timing. */
let dummyHash: Promise<string> | null = null
export async function fakeVerify(password: string): Promise<void> {
  dummyHash ??= hashPassword(randomBytes(8).toString('hex'))
  await verifyPassword(password, await dummyHash)
}

// ── Sessions (opaque random token in an HttpOnly cookie; only its hash is stored) ──

export const SESSION_COOKIE = 'gq_session'
const SESSION_TTL = 30 * 24 * 3600 * 1000

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

const insertSession = db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
const selectSession = db.prepare(`
  SELECT u.id, u.email, u.name, u.color, u.role, s.expires_at AS expiresAt
  FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.disabled_at IS NULL`)
const extendSession = db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?')
const deleteOtherSessions = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
const deleteUserSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?')
const touchLogin = db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
const purgeSessions = db.prepare('DELETE FROM sessions WHERE expires_at < ?')

setInterval(() => purgeSessions.run(Date.now()), 3600_000).unref()

function setCookie(req: Request, res: Response, token: string, maxAgeMs: number) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: maxAgeMs,
  })
}

export function startSession(req: Request, res: Response, userId: string): void {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  insertSession.run(sha256(token), userId, now, now + SESSION_TTL)
  touchLogin.run(now, userId)
  setCookie(req, res, token, SESSION_TTL)
}

export function endSession(req: Request, res: Response): void {
  if (req.sessionHash) deleteSession.run(req.sessionHash)
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

export function endOtherSessions(userId: string, keepHash: string): void {
  deleteOtherSessions.run(userId, keepHash)
}

// ── Live connections per user ────────────────────────────────────────────────

const sockets = new Map<string, Set<{ close(code?: number, reason?: string): void }>>()

/** Remember a user's open WebSocket so it can be cut off when their account changes. */
export function trackSocket(userId: string, ws: { close(code?: number, reason?: string): void; once(event: 'close', cb: () => void): unknown }): void {
  let set = sockets.get(userId)
  if (!set) sockets.set(userId, (set = new Set()))
  set.add(ws)
  ws.once('close', () => { set!.delete(ws); if (set!.size === 0) sockets.delete(userId) })
}

/** Sign a user out everywhere: delete every session and close every live editing connection. */
export function signOutEverywhere(userId: string): void {
  deleteUserSessions.run(userId)
  for (const ws of sockets.get(userId) ?? []) ws.close(4401, 'Signed out')
}

export const liveUserCount = (): number => sockets.size

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

interface SessionLookup { user: User; hash: string; expiresAt: number; token: string }

function lookupSession(cookieHeader: string | undefined): SessionLookup | null {
  const token = readCookie(cookieHeader, SESSION_COOKIE)
  if (!token || token.length > 100) return null
  const hash = sha256(token)
  const row = selectSession.get(hash) as (User & { expiresAt: number }) | undefined
  if (!row || row.expiresAt < Date.now()) return null
  const { expiresAt, ...user } = row
  return { user, hash, expiresAt, token }
}

/** Resolve the signed-in user for a raw HTTP request (used for WebSocket upgrades). */
export function userFromRequest(req: IncomingMessage): User | null {
  return lookupSession(req.headers.cookie)?.user ?? null
}

/** Express middleware: attaches req.user when a valid session cookie is present. */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const session = lookupSession(req.headers.cookie)
  if (session) {
    req.user = session.user
    req.sessionHash = session.hash
    // Sliding expiry: renew once less than half the lifetime remains.
    if (session.expiresAt - Date.now() < SESSION_TTL / 2) {
      extendSession.run(Date.now() + SESSION_TTL, session.hash)
      setCookie(req, res, session.token, SESSION_TTL)
    }
  }
  next()
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: 'Sign in required' }); return }
  next()
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) { res.status(401).json({ error: 'Sign in required' }); return }
  if (req.user.role !== 'admin') { res.status(403).json({ error: 'Administrators only' }); return }
  next()
}

// ── Users ────────────────────────────────────────────────────────────────────

const insertUser = db.prepare('INSERT INTO users (id, email, name, color, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
const selectUserByEmail = db.prepare(`SELECT id, email, name, color, role, password_hash AS passwordHash, disabled_at AS disabledAt
  FROM users WHERE email = ?`)
const selectUserHash = db.prepare('SELECT password_hash AS passwordHash FROM users WHERE id = ?')
const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users')
const updateProfile = db.prepare('UPDATE users SET name = ?, color = ? WHERE id = ?')
const updatePassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')

export const userCount = (): number => (countUsers.get() as { n: number }).n

export function findUserByEmail(email: string): (User & { passwordHash: string; disabledAt: number | null }) | undefined {
  return selectUserByEmail.get(email) as (User & { passwordHash: string; disabledAt: number | null }) | undefined
}

/**
 * Create an account. `guard` runs inside the same transaction as the insert, so a
 * precondition (e.g. "no accounts exist yet") cannot be raced by a concurrent request.
 */
export async function createUser(email: string, name: string, password: string, role: User['role'] = 'user', guard?: () => void): Promise<User> {
  const user: User = { id: newId(), email, name, role, color: USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)] }
  const hash = await hashPassword(password)
  db.transaction(() => {
    guard?.()
    insertUser.run(user.id, user.email, user.name, user.color, user.role, hash, Date.now())
  })()
  return user
}

export function saveProfile(user: User): void {
  updateProfile.run(user.name, user.color, user.id)
}

export async function checkUserPassword(userId: string, password: string): Promise<boolean> {
  const row = selectUserHash.get(userId) as { passwordHash: string } | undefined
  return !!row && verifyPassword(password, row.passwordHash)
}

export async function changePassword(userId: string, password: string): Promise<void> {
  updatePassword.run(await hashPassword(password), userId)
}
