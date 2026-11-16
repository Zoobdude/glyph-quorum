import { Router } from 'express'
import { authenticate, requireUser } from '../auth.js'
import { rateLimit } from '../security.js'
import { accounts } from './accounts.js'
import { setup } from './setup.js'
import { admin } from './admin.js'
import { documents } from './documents.js'
import { sharing } from './sharing.js'
import { render } from './render.js'
import { assets } from './assets.js'
import { versions } from './versions.js'
import { references } from './references.js'

/**
 * The JSON API, mounted at /api.
 *
 *   setup      /setup                        first-run wizard (only while no accounts exist)
 *   accounts   /auth/*                       sign-up, sign-in, profile
 *   admin      /admin/*                      users, invites, settings (administrators only)
 *   documents  /docs, /docs/:id, …/copy      the file manager
 *   sharing    /docs/:id/members             who has access
 *   render     /docs/:id/compile, …/thumbnail
 *   assets     /docs/:id/assets              uploaded files
 *   versions   /docs/:id/versions            history and restore
 *   references /refs                         personal reference library
 */
export const api = Router()

api.use(authenticate)
api.use(rateLimit('api', 900, 60_000))
api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next() })

api.get('/health', (_req, res) => res.json({ ok: true }))

// First-run setup, sign-up, sign-in and sign-out are the only routes that work without a session…
api.use(setup, accounts)

// …everything registered below this line requires a signed-in user.
api.use(requireUser)
api.use(documents, sharing, render, assets, versions, references, admin)

api.use((_req, res) => { res.status(404).json({ error: 'Not found' }) })
