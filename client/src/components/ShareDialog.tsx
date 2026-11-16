import React, { useCallback, useEffect, useState } from 'react'
import { api, type LinkAccess, type Member, type Person } from '../lib/api'
import { Avatar, Icon, Modal, toast, toastError } from './ui'

interface Props {
  doc: { id: string; title: string }
  /** Only owners can change who has access; everyone else sees the list read-only. */
  canManage: boolean
  onClose: () => void
}

interface Sharing { owner: Person; members: Member[]; linkAccess: LinkAccess }

export function ShareDialog({ doc, canManage, onClose }: Props) {
  const [sharing, setSharing] = useState<Sharing | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'viewer' | 'editor'>('editor')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const base = `/docs/${doc.id}`

  const load = useCallback(() => api<Sharing>(`${base}/members`).then(setSharing).catch(toastError), [base])
  useEffect(() => { load() }, [load])

  const invite = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api(`${base}/members`, { method: 'PUT', body: { email, role } })
      setEmail('')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const changeRole = async (member: Member, value: string) => {
    try {
      if (value === 'remove') await api(`${base}/members/${member.id}`, { method: 'DELETE' })
      else await api(`${base}/members`, { method: 'PUT', body: { email: member.email, role: value } })
      await load()
    } catch (err) { toastError(err) }
  }

  const changeLink = async (linkAccess: LinkAccess) => {
    try {
      await api(base, { method: 'PATCH', body: { linkAccess } })
      setSharing(s => s && { ...s, linkAccess })
    } catch (err) { toastError(err) }
  }

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}/d/${doc.id}`).then(() => toast('Link copied'), () => toast('Could not copy the link', true))
  }

  const link = sharing?.linkAccess ?? 'none'

  return (
    <Modal title={`Share “${doc.title}”`} onClose={onClose} width={520} footer={<>
      <button className="btn" onClick={copyLink}><Icon name="link" size={16} />Copy link</button>
      <button className="btn btn-primary" onClick={onClose}>Done</button>
    </>}>
      {canManage && (
        <form onSubmit={invite} style={{ display: 'flex', gap: 8, marginBottom: error ? 10 : 18 }}>
          <input className="input" type="email" placeholder="Add people by email" aria-label="Email address" value={email} required autoFocus
            onChange={e => setEmail(e.target.value)} style={{ flex: 1 }} />
          <select className="select" aria-label="Permission" value={role} onChange={e => setRole(e.target.value as 'viewer' | 'editor')} style={{ height: 36 }}>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button className="btn btn-primary" style={{ height: 36 }} disabled={busy || !email.trim()}>Share</button>
        </form>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}

      <h3 className="section-title">People with access</h3>
      {!sharing ? <div className="spinner" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 20 }}>
          <PersonRow user={sharing.owner}><span style={{ color: 'var(--overlay)', fontSize: 13, padding: '0 8px' }}>Owner</span></PersonRow>
          {sharing.members.map(m => (
            <PersonRow key={m.id} user={m}>
              {canManage ? (
                <select className="select" aria-label={`Permission for ${m.name}`} value={m.role} onChange={e => changeRole(m, e.target.value)}>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                  <option value="remove">Remove access</option>
                </select>
              ) : <span style={{ color: 'var(--overlay)', fontSize: 13, padding: '0 8px', textTransform: 'capitalize' }}>{m.role}</span>}
            </PersonRow>
          ))}
        </div>
      )}

      <h3 className="section-title">General access</h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 36, height: 36, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: link === 'none' ? 'var(--track)' : 'var(--green-soft)', color: link === 'none' ? 'var(--subtext)' : 'var(--green)' }}>
          <Icon name={link === 'none' ? 'lock' : 'globe'} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 550 }}>{link === 'none' ? 'Restricted' : 'Anyone with the link'}</div>
          <div style={{ fontSize: 12, color: 'var(--subtext)' }}>
            {link === 'none' ? 'Only people added above can open this document.'
              : `Any signed-in user who has the link can ${link === 'editor' ? 'edit' : 'view'}.`}
          </div>
        </div>
        {canManage && (
          <select className="select" aria-label="General access" value={link} onChange={e => changeLink(e.target.value as LinkAccess)}>
            <option value="none">Restricted</option>
            <option value="viewer">Link: can view</option>
            <option value="editor">Link: can edit</option>
          </select>
        )}
      </div>
    </Modal>
  )
}

function PersonRow({ user, children }: { user: Person; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0' }}>
      <Avatar name={user.name} color={user.color} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="truncate" style={{ fontWeight: 550 }}>{user.name}</div>
        <div className="truncate" style={{ fontSize: 12, color: 'var(--subtext)' }}>{user.email}</div>
      </div>
      {children}
    </div>
  )
}
