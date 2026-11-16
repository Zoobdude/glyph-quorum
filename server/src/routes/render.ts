import { Router } from 'express'
import { h, HttpError, rateLimit } from '../security.js'
import { getThumb, saveThumb } from '../documents.js'
import { compileTypst, BUSY } from '../compiler.js'
import { readDocument } from '../hocuspocus.js'
import { byUser, access, MAX_CONTENT } from './common.js'

/** Typst output: the live PDF preview and the first-page thumbnails shown in the file manager. */
export const render = Router()
const router = render

router.post('/docs/:id/compile', rateLimit('compile', 90, 60_000, byUser), h(async (req, res) => {
  const { doc } = access(req)
  const { content, citationStyle, useLibrary } = req.body as { content?: unknown; citationStyle?: unknown; useLibrary?: unknown }
  if (typeof content !== 'string') throw new HttpError(400, 'content required')
  if (content.length > MAX_CONTENT) throw new HttpError(413, 'Document is too large to compile')
  const result = await compileTypst({ docId: doc.id, content, citationStyle: citationStyle === 'numbered' ? 'numbered' : 'author-date', useLibrary: useLibrary !== false })
  if (!result.ok) { res.status(422).json({ error: result.error }); return }
  res.type('application/pdf').send(result.data)
}))

router.get('/docs/:id/thumbnail', h(async (req, res) => {
  const { doc } = access(req)
  let thumb = getThumb(doc.id)
  if (!thumb || thumb.version !== doc.updatedAt) {
    const { content, citationStyle, useLibrary } = readDocument(doc.id)
    const result = await compileTypst({ docId: doc.id, content, citationStyle, useLibrary, format: 'png' })
    if (result.ok || result.error !== BUSY) saveThumb(doc.id, doc.updatedAt, result.ok ? result.data : null)
    thumb = getThumb(doc.id)
  }
  if (!thumb?.png) { res.status(404).end(); return }
  // The client asks for ?v=<updatedAt>, so a matching render can be cached for good.
  res.setHeader('Cache-Control', thumb.version === Number(req.query.v) ? 'private, max-age=31536000, immutable' : 'private, no-cache')
  res.type('image/png').send(thumb.png)
}))
