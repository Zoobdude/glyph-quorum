import { db, newId } from './db.js'
import { formatBibtex, type BibEntry } from './bibtex.js'

export interface Reference {
  id: string
  key: string
  type: string
  fields: Record<string, string>
  updatedAt: number
}

export const MAX_REFS = 10_000

const selectAll = db.prepare('SELECT id, cite_key AS key, type, fields, updated_at AS updatedAt FROM refs WHERE owner_id = ? ORDER BY cite_key COLLATE NOCASE')
const selectOne = db.prepare('SELECT id, cite_key AS key, type, fields, updated_at AS updatedAt FROM refs WHERE owner_id = ? AND id = ?')
const selectByKey = db.prepare('SELECT id, cite_key AS key, type, fields, updated_at AS updatedAt FROM refs WHERE owner_id = ? AND cite_key = ?')
const countStmt = db.prepare('SELECT COUNT(*) AS n FROM refs WHERE owner_id = ?')
const insertStmt = db.prepare('INSERT INTO refs (id, owner_id, cite_key, type, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
const updateStmt = db.prepare('UPDATE refs SET cite_key = ?, type = ?, fields = ?, updated_at = ? WHERE owner_id = ? AND id = ?')
const deleteStmt = db.prepare('DELETE FROM refs WHERE owner_id = ? AND id = ?')

type Row = Omit<Reference, 'fields'> & { fields: string }
const hydrate = (r: Row): Reference => ({ ...r, fields: JSON.parse(r.fields) })

/**
 * Bumped on every library change. Compile results depend on library contents,
 * so the compiler folds this into its cache key.
 */
let version = 0
const listeners: (() => void)[] = []
export const libraryVersion = (): number => version
export const onLibraryChange = (fn: () => void): void => { listeners.push(fn) }
const changed = () => { version++; listeners.forEach(fn => fn()) }

export const listReferences = (ownerId: string): Reference[] => (selectAll.all(ownerId) as Row[]).map(hydrate)
export const referenceCount = (ownerId: string): number => (countStmt.get(ownerId) as { n: number }).n
export const keyTaken = (ownerId: string, key: string, exceptId?: string): boolean => {
  const row = selectByKey.get(ownerId, key) as Row | undefined
  return !!row && row.id !== exceptId
}

export function createReference(ownerId: string, entry: BibEntry): Reference {
  const id = newId()
  const now = Date.now()
  insertStmt.run(id, ownerId, entry.key, entry.type, JSON.stringify(entry.fields), now, now)
  changed()
  return hydrate(selectOne.get(ownerId, id) as Row)
}

export function updateReference(ownerId: string, id: string, entry: BibEntry): Reference | null {
  if (updateStmt.run(entry.key, entry.type, JSON.stringify(entry.fields), Date.now(), ownerId, id).changes === 0) return null
  changed()
  return hydrate(selectOne.get(ownerId, id) as Row)
}

export function deleteReference(ownerId: string, id: string): boolean {
  const ok = deleteStmt.run(ownerId, id).changes === 1
  if (ok) changed()
  return ok
}

/** Add many entries at once. Entries whose key already exists are replaced or skipped. */
export function importReferences(ownerId: string, entries: BibEntry[], replace: boolean): { added: number; updated: number; skipped: number } {
  const result = { added: 0, updated: 0, skipped: 0 }
  db.transaction(() => {
    let room = MAX_REFS - referenceCount(ownerId)
    const now = Date.now()
    for (const e of entries) {
      const existing = selectByKey.get(ownerId, e.key) as Row | undefined
      if (existing) {
        if (!replace) { result.skipped++; continue }
        updateStmt.run(e.key, e.type, JSON.stringify(e.fields), now, ownerId, existing.id)
        result.updated++
      } else if (room > 0) {
        insertStmt.run(newId(), ownerId, e.key, e.type, JSON.stringify(e.fields), now, now)
        result.added++
        room--
      } else result.skipped++
    }
  })()
  if (result.added || result.updated) changed()
  return result
}

export const exportBibtex = (ownerId: string): string => formatBibtex(listReferences(ownerId))

// ── Resolution at compile time ───────────────────────────────────────────────

const contributors = db.prepare(`
  SELECT owner_id AS id, 0 AS rank FROM documents WHERE id = @doc
  UNION ALL
  SELECT user_id AS id, 1 AS rank FROM doc_members WHERE doc_id = @doc AND role = 'editor'
  ORDER BY rank, id`)

/**
 * Find library entries for the keys a document cites. The libraries of the
 * document's owner and of the editors it is shared with are searched, owner first,
 * so every collaborator gets the same result no matter who triggers the compile.
 * Only the cited entries are returned — the rest of anyone's library stays private.
 */
export function resolveCitations(docId: string, keys: Iterable<string>): BibEntry[] {
  const owners = (contributors.all({ doc: docId }) as { id: string }[]).map(r => r.id)
  const found: BibEntry[] = []
  let budget = 2000
  for (const key of keys) {
    if (--budget < 0) break
    for (const owner of owners) {
      const row = selectByKey.get(owner, key) as Row | undefined
      if (row) { found.push({ key: row.key, type: row.type, fields: JSON.parse(row.fields) }); break }
    }
  }
  return found
}
