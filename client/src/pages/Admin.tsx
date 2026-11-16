import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { api, formatSize, timeAgo, type RegistrationMode, type User } from '../lib/api'
import { useAuth, useUser } from '../auth'
import { PageShell, Secret } from '../components/PageShell'
import { Avatar, Confirm, Icon, Menu, MenuItem, Modal, toast, toastError, type IconName } from '../components/ui'
import { REGISTRATION_CHOICES } from './Setup'

type Tab = 'overview' | 'users' | 'invites' | 'settings' | 'activity'
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'chart' },
  { id: 'users', label: 'Users', icon: 'users' },
  { id: 'invites', label: 'Invites', icon: 'mail' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
  { id: 'activity', label: 'Activity', icon: 'history' },
]

interface AdminUser extends User { createdAt: number; lastLoginAt: number | null; disabledAt: number | null; documents: number; storage: number }
interface Invite { id: string; email: string | null; role: User['role']; createdBy: string | null; createdAt: number; expiresAt: number; maxUses: number; uses: number; revokedAt: number | null }
interface AuditEntry { id: number; at: number; actorName: string; action: string; detail: string }
interface Stats {
  users: number; admins: number; disabled: number; activeWeek: number; documents: number; trashed: number; editedWeek: number
  sessions: number; liveUsers: number; openDocuments: number; storage: { database: number; files: number }; uptime: number; version: string
}

const ACTIONS: Record<string, string> = {
  'server.setup': 'Set up the server', 'user.created': 'Created an account', 'user.renamed': 'Renamed a user', 'user.role': 'Changed a role',
  'user.disabled': 'Disabled an account', 'user.enabled': 'Re-enabled an account', 'user.password-reset': 'Reset a password',
  'user.signed-out': 'Signed a user out', 'user.deleted': 'Deleted an account', 'invite.created': 'Created an invite',
  'invite.revoked': 'Revoked an invite', 'invite.accepted': 'Invite accepted', 'settings.changed': 'Changed settings',
}

const duration = (s: number) => (s < 3600 ? `${Math.max(1, Math.round(s / 60))} min` : s < 86400 ? `${Math.round(s / 3600)} hr` : `${Math.round(s / 86400)} days`)
const dateTime = (ts: number) => new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function Admin() {
  const [tab, setTab] = useState<Tab>('overview')
  return (
    <PageShell title="Admin centre">
      <div className="page-head"><h1>Admin centre</h1></div>
      <div className="tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={16} />{t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview onSeeAll={() => setTab('activity')} />}
      {tab === 'users' && <Users />}
      {tab === 'invites' && <Invites />}
      {tab === 'settings' && <Settings />}
      {tab === 'activity' && <Activity />}
    </PageShell>
  )
}

/** Fetch on mount, with a reload function for after changes. */
function useLoad<T>(path: string): [T | null, () => Promise<void>] {
  const [data, setData] = useState<T | null>(null)
  const load = useCallback(() => api<T>(path).then(setData).catch(toastError), [path])
  useEffect(() => { load() }, [load])
  return [data, load]
}

// ── Overview ─────────────────────────────────────────────────────────────────

function Overview({ onSeeAll }: { onSeeAll: () => void }) {
  const [data] = useLoad<{ stats: Stats; activity: AuditEntry[] }>('/admin/overview')
  if (!data) return <div className="spinner" />
  const s = data.stats
  return (
    <>
      <div className="stats">
        <div className="stat"><div className="v">{s.users}</div><div className="l">Users</div><div className="d">{s.activeWeek} signed in this week · {s.admins} {s.admins === 1 ? 'admin' : 'admins'}{s.disabled ? ` · ${s.disabled} disabled` : ''}</div></div>
        <div className="stat"><div className="v">{s.documents}</div><div className="l">Documents</div><div className="d">{s.editedWeek} edited this week · {s.trashed} in trash</div></div>
        <div className="stat"><div className="v">{s.liveUsers}</div><div className="l">Editing right now</div><div className="d">{s.openDocuments} open {s.openDocuments === 1 ? 'document' : 'documents'} · {s.sessions} active sessions</div></div>
        <div className="stat"><div className="v">{formatSize(s.storage.database + s.storage.files)}</div><div className="l">Storage used</div><div className="d">{formatSize(s.storage.files)} uploads · {formatSize(s.storage.database)} database</div></div>
      </div>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ flex: 1 }}>Recent admin activity</h2>
          <button className="btn btn-ghost" onClick={onSeeAll}>See all</button>
        </div>
        <ActivityList entries={data.activity} />
      </div>
      <p className="hint" style={{ marginTop: 14, fontSize: 12 }}>Version {s.version} · up for {duration(s.uptime)}</p>
    </>
  )
}

