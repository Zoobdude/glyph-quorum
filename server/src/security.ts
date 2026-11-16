import type { IncomingMessage } from 'http'
import type { Request, Response, NextFunction, RequestHandler } from 'express'

// ── Same-origin enforcement (CSRF defence for cookie-authenticated requests) ──

const extraOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean))

/**
 * True when the request's Origin header matches the host it was sent to.
 * Browsers always send Origin on cross-site state-changing requests and on
 * WebSocket handshakes, so a mismatch means another site is driving the request.
 * X-Forwarded-Host is honoured so this works behind reverse proxies and tunnels;
 * a cross-site page cannot set that header without a CORS preflight, which we never grant.
 */
export function isSameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true // non-browser client; SameSite=Lax cookies cover the rest
  if (extraOrigins.has(origin)) return true
  let originHost: string
  try { originHost = new URL(origin).host } catch { return false }
  const forwarded = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim()
  return originHost === req.headers.host || (!!forwarded && originHost === forwarded)
}

export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || isSameOrigin(req)) { next(); return }
  res.status(403).json({ error: 'Cross-origin request blocked' })
}

// ── Response headers ─────────────────────────────────────────────────────────

const HOST_RE = /^[a-z0-9.-]+(:\d+)?$/i

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  const host = req.headers.host && HOST_RE.test(req.headers.host) ? req.headers.host : ''
  const ws = host ? ` ws://${host} wss://${host}` : ''
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'", // Monaco injects inline styles
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src 'self'${ws}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  // Document ids in URLs act as capabilities for link-shared documents — never leak them.
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
}

// ── Rate limiting (fixed window, in memory) ──────────────────────────────────

const buckets = new Map<string, { count: number; resetAt: number }>()

setInterval(() => {
  const now = Date.now()
  for (const [key, b] of buckets) if (b.resetAt <= now) buckets.delete(key)
}, 60_000).unref()

/** Returns true if the action is allowed, false once `max` hits were made within the window. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return true }
  return ++b.count <= max
}

export function rateLimit(name: string, max: number, windowMs: number, by: (req: Request) => string = req => req.ip ?? ''): RequestHandler {
  return (req, res, next) => {
    if (allow(`${name}:${by(req)}`, max, windowMs)) { next(); return }
    res.setHeader('Retry-After', Math.ceil(windowMs / 1000))
    res.status(429).json({ error: 'Too many requests — please wait a moment and try again.' })
  }
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** Wrap an async handler so rejections reach the Express error handler. */
export const h = (fn: (req: Request, res: Response) => unknown | Promise<unknown>): RequestHandler =>
  (req, res, next) => { Promise.resolve().then(() => fn(req, res)).catch(next) }

/** Read a trimmed string field from untrusted JSON, enforcing a length range. */
export function str(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new HttpError(400, `${field} is required`)
  const s = value.trim()
  if (s.length < min) throw new HttpError(400, min <= 1 ? `${field} is required` : `${field} must be at least ${min} characters`)
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`)
  return s
}
