import express, { type ErrorRequestHandler } from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { join } from 'path'
import { existsSync } from 'fs'
import { hocuspocus } from './hocuspocus.js'
import { api } from './routes/index.js'
import { userFromRequest, trackSocket } from './auth.js'
import { announceSetup } from './settings.js'
import { securityHeaders, requireSameOrigin, isSameOrigin, HttpError, allow } from './security.js'
import { db } from './db.js'

const PORT = Number(process.env.PORT ?? 3000)
const CLIENT_DIST = join(__dirname, '..', '..', 'client', 'dist')

// ── Express ────────────────────────────────────────────────────────────────
const app = express()
app.disable('x-powered-by')
// Trust X-Forwarded-* only from local/private proxies (reverse proxy, tunnel, dev server) by default.
app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal')
app.use(securityHeaders)

app.use('/api', requireSameOrigin, express.json({ limit: '3mb' }), api)

// ── Serve built client ─────────────────────────────────────────────────────
if (existsSync(CLIENT_DIST)) {
  // Vite emits content-hashed filenames under /assets, so those can be cached forever.
  app.use('/assets', express.static(join(CLIENT_DIST, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }))
  app.use(express.static(CLIENT_DIST, { index: false, maxAge: '1h' }))
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(join(CLIENT_DIST, 'index.html'))
  })
}

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) { res.end(); return }
  if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return }
  const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500
  if (status === 500) console.error('[quorum] request failed:', err)
  const message = status === 413 ? 'That upload is too large' : status === 500 ? 'Something went wrong' : 'Bad request'
  res.status(status).json({ error: message })
}
app.use(onError)

// ── HTTP + WebSocket server ────────────────────────────────────────────────
const httpServer = createServer(app)

// WebSocket server for Hocuspocus (Y.js collaboration)
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })

httpServer.on('upgrade', (request, socket, head) => {
  const reject = (status: string) => { socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`) }

  if (!request.url?.startsWith('/ws')) { reject('404 Not Found'); return }
  // Browsers do not apply the same-origin policy to WebSockets, so check Origin ourselves.
  if (!isSameOrigin(request)) { reject('403 Forbidden'); return }
  const user = userFromRequest(request)
  if (!user) { reject('401 Unauthorized'); return }
  if (!allow(`ws:${user.id}`, 120, 60_000)) { reject('429 Too Many Requests'); return }

  wss.handleUpgrade(request, socket as any, head, ws => {
    // Per-document permissions are checked in hocuspocus.onConnect using this context.
    trackSocket(user.id, ws) // lets an admin cut this connection if the account is disabled
    hocuspocus.handleConnection(ws as any, request, { user })
  })
})

httpServer.listen(PORT, () => {
  console.log(`\n  Ligature server running`)
  console.log(`  ➜  HTTP  http://localhost:${PORT}`)
  console.log(`  ➜  WS    ws://localhost:${PORT}/ws\n`)
  announceSetup()
})

// Flush open documents to disk before exiting.
let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  httpServer.close()
  try { await hocuspocus.destroy() } catch {}
  db.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
