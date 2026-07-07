import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { hocuspocus } from './hocuspocus.js'
import { compileTypst, getAssetsDir } from './compiler.js'
import { listDocs, isRoomProtected, setRoomPassword, checkRoomPassword, deleteRoom, sanitizeDocName, getDocPreview, registerUser, loginUser, getUserDocuments, getDocOwner, updateUser } from './storage.js'
import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-dev-key'

function authenticate(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization
  if (authHeader) {
    const token = authHeader.split(' ')[1]
    try {
      req.user = jwt.verify(token, JWT_SECRET)
    } catch { }
  }
  next()
}
import { join } from 'path'
import { existsSync, writeFileSync, readdirSync, statSync, unlinkSync } from 'fs'

const PORT = Number(process.env.PORT ?? 3000)
const CLIENT_DIST = join(__dirname, '..', '..', 'client', 'dist')

// ── Express ────────────────────────────────────────────────────────────────
const app = express()
app.use(cors())
app.use(express.json({ limit: '25mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/docs', authenticate, (req: any, res: any) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  const userDocs = getUserDocuments(req.user.username)
  const docs = userDocs.map(name => ({
    name,
    protected: isRoomProtected(name),
    preview: getDocPreview(name)
  }))
  res.json({ docs })
})

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body
  const result = registerUser(username, password)
  if (result.ok) {
    const token = jwt.sign({ username }, JWT_SECRET)
    res.json({ ok: true, token, username, color: result.color })
  } else {
    res.status(400).json(result)
  }
})

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body
  const result = loginUser(username, password)
  if (result.ok) {
    const token = jwt.sign({ username }, JWT_SECRET)
    res.json({ ok: true, token, username, color: result.color })
  } else {
    res.status(400).json(result)
  }
})

app.put('/api/auth/me', authenticate, (req: any, res: any) => {
  if (!req.user) return res.status(401).json({ ok: false, error: 'Unauthorized' })
  const { newUsername, newPassword, newColor } = req.body
  const result = updateUser(req.user.username, newUsername || req.user.username, newPassword, newColor)
  if (result.ok) {
    let token
    if (newUsername && newUsername !== req.user.username) {
      token = jwt.sign({ username: newUsername }, JWT_SECRET)
    }
    res.json({ ok: true, token, username: newUsername || req.user.username, color: newColor })
  } else {
    res.status(400).json(result)
  }
})

// ── Room auth ─────────────────────────────────────────────────────────────────

app.get('/api/rooms/:docId/auth', (req, res) => {
  res.json({ protected: isRoomProtected(sanitizeDocName(req.params.docId)) })
})

app.post('/api/rooms/:docId/auth', (req, res) => {
  const { password = '', action = 'validate' } = req.body as { password?: string; action?: string }
  const docId = sanitizeDocName(req.params.docId)

  if (action === 'set') {
    if (isRoomProtected(docId)) return res.status(409).json({ ok: false, error: 'Room already has a password' })
    if (!password.trim()) return res.status(400).json({ ok: false, error: 'Password cannot be empty' })
    setRoomPassword(docId, password)
    return res.json({ ok: true })
  }

  const ok = checkRoomPassword(docId, password)
  res.json({ ok, error: ok ? undefined : 'Incorrect password' })
})

app.delete('/api/rooms/:docId', authenticate, (req: any, res: any) => {
  const docId = sanitizeDocName(req.params.docId)
  if (!req.user || getDocOwner(docId) !== req.user.username) {
    return res.status(403).json({ ok: false, error: 'Unauthorized to delete this room' })
  }
  deleteRoom(docId)
  res.json({ ok: true })
})

// ── Assets ────────────────────────────────────────────────────────────────

const ASSET_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf', '.webp'])
const RESERVED   = new Set(['_compile.typ', '_compile.pdf'])

app.get('/api/rooms/:docId/assets', (req, res) => {
  const dir = getAssetsDir(sanitizeDocName(req.params.docId))
  const files = readdirSync(dir)
    .filter(f => {
      const ext = f.slice(f.lastIndexOf('.')).toLowerCase()
      return ASSET_EXTS.has(ext) && !RESERVED.has(f)
    })
    .map(f => ({ name: f, size: statSync(join(dir, f)).size }))
  res.json({ files })
})

app.post('/api/rooms/:docId/assets', (req, res) => {
  const { filename, data } = req.body as { filename?: string; data?: string }
  if (!filename || !data) return res.status(400).json({ ok: false, error: 'filename and data required' })
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  if (!ASSET_EXTS.has(ext)) return res.status(400).json({ ok: false, error: 'unsupported file type' })
  // Sanitise: strip path separators
  const safe = filename.replace(/[/\\]/g, '_')
  const dir  = getAssetsDir(sanitizeDocName(req.params.docId))
  writeFileSync(join(dir, safe), Buffer.from(data, 'base64'))
  res.json({ ok: true, name: safe })
})

app.delete('/api/rooms/:docId/assets/:filename', (req, res) => {
  const dir  = getAssetsDir(sanitizeDocName(req.params.docId))
  const file = req.params.filename.replace(/[/\\]/g, '_')
  const path = join(dir, file)
  if (existsSync(path)) unlinkSync(path)
  res.json({ ok: true })
})

// ── Compile ───────────────────────────────────────────────────────────────

app.post('/api/compile', async (req, res) => {
  const { content, docId } = req.body as { content?: string; docId?: string }
  if (typeof content !== 'string') {
    return res.status(400).json({ ok: false, error: 'content required' })
  }
  const result = await compileTypst(content, sanitizeDocName(docId ?? 'untitled'))
  res.json(result)
})

// ── Serve built client (MUST be after all API routes) ─────────────────────
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST))
  app.get('*', (_req, res) => res.sendFile(join(CLIENT_DIST, 'index.html')))
}

// ── HTTP + WebSocket server ────────────────────────────────────────────────
const httpServer = createServer(app)

// WebSocket server for Hocuspocus (Y.js collaboration)
const wss = new WebSocketServer({ noServer: true })

wss.on('connection', (ws, req) => {
  hocuspocus.handleConnection(ws as any, req)
})

httpServer.on('upgrade', (request, socket, head) => {
  if (request.url?.startsWith('/ws')) {
    wss.handleUpgrade(request, socket as any, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  } else {
    socket.destroy()
  }
})

httpServer.listen(PORT, () => {
  console.log(`\n  Glyph Quorum server running`)
  console.log(`  ➜  HTTP  http://localhost:${PORT}`)
  console.log(`  ➜  WS    ws://localhost:${PORT}/ws\n`)
})
