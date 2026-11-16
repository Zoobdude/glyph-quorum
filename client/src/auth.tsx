import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, UNAUTHORIZED_EVENT, type RegistrationMode, type User } from './lib/api'
import { setThemeChoice, useTheme, type ThemeChoice } from './lib/theme'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { APP_NAME, APP_TAGLINE, LOGO_URL } from './lib/brand'
import { Avatar, Icon, MenuButton, MenuItem, Modal, toast, toastError } from './components/ui'

interface ServerInfo {
  /** undefined while the session is being checked, null when signed out. */
  user: User | null | undefined
  /** True on a brand-new server until the first administrator has been created. */
  setupRequired: boolean
  serverName: string
  registration: RegistrationMode
  colors: string[]
}
interface AuthState extends ServerInfo {
  setUser: (user: User | null) => void
  /** Re-read server info (after setup or a settings change). */
  refresh: () => Promise<void>
}

const INITIAL: ServerInfo = { user: undefined, setupRequired: false, serverName: APP_NAME, registration: 'open', colors: [] }
const AuthContext = createContext<AuthState>({ ...INITIAL, setUser: () => {}, refresh: async () => {} })

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ServerInfo>(INITIAL)
  const setUser = useCallback((user: User | null) => setState(s => ({ ...s, user })), [])
  const refresh = useCallback(() => api<ServerInfo>('/auth/me').then(setState).catch(() => setState(s => ({ ...s, user: null }))), [])

  useEffect(() => {
    refresh()
    const signedOut = () => setUser(null)
    window.addEventListener(UNAUTHORIZED_EVENT, signedOut)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, signedOut)
  }, [refresh, setUser])

  return <AuthContext.Provider value={{ ...state, setUser, refresh }}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
/** The signed-in user; only call beneath the auth gate in App. */
export const useUser = (): User => useContext(AuthContext).user!

/**
 * Where to go after signing in. Only same-app paths are honoured, so a crafted
 * link cannot use the sign-in page to bounce someone to another site.
 */
export function nextPath(params: URLSearchParams): string | null {
  const next = params.get('next')
  return next && /^\/(?![/\\])/.test(next) ? next : null
}

// ── Sign in / sign up page ───────────────────────────────────────────────────

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { setUser, registration, serverName } = useAuth()
  const [params] = useSearchParams()
  // An invite link (/signup?invite=…) lets someone join even when sign-ups are not open.
  const invite = params.get('invite') ?? ''
  const [inviteEmail, setInviteEmail] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState('')
  const registrationOpen = registration === 'open' || (registration === 'invite' && !!invite && !inviteError)
  // RequireAuth sends signed-out visitors here with ?next=<where they were going>.
  const sharedLink = nextPath(params)?.startsWith('/d/') ?? false
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const signup = mode === 'signup' && registrationOpen

  useEffect(() => setError(''), [mode])
  useEffect(() => {
    if (!invite) return
    api<{ email: string | null }>(`/auth/invite/${encodeURIComponent(invite)}`)
      .then(r => { setInviteEmail(r.email); if (r.email) setEmail(r.email) })
      .catch(e => setInviteError((e as Error).message))
  }, [invite])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { user } = await api<{ user: User }>(signup ? '/auth/register' : '/auth/login', { body: signup ? { email, name, password, invite: invite || undefined } : { email, password } })
      setUser(user) // the route guard then redirects to ?next or the file manager
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><img src={LOGO_URL} alt="" /><b>{APP_NAME}</b></div>
        <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
        <p className="sub">
          {sharedLink ? 'Sign in to open this document.'
            : signup ? (invite ? `You have been invited to join ${serverName}.` : APP_TAGLINE)
            : serverName !== APP_NAME ? `Sign in to ${serverName}.` : 'Sign in to your documents.'}
        </p>

        {error && <div className="form-error" role="alert">{error}</div>}
        {mode === 'signup' && inviteError && <div className="form-error" role="alert">{inviteError}</div>}
        {mode === 'signup' && !signup && !inviteError && (
          <div className="form-error" role="alert">
            {registration === 'invite' ? 'You need an invite link from an administrator to create an account here.' : 'Sign-ups are closed on this server. Ask an administrator for an account.'}
          </div>
        )}

        {signup && (
          <div className="field">
            <label className="label" htmlFor="name">Name</label>
            <input id="name" className="input" value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={60} required autoFocus />
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="email">Email</label>
          <input id="email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" maxLength={254} required autoFocus={!signup}
            readOnly={signup && !!inviteEmail} title={signup && inviteEmail ? 'This invite is for this address' : undefined} />
        </div>
        <div className="field">
          <label className="label" htmlFor="password">Password</label>
          <input id="password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete={signup ? 'new-password' : 'current-password'} minLength={signup ? 8 : undefined} maxLength={200} required />
          {signup && <p style={{ fontSize: 12, color: 'var(--overlay)', marginTop: 6 }}>At least 8 characters.</p>}
        </div>

        <button className="btn btn-primary btn-lg btn-block" disabled={busy} style={{ marginTop: 6 }}>
          {busy ? 'One moment…' : signup ? 'Create account' : 'Sign in'}
        </button>

        <p className="switch">
          {signup
            ? <>Already have an account? <Link to={{ pathname: '/login', search: params.toString() }} replace>Sign in</Link></>
            : registrationOpen
              ? <>New here? <Link to={{ pathname: '/signup', search: params.toString() }} replace>Create an account</Link></>
              : registration === 'invite' ? 'New accounts are by invitation only.' : 'Sign-ups are closed on this server.'}
        </p>
      </form>
    </div>
  )
}

