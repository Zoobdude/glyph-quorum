import { Server } from '@hocuspocus/server'
import * as Y from 'yjs'
import type { User } from './auth.js'
import { ID_RE } from './db.js'
import { getAccess, loadState, saveState, snapshotVersion, renameDocument, cleanTitle, type Role } from './documents.js'

interface ConnectionContext { user?: User; role?: Role }

export const hocuspocus = Server.configure({
  // Persist shortly after edits settle, and at least every 8s during continuous typing.
  debounce: 1500,
  maxDebounce: 8000,
  timeout: 30_000,

  /** Every connection is authorised per document; the user comes from the session cookie on the upgrade request. */
  async onConnect({ documentName, context, connection }) {
    const user = (context as ConnectionContext).user
    if (!user || !ID_RE.test(documentName)) throw new Error('Unauthorized')
    const access = getAccess(user.id, documentName)
    if (!access) throw new Error('Forbidden')
    // Enforced by the server: updates from read-only connections are discarded.
    connection.readOnly = access.role === 'viewer'
    return { user, role: access.role }
  },

  async onLoadDocument({ document, documentName }) {
    const state = loadState(documentName)
    if (state) {
      try { Y.applyUpdate(document, state) }
      catch (e) { console.warn(`[quorum] failed to load document ${documentName}:`, e) }
    }
    return document
  },

  async onStoreDocument({ document, documentName, context }) {
    saveState(documentName, Y.encodeStateAsUpdate(document))
    const title = document.getMap('settings').get('title')
    if (typeof title === 'string') renameDocument(documentName, cleanTitle(title))
    snapshotVersion(documentName, document.getText('content').toString(), (context as ConnectionContext)?.user?.name ?? 'Unknown')
  },
})

/** Current text and settings of a document, whether or not anyone has it open. */
export function readDocument(docId: string): { content: string; citationStyle: 'numbered' | 'author-date'; useLibrary: boolean; state: Uint8Array | null } {
  const live = hocuspocus.documents.get(docId)
  const ydoc = live ?? new Y.Doc()
  let state: Uint8Array | null = null
  if (live) state = Y.encodeStateAsUpdate(live)
  else {
    state = loadState(docId)
    if (state) Y.applyUpdate(ydoc, state)
  }
  const result = {
    content: ydoc.getText('content').toString(),
    citationStyle: ydoc.getMap('settings').get('citationStyle') === 'numbered' ? 'numbered' as const : 'author-date' as const,
    useLibrary: ydoc.getMap('settings').get('useLibrary') !== false,
    state,
  }
  if (!live) ydoc.destroy()
  return result
}

/** Apply a server-side change to a document so that connected editors see it live. */
export async function editDocument(docId: string, user: User, fn: (doc: Y.Doc) => void): Promise<void> {
  const conn = await hocuspocus.openDirectConnection(docId, { user, role: 'owner' } satisfies ConnectionContext)
  try { await conn.transact(doc => fn(doc)) }
  finally { await conn.disconnect() }
}

/** Drop every connection to a document; clients reconnect and are re-authorised with current permissions. */
export function reauthorize(docId: string): void {
  hocuspocus.closeConnections(docId)
}
