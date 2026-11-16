import { Router, type Request } from 'express'
import { h, HttpError } from '../security.js'
import { listVersions, getVersion, snapshotVersion } from '../documents.js'
import { readDocument, editDocument } from '../hocuspocus.js'
import { me, access } from './common.js'

/** Version history: automatic text snapshots that can be previewed and restored. */
export const versions = Router()
const router = versions

const version = (req: Request, docId: string) => {
  const v = /^\d{1,12}$/.test(req.params.version) ? getVersion(docId, Number(req.params.version)) : undefined
  if (!v) throw new HttpError(404, 'Version not found')
  return v
}

router.get('/docs/:id/versions', h((req, res) => {
  res.json({ versions: listVersions(access(req).doc.id) })
}))

router.get('/docs/:id/versions/:version', h((req, res) => {
  res.json({ version: version(req, access(req).doc.id) })
}))

router.post('/docs/:id/versions/:version/restore', h(async (req, res) => {
  const { doc } = access(req, 'editor')
  const v = version(req, doc.id)
  // Keep what is about to be replaced, so a restore can itself be undone.
  snapshotVersion(doc.id, readDocument(doc.id).content, me(req).name, true)
  await editDocument(doc.id, me(req), y => {
    const text = y.getText('content')
    text.delete(0, text.length)
    text.insert(0, v.content)
  })
  res.json({ ok: true })
}))
