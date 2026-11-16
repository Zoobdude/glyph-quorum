import { Router } from 'express'
import { createUser, startSession } from '../auth.js'
import { h, str, HttpError, rateLimit } from '../security.js'
import { setupRequired, checkSetupCode, saveSettings, REGISTRATION_MODES, type RegistrationMode } from '../settings.js'
import { adoptLegacyRooms } from '../documents.js'
import { audit } from '../audit.js'
import { publicUser, email, password } from './common.js'

/**
 * First-run setup. Only works while the server has no accounts, and only for
 * someone who can read the setup code from the server log (or SETUP_TOKEN).
 */
export const setup = Router()

const limit = rateLimit('setup', 10, 15 * 60_000)

function requireSetupCode(code: unknown): void {
  if (!setupRequired()) throw new HttpError(409, 'This server is already set up')
  if (!checkSetupCode(code)) throw new HttpError(403, 'That setup code is not correct. Check the server log for the current code.')
}

/** Step 1 of the wizard: confirm the code before asking for anything else. */
setup.post('/setup/verify', limit, h((req, res) => {
  requireSetupCode(req.body.code)
  res.json({ ok: true })
}))

/** Final step: create the administrator, store the server settings, and sign in. */
setup.post('/setup', limit, h(async (req, res) => {
  requireSetupCode(req.body.code)
  const addr = email(req.body.email)
  const name = str(req.body.name, 'Name', 1, 60)
  const pw = password(req.body.password)
  const serverName = str(req.body.serverName ?? 'Ligature', 'Server name', 1, 40)
  const registration = req.body.registration as RegistrationMode
  if (!REGISTRATION_MODES.includes(registration)) throw new HttpError(400, 'Choose who can sign up')

  const admin = await createUser(addr, name, pw, 'admin', () => {
    if (!setupRequired()) throw new HttpError(409, 'This server is already set up')
  })
  saveSettings({ serverName, registration })
  const adopted = adoptLegacyRooms(admin.id)
  audit(admin, 'server.setup', `Registration: ${registration}${adopted ? `; migrated ${adopted} legacy room(s)` : ''}`)

  startSession(req, res, admin.id)
  res.status(201).json({ user: publicUser(admin), adopted })
}))