// ── Account menu + settings ──────────────────────────────────────────────────

const THEMES: { id: ThemeChoice; label: string; icon: 'sun' | 'moon' | 'monitor' }[] = [
  { id: 'light', label: 'Light theme', icon: 'sun' },
  { id: 'dark', label: 'Dark theme', icon: 'moon' },
  { id: 'system', label: 'Match system', icon: 'monitor' },
]

export function AccountMenu() {
  const { setUser } = useAuth()
  const user = useUser()
  const navigate = useNavigate()
  const { choice } = useTheme()
  const [settings, setSettings] = useState(false)

  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {})
    navigate('/login', { replace: true })
    setUser(null)
  }

  return (
    <>
      <MenuButton className="avatar-btn" title={`${user.name} — account`} align="right" menu={<>
        <div className="menu-header">
          <div style={{ fontWeight: 600 }} className="truncate">{user.name}</div>
          <div style={{ fontSize: 12, color: 'var(--subtext)' }} className="truncate">{user.email}</div>
        </div>
        <div className="menu-sep" />
        <MenuItem icon="file" onClick={() => navigate('/')}>My documents</MenuItem>
        <MenuItem icon="book" onClick={() => navigate('/references')}>Reference library</MenuItem>
        {user.role === 'admin' && <MenuItem icon="shield" onClick={() => navigate('/admin')}>Admin centre</MenuItem>}
        <div className="menu-sep" />
        {THEMES.map(t => (
          <MenuItem key={t.id} icon={t.icon} checked={choice === t.id} onClick={() => setThemeChoice(t.id)}>{t.label}</MenuItem>
        ))}
        <div className="menu-sep" />
        <MenuItem icon="user" onClick={() => setSettings(true)}>Account settings</MenuItem>
        <MenuItem icon="logout" onClick={signOut}>Sign out</MenuItem>
      </>}>
        <Avatar name={user.name} color={user.color} title={`${user.name} — account`} />
      </MenuButton>
      {settings && <AccountDialog onClose={() => setSettings(false)} />}
    </>
  )
}

function AccountDialog({ onClose }: { onClose: () => void }) {
  const { setUser, colors } = useAuth()
  const user = useUser()
  const [name, setName] = useState(user.name)
  const [color, setColor] = useState(user.color)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [pwError, setPwError] = useState('')

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const { user: updated } = await api<{ user: User }>('/auth/me', { method: 'PATCH', body: { name, color } })
      setUser(updated)
      toast('Profile saved')
    } catch (err) { toastError(err) }
  }

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwError('')
    try {
      await api('/auth/password', { body: { current, next } })
      setCurrent(''); setNext('')
      toast('Password changed — other devices were signed out')
    } catch (err) { setPwError((err as Error).message) }
  }

  return (
    <Modal title="Account settings" onClose={onClose}>
      <form onSubmit={saveProfile}>
        <div className="field">
          <label className="label" htmlFor="acc-name">Display name</label>
          <input id="acc-name" className="input" value={name} maxLength={60} required onChange={e => setName(e.target.value)} />
        </div>
        <div className="field">
          <span className="label">Cursor colour</span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {colors.map(c => (
              <button key={c} type="button" aria-label={`Colour ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
                style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: '2px solid var(--surface)', boxShadow: color === c ? `0 0 0 2px ${c}` : 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                {color === c && <Icon name="check" size={14} />}
              </button>
            ))}
          </div>
        </div>
        <button className="btn btn-primary" disabled={!name.trim() || (name === user.name && color === user.color)}>Save profile</button>
      </form>

      <div className="menu-sep" style={{ margin: '22px 0 18px' }} />

      <form onSubmit={savePassword}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Change password</h3>
        {pwError && <div className="form-error" role="alert">{pwError}</div>}
        {/* Hidden username field so password managers associate the new password with the right account. */}
        <input type="email" value={user.email} autoComplete="username" readOnly hidden />
        <div className="field">
          <label className="label" htmlFor="acc-current">Current password</label>
          <input id="acc-current" className="input" type="password" autoComplete="current-password" value={current} required onChange={e => setCurrent(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="acc-next">New password</label>
          <input id="acc-next" className="input" type="password" autoComplete="new-password" minLength={8} maxLength={200} value={next} required onChange={e => setNext(e.target.value)} />
        </div>
        <button className="btn" disabled={!current || next.length < 8}>Change password</button>
      </form>
    </Modal>
  )
}
