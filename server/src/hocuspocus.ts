import { Server } from '@hocuspocus/server'
import { loadDoc, saveDoc, checkRoomPassword, sanitizeDocName, setDocOwner } from './storage.js'
import jwt from 'jsonwebtoken'
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-dev-key'

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
    const token    = requestParameters.get('token')

    if (user !== 'Anonymous') {
      try {
        const decoded = jwt.verify(token || '', JWT_SECRET) as any
        if (decoded.username !== user) throw new Error('Token mismatch')
      } catch {
        throw new Error('Unauthorized - invalid token')
      }
    }

    const safeDocName = sanitizeDocName(documentName)
    if (!checkRoomPassword(safeDocName, password)) {
      throw new Error('Unauthorized')
    }

    // Assign ownership if not already assigned
    if (user !== 'Anonymous') {
      setDocOwner(safeDocName, user)
    }

    console.log(`[quorum] user connected: ${user} → ${safeDocName}`)
  },

  async onDisconnect({ requestParameters }) {
    const user = requestParameters.get('user') ?? 'Anonymous'
    console.log(`[quorum] user disconnected: ${user}`)
  },
})
