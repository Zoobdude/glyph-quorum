import { Router, type Request } from 'express'
import { h, HttpError, rateLimit } from '../security.js'
import { ID_RE } from '../db.js'
import { parseBibtex, KEY_RE, FIELD_RE, TYPE_RE, type BibEntry } from '../bibtex.js'
import {
  listReferences, createReference, updateReference, deleteReference, importReferences, exportBibtex,
  referenceCount, keyTaken, MAX_REFS,
} from '../references.js'
import { me, byUser } from './common.js'

/** Each user's personal reference library, cited from any document without uploading a .bib file. */
export const references = Router()

/** Validate a reference submitted from the editing form. */
function entry(body: unknown): BibEntry {
  const { key, type, fields } = (body ?? {}) as { key?: unknown; type?: unknown; fields?: unknown }
  if (typeof key !== 'string' || !KEY_RE.test(key)) throw new HttpError(400, 'Citation key may only contain letters, numbers, _ - and :')
  if (typeof type !== 'string' || !TYPE_RE.test(type)) throw new HttpError(400, 'Choose an entry type')
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new HttpError(400, 'fields required')
  const clean: Record<string, string> = {}
  for (const [name, value] of Object.entries(fields as Record<string, unknown>).slice(0, 60)) {
    if (!FIELD_RE.test(name) || typeof value !== 'string') continue
    const v = value.replace(/\s+/g, ' ').trim().slice(0, 20_000)
    if (v) clean[name] = v
  }
  if (Object.keys(clean).length === 0) throw new HttpError(400, 'Fill in at least one field')
  return { key, type, fields: clean }
}

const refId = (req: Request): string => {
  if (!ID_RE.test(req.params.refId)) throw new HttpError(404, 'Reference not found')
  return req.params.refId
}

references.get('/refs', h((req, res) => {
  res.json({ refs: listReferences(me(req).id) })
}))

references.post('/refs', h((req, res) => {
  const e = entry(req.body)
  if (referenceCount(me(req).id) >= MAX_REFS) throw new HttpError(400, `A library can hold at most ${MAX_REFS} references`)
  if (keyTaken(me(req).id, e.key)) throw new HttpError(409, `You already have a reference with the key “${e.key}”`)
  res.status(201).json({ ref: createReference(me(req).id, e) })
}))

references.put('/refs/:refId', h((req, res) => {
  const e = entry(req.body)
  if (keyTaken(me(req).id, e.key, refId(req))) throw new HttpError(409, `You already have a reference with the key “${e.key}”`)
  const ref = updateReference(me(req).id, refId(req), e)
  if (!ref) throw new HttpError(404, 'Reference not found')
  res.json({ ref })
}))

references.delete('/refs/:refId', h((req, res) => {
  if (!deleteReference(me(req).id, refId(req))) throw new HttpError(404, 'Reference not found')
  res.json({ ok: true })
}))

/** Import BibTeX (pasted or from a .bib file). */
references.post('/refs/import', rateLimit('refs-import', 30, 3600_000, byUser), h((req, res) => {
  const { bibtex, replace } = req.body as { bibtex?: unknown; replace?: unknown }
  if (typeof bibtex !== 'string' || !bibtex.trim()) throw new HttpError(400, 'Nothing to import')
  const { entries, skipped } = parseBibtex(bibtex)
  if (entries.length === 0) throw new HttpError(400, 'No BibTeX entries were found in that text')
  const result = importReferences(me(req).id, entries, replace === true)
  res.json({ ...result, unreadable: skipped })
}))

references.get('/refs/export', h((req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="references.bib"')
  res.type('text/plain; charset=utf-8').send(exportBibtex(me(req).id))
}))

// ── DOI lookup ───────────────────────────────────────────────────────────────

const DOI_RE = /^10\.\d{4,9}\/[^\s"<>]{1,200}$/
// Fixed, well-known registries only: the server never fetches a URL supplied by a user.
const DOI_SOURCES = [
  (doi: string) => `https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/application/x-bibtex`,
  (doi: string) => `https://api.datacite.org/dois/application/x-bibtex/${encodeURIComponent(doi)}`,
]

/** Fetch bibliographic data for a DOI. Nothing is saved — the client shows it in the form for review. */
references.post('/refs/lookup', rateLimit('refs-lookup', 40, 60_000, byUser), h(async (req, res) => {
  const doi = String(req.body.doi ?? '').trim().replace(/^(https?:\/\/)?(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '')
  if (!DOI_RE.test(doi)) throw new HttpError(400, 'That does not look like a DOI (for example 10.1000/xyz123)')
  let reachable = false
  for (const url of DOI_SOURCES) {
    try {
      const r = await fetch(url(doi), { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/x-bibtex' } })
      reachable = true
      if (!r.ok) continue
      const text = (await r.text()).slice(0, 200_000)
      const found = parseBibtex(text).entries[0]
      if (found) { res.json({ entry: { ...found, fields: { ...found.fields, doi: found.fields.doi ?? doi } } }); return }
    } catch { /* try the next registry */ }
  }
  throw new HttpError(reachable ? 404 : 502, reachable ? 'No record was found for that DOI' : 'Could not reach the DOI lookup services from this server')
}))
