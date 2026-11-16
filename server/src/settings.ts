import { randomBytes } from 'crypto'
import { db } from './db.js'

export type RegistrationMode = 'open' | 'invite' | 'closed'
export const REGISTRATION_MODES: RegistrationMode[] = ['open', 'invite', 'closed']

export interface ServerSettings {
  serverName: string
  registration: RegistrationMode
}

const DEFAULTS: ServerSettings = {
  serverName: 'Ligature',
  // ALLOW_REGISTRATION=false (the previous on/off switch) still works as the initial default.
  registration: process.env.ALLOW_REGISTRATION === 'false' ? 'invite' : 'open',
}

const selectAll = db.prepare('SELECT key, value FROM settings')
const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')

let cache: ServerSettings | null = null

export function getSettings(): ServerSettings {
  if (cache) return cache
  const stored = Object.fromEntries((selectAll.all() as { key: string; value: string }[]).map(r => [r.key, r.value]))
  cache = {
    serverName: stored.serverName ?? DEFAULTS.serverName,
    registration: REGISTRATION_MODES.includes(stored.registration as RegistrationMode) ? stored.registration as RegistrationMode : DEFAULTS.registration,
  }
  return cache
}

export function saveSettings(patch: Partial<ServerSettings>): ServerSettings {
  db.transaction(() => {
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) upsert.run(key, String(value))
  })()
  cache = null
  return getSettings()
}

// ── First-run setup ──────────────────────────────────────────────────────────

const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users')
export const setupRequired = (): boolean => (countUsers.get() as { n: number }).n === 0

/**
 * Proof that the person running setup controls the server. Without it, whoever
 * reaches a freshly started server first would become its administrator.
 * Set SETUP_TOKEN to choose one; otherwise a random code is printed to the server log.
 */
let setupToken: string | null = null

export function setupCode(): string {
  setupToken ??= process.env.SETUP_TOKEN?.trim() || randomBytes(4).toString('hex').toUpperCase().replace(/(.{4})/, '$1-')
  return setupToken
}

export function announceSetup(): void {
  if (!setupRequired()) return
  const code = setupCode()
  console.log('  ┌──────────────────────────────────────────────────────────┐')
  console.log('  │  First-run setup: open the app in a browser and enter   │')
  console.log(`  │  this setup code:  ${(process.env.SETUP_TOKEN ? '(the SETUP_TOKEN you configured)' : code).padEnd(38)}│`)
  console.log('  └──────────────────────────────────────────────────────────┘\n')
}

export function checkSetupCode(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const normalise = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return normalise(value) === normalise(setupCode())
}
