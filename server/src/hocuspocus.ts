import { Server } from '@hocuspocus/server'
import { loadDoc, saveDoc, checkRoomPassword, sanitizeDocName } from './storage.js'

export const hocuspocus = Server.configure({
  async onLoadDocument({ document, documentName }) {
    loadDoc(sanitizeDocName(documentName), document)
    return document
  },

  async onStoreDocument({ document, documentName }) {
    saveDoc(sanitizeDocName(documentName), document)
  },

  async onConnect({ requestParameters, documentName }) {
    const user     = requestParameters.get('user') ?? 'Anonymous'
    const password = requestParameters.get('password') ?? ''
    const safeDocName = sanitizeDocName(documentName)
    if (!checkRoomPassword(safeDocName, password)) {
      throw new Error('Unauthorized')
    }
    console.log(`[quorum] user connected: ${user} → ${safeDocName}`)
  },

  async onDisconnect({ requestParameters }) {
    const user = requestParameters.get('user') ?? 'Anonymous'
    console.log(`[quorum] user disconnected: ${user}`)
  },
})
