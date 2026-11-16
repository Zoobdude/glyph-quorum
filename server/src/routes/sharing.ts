import { Router } from 'express'
import { findUserByEmail } from '../auth.js'
import { h, HttpError, rateLimit } from '../security.js'
import { listMembers, setMember, removeMember, memberCount, MAX_MEMBERS } from '../documents.js'
import { reauthorize } from '../hocuspocus.js'
import { me, byUser, access, email } from './common.js'

/** Who can open a document. Every change drops live connections so new permissions apply immediately. */
export const sharing = Router()
const router = sharing

router.get('/docs/:id/members', h((req, res) => {
  const { doc } = access(req)
  res.json({ ...listMembers(doc), linkAccess: doc.linkAccess })
}))

router.put('/docs/:id/members', rateLimit('share', 60, 3600_000, byUser), h((req, res) => {
  const { doc } = access(req, 'owner')
  const role = req.body.role
  if (role !== 'viewer' && role !== 'editor') throw new HttpError(400, 'Invalid role')
  const target = findUserByEmail(email(req.body.email))
  if (!target) throw new HttpError(404, 'No account with that email — ask them to sign up first')
  if (target.id === doc.ownerId) throw new HttpError(400, 'That person already owns this document')
  if (memberCount(doc.id) >= MAX_MEMBERS) throw new HttpError(400, 'This document has reached its sharing limit')
  setMember(doc.id, target.id, role)
  reauthorize(doc.id)
  res.json(listMembers(doc))
}))

router.delete('/docs/:id/members/:userId', h((req, res) => {
  const { doc, role } = access(req)
  // Owners can remove anyone; other people can only remove themselves.
  if (role !== 'owner' && req.params.userId !== me(req).id) throw new HttpError(403, 'Only the owner can do that')
  removeMember(doc.id, req.params.userId)
  reauthorize(doc.id)
  res.json({ ok: true })
}))
