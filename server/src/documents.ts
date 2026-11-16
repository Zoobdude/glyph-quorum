import * as Y from 'yjs'
import { cpSync, existsSync, readdirSync, renameSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { db, newId, ASSETS_DIR, DATA_DIR } from './db.js'

export type Role = 'owner' | 'editor' | 'viewer'
export type LinkAccess = 'none' | 'viewer' | 'editor'

export interface DocRow {
  id: string
  ownerId: string
  title: string
  linkAccess: LinkAccess
  createdAt: number
  updatedAt: number
  trashedAt: number | null
}

const DOC_COLS = `d.id, d.owner_id AS ownerId, d.title, d.link_access AS linkAccess,
  d.created_at AS createdAt, d.updated_at AS updatedAt, d.trashed_at AS trashedAt`

export const MAX_TITLE = 120
export const cleanTitle = (t: string): string => t.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_TITLE) || 'Untitled document'

// ── Access control ───────────────────────────────────────────────────────────

const selectDoc = db.prepare(`SELECT ${DOC_COLS} FROM documents d WHERE d.id = ?`)
const selectMemberRole = db.prepare('SELECT role FROM doc_members WHERE doc_id = ? AND user_id = ?')

export const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 }

/**
 * The single place that decides what a user may do with a document.
 * Returns null when the document does not exist or the user has no access
 * (callers answer 404 either way, so existence is not revealed).
 */
export function getAccess(userId: string, docId: string): { doc: DocRow; role: Role } | null {
  const doc = selectDoc.get(docId) as DocRow | undefined
  if (!doc) return null
  if (doc.ownerId === userId) return { doc, role: 'owner' }
  if (doc.trashedAt) return null // only the owner can see a trashed document
  const member = (selectMemberRole.get(docId, userId) as { role: Role } | undefined)?.role
  const link = doc.linkAccess === 'none' ? undefined : doc.linkAccess
  const role = member && link ? (RANK[member] >= RANK[link] ? member : link) : member ?? link
  return role ? { doc, role } : null
}

// ── Listing ──────────────────────────────────────────────────────────────────

const LIST_COLS = `${DOC_COLS}, o.name AS ownerName, COALESCE(du.starred, 0) AS starred, du.opened_at AS openedAt`
const LIST_FROM = `FROM documents d JOIN users o ON o.id = d.owner_id
  LEFT JOIN doc_user du ON du.doc_id = d.id AND du.user_id = @u
  LEFT JOIN doc_members m ON m.doc_id = d.id AND m.user_id = @u`
// A document counts as "shared with me" if I was added by email, or I opened it through a share link.
const SHARED = `d.owner_id != @u AND d.trashed_at IS NULL
  AND (m.user_id IS NOT NULL OR (d.link_access != 'none' AND du.opened_at IS NOT NULL))`
const ROLE = `CASE WHEN d.owner_id = @u THEN 'owner'
  WHEN m.role = 'editor' OR d.link_access = 'editor' THEN 'editor' ELSE 'viewer' END AS role`

const listQueries = {
  mine: db.prepare(`SELECT ${LIST_COLS}, ${ROLE} ${LIST_FROM} WHERE d.owner_id = @u AND d.trashed_at IS NULL ORDER BY d.updated_at DESC LIMIT 500`),
  shared: db.prepare(`SELECT ${LIST_COLS}, ${ROLE} ${LIST_FROM} WHERE ${SHARED} ORDER BY d.updated_at DESC LIMIT 500`),
  starred: db.prepare(`SELECT ${LIST_COLS}, ${ROLE} ${LIST_FROM} WHERE du.starred = 1 AND ((d.owner_id = @u AND d.trashed_at IS NULL) OR (${SHARED})) ORDER BY d.updated_at DESC LIMIT 500`),
  recent: db.prepare(`SELECT ${LIST_COLS}, ${ROLE} ${LIST_FROM} WHERE du.opened_at IS NOT NULL AND ((d.owner_id = @u AND d.trashed_at IS NULL) OR (${SHARED})) ORDER BY du.opened_at DESC LIMIT 60`),
  trash: db.prepare(`SELECT ${LIST_COLS}, ${ROLE} ${LIST_FROM} WHERE d.owner_id = @u AND d.trashed_at IS NOT NULL ORDER BY d.trashed_at DESC LIMIT 500`),
}
export type ListView = keyof typeof listQueries
export const isListView = (v: unknown): v is ListView => typeof v === 'string' && v in listQueries

export function listDocuments(userId: string, view: ListView): unknown[] {
  return (listQueries[view].all({ u: userId }) as { starred: number }[]).map(r => ({ ...r, starred: !!r.starred }))
}

// ── Create / update / delete ─────────────────────────────────────────────────

