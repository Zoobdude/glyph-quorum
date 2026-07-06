import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, unlinkSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import * as Y from 'yjs'

const DATA_DIR  = join(process.cwd(), 'data')
const DOCS_DIR  = join(DATA_DIR, 'docs')
const PASSWORDS_FILE = join(DATA_DIR, 'passwords.json')
const USERS_FILE = join(DATA_DIR, 'users.json')
const OWNERS_FILE = join(DATA_DIR, 'owners.json')
mkdirSync(DOCS_DIR, { recursive: true })

export function sanitizeDocName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-') || 'untitled'
}

/** Persist Y.js document state to a binary file. */
export function saveDoc(docName: string, doc: Y.Doc): void {
  const state = Y.encodeStateAsUpdate(doc)
  writeFileSync(join(DOCS_DIR, `${sanitizeDocName(docName)}.bin`), Buffer.from(state))
}

/** Load previously saved Y.js state into a document. */
export function loadDoc(docName: string, doc: Y.Doc): void {
  const filePath = join(DOCS_DIR, `${sanitizeDocName(docName)}.bin`)
  if (existsSync(filePath)) {
    try {
      Y.applyUpdate(doc, readFileSync(filePath))
    } catch (e) {
      console.warn(`Failed to load doc "${docName}":`, e)
    }
  }
}

/** List all persisted document names. */
export function listDocs(): string[] {
  return readdirSync(DOCS_DIR)
    .filter(f => f.endsWith('.bin'))
    .map(f => f.slice(0, -4))
}

export function getDocPreview(docName: string): string {
  const doc = new Y.Doc()
  loadDoc(docName, doc)
  const text = doc.getText('content').toString()
  doc.destroy()
  return text.length > 150 ? text.slice(0, 150) + '...' : text
}

// ── Room passwords ────────────────────────────────────────────────────────────

function loadPasswords(): Record<string, string> {
  if (!existsSync(PASSWORDS_FILE)) return {}
  try { return JSON.parse(readFileSync(PASSWORDS_FILE, 'utf8')) } catch { return {} }
}

function hashPassword(pw: string): string {
  return createHash('sha256').update(pw).digest('hex')
}

export function isRoomProtected(docId: string): boolean {
  return sanitizeDocName(docId) in loadPasswords()
}

export function setRoomPassword(docId: string, password: string): void {
  const passwords = loadPasswords()
  passwords[sanitizeDocName(docId)] = hashPassword(password)
  writeFileSync(PASSWORDS_FILE, JSON.stringify(passwords))
}

/** Returns true if the room is unprotected, or if the password matches. */
export function checkRoomPassword(docId: string, password: string): boolean {
  const safeId = sanitizeDocName(docId)
  const passwords = loadPasswords()
  if (!(safeId in passwords)) return true
  return passwords[safeId] === hashPassword(password)
}

/** Delete all persisted data for a room. */
export function deleteRoom(docId: string): void {
  const safeId = sanitizeDocName(docId)
  // Document binary
  const binPath = join(DOCS_DIR, `${safeId}.bin`)
  if (existsSync(binPath)) unlinkSync(binPath)

  // Assets directory
  const assetsPath = join(DATA_DIR, 'assets', safeId)
  if (existsSync(assetsPath)) rmSync(assetsPath, { recursive: true, force: true })

  // Password entry
  const passwords = loadPasswords()
  if (safeId in passwords) {
    delete passwords[safeId]
    writeFileSync(PASSWORDS_FILE, JSON.stringify(passwords))
  }
}


// ── Users and Authentication ──────────────────────────────────────────────────

export interface UserProfile {
  passwordHash: string
  color: string
}

export function loadUsers(): Record<string, UserProfile> {
  if (!existsSync(USERS_FILE)) return {}
  try { return JSON.parse(readFileSync(USERS_FILE, 'utf8')) } catch { return {} }
}

const COLORS = ['#0066CC','#2E7D32','#C62828','#E65100','#6A1B9A','#00838F','#AD1457','#558B2F']
function randomColor() { return COLORS[Math.floor(Math.random() * COLORS.length)] }

export function registerUser(username: string, password: string): { ok: boolean; error?: string; color?: string } {
  if (!username || !password) return { ok: false, error: 'Username and password required' }
  const users = loadUsers()
  if (users[username]) return { ok: false, error: 'Username taken' }
  const color = randomColor()
  users[username] = { passwordHash: hashPassword(password), color }
  writeFileSync(USERS_FILE, JSON.stringify(users))
  return { ok: true, color }
}

export function loginUser(username: string, password: string): { ok: boolean; error?: string; color?: string } {
  const users = loadUsers()
  const user = users[username]
  if (!user || user.passwordHash !== hashPassword(password)) return { ok: false, error: 'Invalid credentials' }
  return { ok: true, color: user.color }
}

export function updateUser(oldUsername: string, newUsername: string, newPassword?: string, newColor?: string): { ok: boolean; error?: string } {
  const users = loadUsers()
  const user = users[oldUsername]
  if (!user) return { ok: false, error: 'User not found' }

  if (newUsername !== oldUsername && users[newUsername]) {
    return { ok: false, error: 'New username already taken' }
  }

  const updatedUser = { ...user }
  if (newPassword) updatedUser.passwordHash = hashPassword(newPassword)
  if (newColor) updatedUser.color = newColor

  if (newUsername !== oldUsername) {
    users[newUsername] = updatedUser
    delete users[oldUsername]

    // Update document ownership
    const owners = loadOwners()
    let changed = false
    for (const [docId, owner] of Object.entries(owners)) {
      if (owner === oldUsername) {
        owners[docId] = newUsername
        changed = true
      }
    }
    if (changed) writeFileSync(OWNERS_FILE, JSON.stringify(owners))
  } else {
    users[oldUsername] = updatedUser
  }

  writeFileSync(USERS_FILE, JSON.stringify(users))
  return { ok: true }
}


// ── Document Ownership ────────────────────────────────────────────────────────

function loadOwners(): Record<string, string> {
  if (!existsSync(OWNERS_FILE)) return {}
  try { return JSON.parse(readFileSync(OWNERS_FILE, 'utf8')) } catch { return {} }
}

export function setDocOwner(docId: string, username: string): void {
  const safeId = sanitizeDocName(docId)
  const owners = loadOwners()
  if (!owners[safeId]) {
    owners[safeId] = username
    writeFileSync(OWNERS_FILE, JSON.stringify(owners))
  }
}

export function getUserDocuments(username: string): string[] {
  const owners = loadOwners()
  return Object.keys(owners).filter(docId => owners[docId] === username)
}

export function getDocOwner(docId: string): string | undefined {
  return loadOwners()[sanitizeDocName(docId)]
}
