import { Router } from 'express'
import type { User } from '../auth.js'
import { h, str, HttpError, rateLimit } from '../security.js'
import {
  listDocuments, isListView, createDocument, cleanTitle, renameDocument, trashDocument, setLinkAccess,
  starDocument, markOpened, isStarred, deleteDocument, copyDocument, listMembers,
} from '../documents.js'
import { touchAssets } from '../compiler.js'
import { readDocument, editDocument, reauthorize } from '../hocuspocus.js'
import { me, byUser, access, MAX_CONTENT } from './common.js'

/** The file manager: list, create, open, rename, star, trash, delete and copy documents. */
export const documents = Router()
const router = documents

router.get('/docs', h((req, res) => {
  const view = req.query.view ?? 'mine'
  if (!isListView(view)) throw new HttpError(400, 'Unknown view')
  res.json({ docs: listDocuments(me(req).id, view) })
}))

router.post('/docs', rateLimit('create', 120, 3600_000, byUser), h((req, res) => {
  const title = cleanTitle(typeof req.body.title === 'string' ? req.body.title : '')
  const content = typeof req.body.content === 'string' ? req.body.content : ''
  if (content.length > MAX_CONTENT) throw new HttpError(413, 'Document is too large')
  const id = createDocument(me(req).id, title, content.replace(/\r\n/g, '\n'))
  res.status(201).json({ id })
}))

router.get('/docs/:id', h((req, res) => {
  const { doc, role } = access(req)
  markOpened(me(req).id, doc.id)
  const { owner } = listMembers(doc)
  res.json({ doc: { ...doc, role, starred: isStarred(me(req).id, doc.id), ownerName: (owner as User | undefined)?.name ?? '' } })
}))

router.patch('/docs/:id', h(async (req, res) => {
  const body = req.body as { title?: unknown; starred?: unknown; trashed?: unknown; linkAccess?: unknown }
  const { doc } = access(req)

  if (body.starred !== undefined) starDocument(me(req).id, doc.id, body.starred === true)

  if (body.title !== undefined) {
    access(req, 'editor')
    const title = cleanTitle(str(body.title, 'Title', 1, 200))
    renameDocument(doc.id, title)
    // Mirror into the shared document so everyone with it open sees the new title immediately.
    await editDocument(doc.id, me(req), y => y.getMap('settings').set('title', title))
  }
  if (body.linkAccess !== undefined) {
    access(req, 'owner')
    if (body.linkAccess !== 'none' && body.linkAccess !== 'viewer' && body.linkAccess !== 'editor') throw new HttpError(400, 'Invalid link access')
    setLinkAccess(doc.id, body.linkAccess)
    reauthorize(doc.id)
  }
  if (body.trashed !== undefined) {
    access(req, 'owner')
    trashDocument(doc.id, body.trashed === true)
    reauthorize(doc.id)
  }
  res.json({ ok: true })
}))

router.delete('/docs/:id', h((req, res) => {
  const { doc } = access(req, 'owner')
  reauthorize(doc.id)
  deleteDocument(doc.id)
  touchAssets(doc.id)
  res.json({ ok: true })
}))

router.post('/docs/:id/copy', rateLimit('create', 120, 3600_000, byUser), h((req, res) => {
  const { doc } = access(req)
  res.status(201).json({ id: copyDocument(doc, me(req).id, readDocument(doc.id).state) })
}))
