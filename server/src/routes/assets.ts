import express, { Router, type Request } from 'express'
import { randomBytes } from 'crypto'
import { existsSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { extname, join } from 'path'
import { h, HttpError, rateLimit } from '../security.js'
import { getAssetsDir, touchAssets } from '../compiler.js'
import { byUser, access } from './common.js'

/** Files uploaded to a document (images, bibliographies) that its Typst source can reference. */
export const assets = Router()
const router = assets

const ASSET_TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.bib': 'text/plain; charset=utf-8',
}
// Strict allow-list: no path separators, quotes or control characters can ever reach the filesystem or Typst source.
const ASSET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,99}$/
const MAX_ASSET_BYTES = 20 * 1024 * 1024
const MAX_ASSETS = 200
const MAX_DOC_BYTES = 250 * 1024 * 1024

function assetName(req: Request): string {
  const name = req.params.name
  if (!ASSET_NAME_RE.test(name) || !(extname(name).toLowerCase() in ASSET_TYPES)) {
    throw new HttpError(400, 'Unsupported file. Use letters, numbers, spaces, dots, dashes; types: png, jpg, gif, webp, svg, pdf, bib.')
  }
  return name
}

function listAssets(docId: string): { name: string; size: number; modified: number }[] {
  const dir = getAssetsDir(docId)
  return readdirSync(dir)
    .filter(f => ASSET_NAME_RE.test(f) && extname(f).toLowerCase() in ASSET_TYPES)
    .map(f => { const s = statSync(join(dir, f)); return { name: f, size: s.size, modified: Math.round(s.mtimeMs) } })
    .sort((a, b) => a.name.localeCompare(b.name))
}

router.get('/docs/:id/assets', h((req, res) => {
  res.json({ files: listAssets(access(req).doc.id) })
}))

router.get('/docs/:id/assets/:name', h((req, res) => {
  const { doc } = access(req)
  const name = assetName(req)
  // Uploaded files are untrusted (SVG can carry script): serve them inert.
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
  res.setHeader('Content-Type', ASSET_TYPES[extname(name).toLowerCase()])
  res.setHeader('Content-Disposition', `${req.query.download !== undefined ? 'attachment' : 'inline'}; filename="${name}"`)
  res.setHeader('Cache-Control', 'private, no-cache')
  res.sendFile(name, { root: getAssetsDir(doc.id), dotfiles: 'deny' }, err => {
    if (err && !res.headersSent) res.status(404).json({ error: 'File not found' })
  })
}))

router.put('/docs/:id/assets/:name',
  rateLimit('upload', 240, 60_000, byUser),
  express.raw({ type: () => true, limit: MAX_ASSET_BYTES }),
  h((req, res) => {
    const { doc } = access(req, 'editor')
    const name = assetName(req)
    const body = req.body as unknown
    if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'Empty upload')

    const existing = listAssets(doc.id)
    const others = existing.filter(f => f.name !== name)
    if (others.length >= MAX_ASSETS) throw new HttpError(400, `A document can hold at most ${MAX_ASSETS} files`)
    if (others.reduce((n, f) => n + f.size, 0) + body.length > MAX_DOC_BYTES) throw new HttpError(413, 'This document is out of storage space')

    // Write-then-rename so a compile never sees a half-written file.
    const dir = getAssetsDir(doc.id)
    const tmp = join(dir, `.upload-${randomBytes(6).toString('hex')}`)
    writeFileSync(tmp, body)
    renameSync(tmp, join(dir, name))
    touchAssets(doc.id)
    res.json({ ok: true, name })
  }))

router.delete('/docs/:id/assets/:name', h((req, res) => {
  const { doc } = access(req, 'editor')
  const path = join(getAssetsDir(doc.id), assetName(req))
  if (existsSync(path)) unlinkSync(path)
  touchAssets(doc.id)
  res.json({ ok: true })
}))