function ActivityList({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <p className="hint">Nothing yet. Changes made in the admin centre are recorded here.</p>
  return (
    <div>
      {entries.map(e => (
        <div key={e.id} className="activity">
          <time dateTime={new Date(e.at).toISOString()}>{dateTime(e.at)}</time>
          <div style={{ minWidth: 0 }}>
            <div><b style={{ fontWeight: 600 }}>{e.actorName}</b> · {ACTIONS[e.action] ?? e.action}</div>
            {e.detail && <div style={{ color: 'var(--subtext)', wordBreak: 'break-word' }}>{e.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

function Activity() {
  const [data] = useLoad<{ entries: AuditEntry[] }>('/admin/audit?limit=300')
  return <div className="card">{data ? <ActivityList entries={data.entries} /> : <div className="spinner" />}</div>
}

// ── Users ────────────────────────────────────────────────────────────────────

type UserDialog =
  | { kind: 'add' }
  | { kind: 'password'; user: AdminUser; password: string; created?: boolean }
  | { kind: 'reset' | 'delete' | 'disable'; user: AdminUser }
  | null

function Users() {
  const me = useUser()
  const [data, reload] = useLoad<{ users: AdminUser[] }>('/admin/users')
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ user: AdminUser; anchor: HTMLElement } | null>(null)
  const [dialog, setDialog] = useState<UserDialog>(null)

  const users = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.users ?? []).filter(u => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
  }, [data, query])

  const act = async (call: () => Promise<unknown>, done: string) => {
    try { await call(); toast(done) } catch (e) { toastError(e) }
    reload()
  }
  const patch = (u: AdminUser, body: Record<string, unknown>, done: string) => act(() => api(`/admin/users/${u.id}`, { method: 'PATCH', body }), done)

  const resetPassword = async (u: AdminUser) => {
    try {
      const { temporaryPassword } = await api<{ temporaryPassword: string }>(`/admin/users/${u.id}/reset-password`, { method: 'POST' })
      setDialog({ kind: 'password', user: u, password: temporaryPassword })
    } catch (e) { toastError(e) }
  }

  const m = menu?.user
  const self = m?.id === me.id

  return (
    <>
      <div className="page-head" style={{ marginBottom: 14 }}>
        <input className="input" type="search" placeholder="Search by name or email" aria-label="Search users" value={query} onChange={e => setQuery(e.target.value)} />
        <div style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setDialog({ kind: 'add' })}><Icon name="plus" size={16} />Add user</button>
      </div>

      {!data ? <div className="spinner" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>User</th><th>Role</th><th className="num">Documents</th><th className="num">Uploads</th><th>Last sign-in</th><th>Joined</th><th style={{ width: 48 }} /></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={u.disabledAt ? { opacity: 0.6 } : undefined}>
                  <td>
                    <div className="who">
                      <Avatar name={u.name} color={u.color} size={32} />
                      <div style={{ minWidth: 0 }}>
                        <div className="strong truncate">{u.name}{u.id === me.id && <span style={{ color: 'var(--overlay)', fontWeight: 400 }}> (you)</span>}</div>
                        <div className="truncate" style={{ fontSize: 12 }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {u.disabledAt ? <span className="tag bad">Disabled</span>
                      : u.role === 'admin' ? <span className="tag accent"><Icon name="shield" size={12} />Admin</span>
                      : <span className="tag">User</span>}
                  </td>
                  <td className="num">{u.documents}</td>
                  <td className="num">{u.storage ? formatSize(u.storage) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Never'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                  <td><button className="icon-btn" aria-label={`Actions for ${u.name}`} onClick={e => setMenu({ user: u, anchor: e.currentTarget })}><Icon name="more" /></button></td>
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28 }}>No users match “{query}”.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {menu && m && (
        <Menu anchor={menu.anchor} align="right" onClose={() => setMenu(null)}>
          {m.role === 'admin'
            ? <MenuItem icon="user" disabled={self} onClick={() => patch(m, { role: 'user' }, `${m.name} is now a standard user`)}>Make standard user</MenuItem>
            : <MenuItem icon="shield" disabled={!!m.disabledAt} onClick={() => patch(m, { role: 'admin' }, `${m.name} is now an administrator`)}>Make administrator</MenuItem>}
          <MenuItem icon="key" onClick={() => setDialog({ kind: 'reset', user: m })}>Reset password…</MenuItem>
          <MenuItem icon="logout" disabled={self} onClick={() => act(() => api(`/admin/users/${m.id}/sign-out`, { method: 'POST' }), `${m.name} was signed out everywhere`)}>Sign out everywhere</MenuItem>
          <div className="menu-sep" />
          {m.disabledAt
            ? <MenuItem icon="restore" onClick={() => patch(m, { disabled: false }, `${m.name} can sign in again`)}>Re-enable account</MenuItem>
            : <MenuItem icon="lock" disabled={self} onClick={() => setDialog({ kind: 'disable', user: m })}>Disable account…</MenuItem>}
          <MenuItem icon="trash" danger disabled={self} onClick={() => setDialog({ kind: 'delete', user: m })}>Delete account…</MenuItem>
        </Menu>
      )}

      {dialog?.kind === 'add' && <AddUser onClose={() => setDialog(null)} onCreated={(user, password) => { reload(); setDialog({ kind: 'password', user, password, created: true }) }} />}
      {dialog?.kind === 'reset' && (
        <Confirm title="Reset password?" action="Reset password" onClose={() => setDialog(null)} onConfirm={() => resetPassword(dialog.user)}
          message={<>{dialog.user.name} will be signed out everywhere and their current password will stop working. You will be shown a temporary password to pass on.</>} />
      )}
      {dialog?.kind === 'disable' && (
        <Confirm title="Disable account?" action="Disable account" danger onClose={() => setDialog(null)}
          onConfirm={() => patch(dialog.user, { disabled: true }, `${dialog.user.name} was disabled`)}
          message={<>{dialog.user.name} will be signed out immediately and will not be able to sign in. Their documents and sharing stay as they are, and you can re-enable the account at any time.</>} />
      )}
      {dialog?.kind === 'password' && (
        <Modal title={dialog.created ? 'Account created' : 'Temporary password'} onClose={() => setDialog(null)} width={460}
          footer={<button className="btn btn-primary" onClick={() => setDialog(null)}>Done</button>}>
          <p className="hint" style={{ marginBottom: 12 }}>
            Give this temporary password to {dialog.user.name} ({dialog.user.email}) over a channel you trust, and ask them to change it in Account settings. It will not be shown again.
          </p>
          <Secret value={dialog.password} />
        </Modal>
      )}
      {dialog?.kind === 'delete' && <DeleteUser user={dialog.user} onClose={() => setDialog(null)} onDone={reload} />}
    </>
  )
}

function AddUser({ onClose, onCreated }: { onClose: () => void; onCreated: (user: AdminUser, password: string) => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<User['role']>('user')
  const [error, setError] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const r = await api<{ user: AdminUser; temporaryPassword: string }>('/admin/users', { body: { name, email, role } })
      onCreated(r.user, r.temporaryPassword)
    } catch (err) { setError((err as Error).message) }
  }
  return (
    <Modal title="Add user" onClose={onClose} width={440}>
      <form onSubmit={submit}>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="field"><label className="label" htmlFor="au-name">Name</label><input id="au-name" className="input" value={name} onChange={e => setName(e.target.value)} maxLength={60} required autoFocus /></div>
        <div className="field"><label className="label" htmlFor="au-email">Email</label><input id="au-email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} maxLength={254} required /></div>
        <div className="field">
          <label className="label" htmlFor="au-role">Role</label>
          <select id="au-role" className="select" style={{ width: '100%', height: 36 }} value={role} onChange={e => setRole(e.target.value as User['role'])}>
            <option value="user">Standard user</option>
            <option value="admin">Administrator</option>
          </select>
        </div>
        <p className="hint" style={{ fontSize: 12, marginBottom: 16 }}>A temporary password is generated for you to pass on. To let someone choose their own password, send an invite instead.</p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary">Create account</button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteUser({ user, onClose, onDone }: { user: AdminUser; onClose: () => void; onDone: () => void }) {
  const [documents, setDocuments] = useState<'transfer' | 'delete'>('transfer')
  const [typed, setTyped] = useState('')
  const remove = async () => {
    try {
      await api(`/admin/users/${user.id}?documents=${documents}`, { method: 'DELETE' })
      toast(`${user.name}'s account was deleted`)
      onClose()
    } catch (e) { toastError(e) }
    onDone()
  }
  return (
    <Modal title={`Delete ${user.name}?`} onClose={onClose} width={480} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-danger" disabled={typed.trim().toLowerCase() !== user.email.toLowerCase()} onClick={remove}>Delete account</button>
    </>}>
      <p className="hint" style={{ marginBottom: 14 }}>This permanently removes the account, its reference library and its access to shared documents. It cannot be undone.</p>
      {user.documents > 0 && (
        <div className="field" role="radiogroup" aria-label="What happens to their documents">
          <span className="label">Their {user.documents} {user.documents === 1 ? 'document' : 'documents'}</span>
          <label className={`choice${documents === 'transfer' ? ' selected' : ''}`}>
            <input type="radio" checked={documents === 'transfer'} onChange={() => setDocuments('transfer')} />
            <div><b>Transfer to me</b><span>You become the owner. Existing sharing is kept.</span></div>
          </label>
          <label className={`choice${documents === 'delete' ? ' selected' : ''}`}>
            <input type="radio" checked={documents === 'delete'} onChange={() => setDocuments('delete')} />
            <div><b>Delete them too</b><span>The documents, their files and version history are erased for everyone.</span></div>
          </label>
        </div>
      )}
      <div className="field" style={{ marginBottom: 0 }}>
        <label className="label" htmlFor="du-confirm">Type <span className="mono">{user.email}</span> to confirm</label>
        <input id="du-confirm" className="input" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
      </div>
    </Modal>
  )
}

// ── Invites ──────────────────────────────────────────────────────────────────

function Invites() {
  const { registration } = useAuth()
  const [data, reload] = useLoad<{ invites: Invite[] }>('/admin/invites')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<User['role']>('user')
  const [days, setDays] = useState(7)
  const [maxUses, setMaxUses] = useState(1)
  const [link, setLink] = useState<{ url: string; email: string | null } | null>(null)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const { invite, token } = await api<{ invite: Invite; token: string }>('/admin/invites', { body: { email: email.trim() || undefined, role, days, maxUses } })
      setLink({ url: `${window.location.origin}/signup?invite=${token}`, email: invite.email })
      setEmail('')
      reload()
    } catch (err) { toastError(err) }
  }
  const revoke = async (i: Invite) => {
    try { await api(`/admin/invites/${i.id}`, { method: 'DELETE' }); toast('Invite revoked') } catch (e) { toastError(e) }
    reload()
  }
  const status = (i: Invite): [string, string] =>
    i.revokedAt ? ['Revoked', 'bad'] : i.uses >= i.maxUses ? ['Used', ''] : i.expiresAt < Date.now() ? ['Expired', ''] : ['Active', 'good']

  return (
    <>
      {registration === 'closed' && <div className="banner" style={{ borderRadius: 'var(--radius-sm)', border: '1px solid var(--warn-line)', marginBottom: 16 }}>Sign-ups are closed, so invite links will not work. Change this under Settings.</div>}
      <form className="card" onSubmit={create}>
        <h2>Invite someone</h2>
        <p className="hint" style={{ marginBottom: 14 }}>Creates a sign-up link. Leave the email blank for a link that anyone you send it to can use.</p>
        <div className="row">
          <div className="field" style={{ flex: '2 1 220px' }}><label className="label" htmlFor="iv-email">Email (optional)</label><input id="iv-email" className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" maxLength={254} /></div>
          <div className="field"><label className="label" htmlFor="iv-role">Role</label>
            <select id="iv-role" className="select" style={{ height: 36 }} value={role} onChange={e => setRole(e.target.value as User['role'])}><option value="user">Standard user</option><option value="admin">Administrator</option></select></div>
          <div className="field"><label className="label" htmlFor="iv-days">Expires in</label>
            <select id="iv-days" className="select" style={{ height: 36 }} value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></div>
          {!email.trim() && (
            <div className="field"><label className="label" htmlFor="iv-uses">Uses</label>
              <select id="iv-uses" className="select" style={{ height: 36 }} value={maxUses} onChange={e => setMaxUses(Number(e.target.value))}>{[1, 5, 10, 25, 100].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
          )}
          <button className="btn btn-primary" style={{ height: 36 }}><Icon name="link" size={16} />Create invite link</button>
        </div>
      </form>

      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="table">
          <thead><tr><th>For</th><th>Role</th><th>Status</th><th className="num">Used</th><th>Expires</th><th>Created by</th><th style={{ width: 90 }} /></tr></thead>
          <tbody>
            {(data?.invites ?? []).map(i => {
              const [label, tone] = status(i)
              return (
                <tr key={i.id}>
                  <td className="strong">{i.email ?? 'Anyone with the link'}</td>
                  <td>{i.role === 'admin' ? 'Administrator' : 'Standard user'}</td>
                  <td><span className={`tag ${tone}`}>{label}</span></td>
                  <td className="num">{i.uses} / {i.maxUses}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{dateTime(i.expiresAt)}</td>
                  <td>{i.createdBy ?? '—'}</td>
                  <td>{label === 'Active' && <button className="btn btn-ghost" style={{ height: 28 }} onClick={() => revoke(i)}>Revoke</button>}</td>
                </tr>
              )
            })}
            {data && data.invites.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28 }}>No invites yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {link && (
        <Modal title="Invite link created" onClose={() => setLink(null)} width={520} footer={<button className="btn btn-primary" onClick={() => setLink(null)}>Done</button>}>
          <p className="hint" style={{ marginBottom: 12 }}>
            Send this link to {link.email ?? 'the people you want to invite'}. It will not be shown again — if you lose it, revoke the invite and create a new one.
          </p>
          <Secret value={link.url} />
        </Modal>
      )}
    </>
  )
}

// ── Settings ─────────────────────────────────────────────────────────────────

function Settings() {
  const { refresh } = useAuth()
  const [data] = useLoad<{ settings: { serverName: string; registration: RegistrationMode } }>('/admin/settings')
  const [serverName, setServerName] = useState('')
  const [registration, setRegistration] = useState<RegistrationMode>('invite')
  useEffect(() => { if (data) { setServerName(data.settings.serverName); setRegistration(data.settings.registration) } }, [data])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api('/admin/settings', { method: 'PATCH', body: { serverName, registration } })
      await refresh()
      toast('Settings saved')
    } catch (err) { toastError(err) }
  }
  if (!data) return <div className="spinner" />
  return (
    <form onSubmit={save} style={{ maxWidth: 620 }}>
      <div className="card">
        <h2>Server name</h2>
        <p className="hint" style={{ marginBottom: 12 }}>Shown on the sign-in page and in invitations.</p>
        <input className="input" aria-label="Server name" value={serverName} onChange={e => setServerName(e.target.value)} maxLength={40} required />
      </div>
      <div className="card" role="radiogroup" aria-label="Who can sign up">
        <h2>Who can sign up</h2>
        <p className="hint" style={{ marginBottom: 12 }}>Existing accounts are not affected by this setting.</p>
        {REGISTRATION_CHOICES.map(c => (
          <label key={c.id} className={`choice${registration === c.id ? ' selected' : ''}`}>
            <input type="radio" name="registration" checked={registration === c.id} onChange={() => setRegistration(c.id)} />
            <div><b>{c.title}</b><span>{c.detail}</span></div>
          </label>
        ))}
      </div>
      <button className="btn btn-primary" style={{ marginTop: 16 }}>Save settings</button>
    </form>
  )
}