const insertDoc = db.prepare('INSERT INTO documents (id, owner_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
const upsertState = db.prepare('INSERT INTO doc_state (doc_id, state) VALUES (?, ?) ON CONFLICT(doc_id) DO UPDATE SET state = excluded.state')
const selectState = db.prepare('SELECT state FROM doc_state WHERE doc_id = ?')
const touchDoc = db.prepare('UPDATE documents SET updated_at = ? WHERE id = ?')
const setTitle = db.prepare('UPDATE documents SET title = ? WHERE id = ?')
const setTrashed = db.prepare('UPDATE documents SET trashed_at = ? WHERE id = ?')
const setLinkAccessStmt = db.prepare('UPDATE documents SET link_access = ? WHERE id = ?')
const deleteDoc = db.prepare('DELETE FROM documents WHERE id = ?')
const setStar = db.prepare(`INSERT INTO doc_user (user_id, doc_id, starred) VALUES (?, ?, ?)
  ON CONFLICT(user_id, doc_id) DO UPDATE SET starred = excluded.starred`)
const setOpened = db.prepare(`INSERT INTO doc_user (user_id, doc_id, opened_at) VALUES (?, ?, ?)
  ON CONFLICT(user_id, doc_id) DO UPDATE SET opened_at = excluded.opened_at`)
const selectDocUser = db.prepare('SELECT starred FROM doc_user WHERE user_id = ? AND doc_id = ?')

/** Build the initial Y.js state for a new document. */
function initialState(title: string, content: string): Buffer {
  const ydoc = new Y.Doc()
  ydoc.getMap('settings').set('title', title)
  if (content) ydoc.getText('content').insert(0, content)
  const state = Buffer.from(Y.encodeStateAsUpdate(ydoc))
  ydoc.destroy()
  return state
}

export function createDocument(ownerId: string, title: string, content = '', state?: Buffer): string {
  const id = newId()
  const now = Date.now()
  db.transaction(() => {
    insertDoc.run(id, ownerId, title, now, now)
    upsertState.run(id, state ?? initialState(title, content))
  })()
  return id
}

export const loadState = (docId: string): Buffer | null =>
  (selectState.get(docId) as { state: Buffer } | undefined)?.state ?? null

export function saveState(docId: string, state: Uint8Array): void {
  db.transaction(() => {
    // The document may have been deleted while it was still open in memory.
    if (touchDoc.run(Date.now(), docId).changes === 0) return
    upsertState.run(docId, Buffer.from(state))
  })()
}

export const renameDocument = (docId: string, title: string) => { setTitle.run(title, docId) }
export const trashDocument = (docId: string, trashed: boolean) => { setTrashed.run(trashed ? Date.now() : null, docId) }
export const setLinkAccess = (docId: string, access: LinkAccess) => { setLinkAccessStmt.run(access, docId) }
export const starDocument = (userId: string, docId: string, starred: boolean) => { setStar.run(userId, docId, starred ? 1 : 0) }
export const markOpened = (userId: string, docId: string) => { setOpened.run(userId, docId, Date.now()) }
export const isStarred = (userId: string, docId: string): boolean =>
  !!(selectDocUser.get(userId, docId) as { starred: number } | undefined)?.starred

export function deleteDocument(docId: string): void {
  deleteDoc.run(docId) // cascades to state, thumbnails, members, versions
  rmSync(join(ASSETS_DIR, docId), { recursive: true, force: true })
}

/** Copy a document (current state + assets) into a new one owned by `ownerId`. */
export function copyDocument(source: DocRow, ownerId: string, liveState: Uint8Array | null): string {
  const title = cleanTitle(`Copy of ${source.title}`)
  const ydoc = new Y.Doc()
  const state = liveState ?? loadState(source.id)
  if (state) Y.applyUpdate(ydoc, state)
  // A copy starts with a clean slate for review state.
  const settings = ydoc.getMap('settings')
  const fresh = new Y.Doc()
  fresh.getText('content').insert(0, ydoc.getText('content').toString())
  fresh.getMap('settings').set('title', title)
  if (settings.get('citationStyle')) fresh.getMap('settings').set('citationStyle', settings.get('citationStyle'))
  const dict = ydoc.getArray<string>('dictionary').toArray()
  if (dict.length) fresh.getArray<string>('dictionary').push(dict)
  const id = createDocument(ownerId, title, '', Buffer.from(Y.encodeStateAsUpdate(fresh)))
  ydoc.destroy(); fresh.destroy()

  const from = join(ASSETS_DIR, source.id)
  if (existsSync(from)) cpSync(from, join(ASSETS_DIR, id), { recursive: true })
  return id
}

// ── Sharing ──────────────────────────────────────────────────────────────────

const selectMembers = db.prepare(`SELECT u.id, u.name, u.email, u.color, m.role
  FROM doc_members m JOIN users u ON u.id = m.user_id WHERE m.doc_id = ? ORDER BY u.name`)
const selectOwner = db.prepare('SELECT id, name, email, color FROM users WHERE id = ?')
const upsertMember = db.prepare(`INSERT INTO doc_members (doc_id, user_id, role) VALUES (?, ?, ?)
  ON CONFLICT(doc_id, user_id) DO UPDATE SET role = excluded.role`)
const deleteMember = db.prepare('DELETE FROM doc_members WHERE doc_id = ? AND user_id = ?')
const countMembers = db.prepare('SELECT COUNT(*) AS n FROM doc_members WHERE doc_id = ?')

export const MAX_MEMBERS = 200

export function listMembers(doc: DocRow): { owner: unknown; members: unknown[] } {
  return { owner: selectOwner.get(doc.ownerId), members: selectMembers.all(doc.id) }
}
export const memberCount = (docId: string): number => (countMembers.get(docId) as { n: number }).n
export const setMember = (docId: string, userId: string, role: 'viewer' | 'editor') => { upsertMember.run(docId, userId, role) }
export const removeMember = (docId: string, userId: string) => { deleteMember.run(docId, userId) }

// ── Thumbnails ───────────────────────────────────────────────────────────────

const selectThumb = db.prepare('SELECT version, png FROM doc_thumbs WHERE doc_id = ?')
const upsertThumb = db.prepare(`INSERT INTO doc_thumbs (doc_id, version, png) VALUES (?, ?, ?)
  ON CONFLICT(doc_id) DO UPDATE SET version = excluded.version, png = COALESCE(excluded.png, doc_thumbs.png)`)

export const getThumb = (docId: string) => selectThumb.get(docId) as { version: number; png: Buffer | null } | undefined
/** Record a render attempt. A failed render (png = null) keeps the previous image. */
export const saveThumb = (docId: string, version: number, png: Buffer | null) => { upsertThumb.run(docId, version, png) }

// ── Version history ──────────────────────────────────────────────────────────

const VERSION_INTERVAL = 10 * 60 * 1000
const MAX_VERSIONS = 60

const lastVersion = db.prepare('SELECT created_at AS createdAt, content FROM doc_versions WHERE doc_id = ? ORDER BY id DESC LIMIT 1')
const insertVersion = db.prepare('INSERT INTO doc_versions (doc_id, created_at, author, content) VALUES (?, ?, ?, ?)')
const pruneVersions = db.prepare(`DELETE FROM doc_versions WHERE doc_id = ? AND id NOT IN
  (SELECT id FROM doc_versions WHERE doc_id = ? ORDER BY id DESC LIMIT ${MAX_VERSIONS})`)
const selectVersions = db.prepare(`SELECT id, created_at AS createdAt, author, LENGTH(content) AS size
  FROM doc_versions WHERE doc_id = ? ORDER BY id DESC`)
const selectVersion = db.prepare('SELECT id, created_at AS createdAt, author, content FROM doc_versions WHERE doc_id = ? AND id = ?')

/** Snapshot the text if it changed and enough time has passed since the last snapshot (or `force`). */
export function snapshotVersion(docId: string, content: string, author: string, force = false): void {
  const last = lastVersion.get(docId) as { createdAt: number; content: string } | undefined
  if (last?.content === content) return
  if (!last && !content) return
  if (!force && last && Date.now() - last.createdAt < VERSION_INTERVAL) return
  insertVersion.run(docId, Date.now(), author.slice(0, 80), content)
  pruneVersions.run(docId, docId)
}
export const listVersions = (docId: string) => selectVersions.all(docId)
export const getVersion = (docId: string, id: number) =>
  selectVersion.get(docId, id) as { id: number; createdAt: number; author: string; content: string } | undefined

// ── Legacy migration ─────────────────────────────────────────────────────────

/**
 * Earlier releases stored anonymous "rooms" as data/docs/<name>.bin with no owner.
 * The first account created on an upgraded server adopts them as its documents.
 */
export function adoptLegacyRooms(ownerId: string): number {
  const legacyDir = join(DATA_DIR, 'docs')
  if (!existsSync(legacyDir)) return 0
  let adopted = 0
  for (const file of readdirSync(legacyDir)) {
    if (!file.endsWith('.bin')) continue
    const name = file.slice(0, -4)
    try {
      const id = createDocument(ownerId, cleanTitle(name), '', readFileSync(join(legacyDir, file)))
      const oldAssets = join(ASSETS_DIR, name)
      if (/^[a-z0-9-]+$/.test(name) && existsSync(oldAssets)) renameSync(oldAssets, join(ASSETS_DIR, id))
      adopted++
    } catch (e) {
      console.warn(`[quorum] could not migrate legacy room "${name}":`, e)
    }
  }
  renameSync(legacyDir, join(DATA_DIR, 'docs.migrated'))
  rmSync(join(DATA_DIR, 'passwords.json'), { force: true })
  return adopted
}
