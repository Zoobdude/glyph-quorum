import React, { useState, useRef, useCallback } from 'react'
import { Toolbar } from './components/Toolbar'
import { Editor } from './components/Editor'
import { Preview } from './components/Preview'
import { Sidebar } from './components/Sidebar'
import { useCollab } from './hooks/useCollab'
import { useCompiler } from './hooks/useCompiler'
import { useAssets } from './hooks/useAssets'
import type { editor as MonacoEditor } from 'monaco-editor'

const COLORS = ['#0066CC','#2E7D32','#C62828','#E65100','#6A1B9A','#00838F','#AD1457','#558B2F']

function randomColor() { return COLORS[Math.floor(Math.random() * COLORS.length)] }

// ── Join Screen ──────────────────────────────────────────────────────────────

export function AccountSettings({ token, username, color, onUpdate, onCancel }: { token: string, username: string, color: string, onUpdate: (newUsername: string, newColor: string, newToken?: string) => void, onCancel: () => void }) {
  const [newUsername, setNewUsername] = useState(username)
  const [newPassword, setNewPassword] = useState('')
  const [newColor, setNewColor] = useState(color)
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setErrorMsg('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ newUsername, newPassword, newColor })
      })
      const data = await res.json()
      if (data.ok) {
        onUpdate(data.username, data.color, data.token)
      } else {
        setErrorMsg(data.error || 'Failed to update')
      }
    } catch {
      setErrorMsg('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 380, padding: 30, background: 'rgba(255,255,255,0.80)', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.85)', boxShadow: '0 8px 32px rgba(0,40,120,0.12)' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Account Settings</h1>

        <label style={labelStyle}>Username</label>
        <input value={newUsername} onChange={e => setNewUsername(e.target.value)} style={inputStyle} />

        <label style={labelStyle}>New Password (optional)</label>
        <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Leave blank to keep same" style={inputStyle} />

        <label style={labelStyle}>Your colour</label>
        <div style={{ display: 'flex', gap: 7, marginBottom: 16 }}>
          {COLORS.map(c => (
            <div key={c} onClick={() => setNewColor(c)} style={{
              width: 22, height: 22, borderRadius: '50%', background: c,
              cursor: 'pointer',
              outline: newColor === c ? `3px solid ${c}` : 'none',
              outlineOffset: 2,
              transition: 'outline .1s',
            }} />
          ))}
        </div>

        {errorMsg && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 14 }}>{errorMsg}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={submit} disabled={loading} style={{ flex: 1, padding: 10, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600 }}>Save Changes</button>
          <button onClick={onCancel} disabled={loading} style={{ flex: 1, padding: 10, background: 'rgba(0,0,0,0.05)', color: 'var(--text)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

interface RoomInfo { name: string; protected: boolean; preview?: string }

function LoginScreen({ onLogin }: { onLogin: (token: string, username: string, color?: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading]   = useState(false)

  // Note: we removed color picker from here

  const submit = async (action: 'login' | 'register') => {
    if (!username || !password) return setErrorMsg('Username and password required')
    setErrorMsg('')
    setLoading(true)
    try {
      const res = await fetch(`/api/auth/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })
      const data = await res.json()
      if (data.ok) {
        onLogin(data.token, data.username, data.color)
      } else {
        setErrorMsg(data.error || 'Authentication failed')
      }
    } catch {
      setErrorMsg('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 320, padding: 30, background: 'rgba(255,255,255,0.80)', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.85)', boxShadow: '0 8px 32px rgba(0,40,120,0.12)' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20 }}>Welcome to Glyph Quorum</h1>

        <label style={labelStyle}>Username</label>
        <input value={username} onChange={e => setUsername(e.target.value)} autoFocus style={inputStyle} />

        <label style={labelStyle}>Password</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />

        {errorMsg && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 14 }}>{errorMsg}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => submit('login')} disabled={loading} style={{ flex: 1, padding: 10, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600 }}>Log In</button>
          <button onClick={() => submit('register')} disabled={loading} style={{ flex: 1, padding: 10, background: 'rgba(0,0,0,0.05)', color: 'var(--text)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 600 }}>Register</button>
        </div>
      </div>
    </div>
  )
}

function JoinScreen({ onJoin, token, username, onSettings }: { onJoin: (room: string, name: string, color: string) => void, token: string, username: string, onSettings: () => void }) {
  const color = localStorage.getItem('quorum-color') || COLORS[0]
  const [creating,  setCreating]  = useState(false)
  const [errorMsg,  setErrorMsg]  = useState('')
  const [rooms,     setRooms]     = useState<RoomInfo[]>([])

  React.useEffect(() => {
    fetch('/api/docs', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setRooms(d.docs ?? []))
      .catch(() => {})
  }, [token])

  const createDocument = async () => {
    setErrorMsg('')
    setCreating(true)

    try {
      const r = Math.random().toString(36).slice(2, 10) + '-' + Math.random().toString(36).slice(2, 10)
      localStorage.setItem('quorum-color', color)
      onJoin(r, username, color)
      window.history.pushState({}, '', `/${r}`)
    } catch {
      setErrorMsg('Could not reach server — is it running?')
    } finally {
      setCreating(false)
    }
  }

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter') createDocument() }

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 20px', overflowY: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 1000, display: 'flex', gap: 40, alignItems: 'flex-start' }}>
        <div style={{
          flexShrink: 0,
          width: 380,
          background: 'rgba(255,255,255,0.80)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.85)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 8px 32px rgba(0,40,120,0.12), inset 0 1px 0 rgba(255,255,255,0.95)',
          overflow: 'hidden',
          position: 'sticky',
          top: 40,
        }}>
          {/* Header */}
          <div style={{ padding: '24px 28px 20px', borderBottom: '1px solid rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src="/favicon.png" alt="" style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0 }} />
            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--text)' }}>
                Glyph <span style={{ color: 'var(--accent)' }}>Quorum</span>
              </h1>
              <p style={{ fontSize: 12, color: 'var(--overlay)', marginTop: 2 }}>
                Collaborative live Typst editing
              </p>
            </div>
          </div>

          <div style={{ padding: '20px 28px 24px' }}>






            {errorMsg && (
              <div style={{
                marginBottom: 14, padding: '8px 10px', borderRadius: 'var(--radius-sm)',
                background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)',
                fontSize: 12, color: 'var(--red)',
              }}>
                {errorMsg}
              </div>
            )}

            <button
              onClick={createDocument}
              disabled={creating}
              style={{
                width: '100%',
                padding: '10px 0',
                fontSize: 13,
                fontWeight: 600,
                borderRadius: 'var(--radius-sm)',
                background: creating ? 'rgba(37,99,235,0.5)' : 'var(--accent)',
                color: '#fff',
                border: 'none',
                cursor: creating ? 'default' : 'pointer',
                letterSpacing: '-0.01em',
              }}
            >
              {creating ? 'Creating…' : '+ New Document'}
            </button>
            <div style={{ marginTop: 20 }}>
               <button onClick={onSettings} style={{ width: '100%', padding: '8px 0', fontSize: 12, background: 'transparent', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--subtext)' }}>Account Settings</button>
            </div>
          </div>
        </div>

        {rooms.length > 0 && (
          <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: 'var(--text)' }}>Recent Documents</h2>
          {rooms.length > 0 ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 16,
            }}>
              {rooms.map(r => (
                <div
                  key={r.name}
                  onClick={() => {
                    localStorage.setItem('quorum-color', color)
                    onJoin(r.name, username, color)
                    window.history.pushState({}, '', `/${r.name}`)
                  }}
                  style={{
                    display: 'flex', flexDirection: 'column',
                    padding: 16, borderRadius: 'var(--radius)',
                    background: 'rgba(255,255,255,0.65)',
                    border: '1px solid rgba(0,0,0,0.08)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
                    cursor: 'pointer', transition: 'all .15s',
                    minHeight: 120,
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.9)'
                    e.currentTarget.style.border = '1px solid rgba(37,99,235,0.4)'
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(37,99,235,0.1)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.65)'
                    e.currentTarget.style.border = '1px solid rgba(0,0,0,0.08)'
                    e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                    {r.protected && (
                      <span style={{ fontSize: 10, color: 'var(--overlay)', background: 'rgba(0,0,0,0.06)', padding: '2px 6px', borderRadius: 10, flexShrink: 0 }}>locked</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 12, color: 'var(--subtext)', lineHeight: 1.5,
                    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                    fontFamily: 'var(--font-mono)',
                    flex: 1,
                  }}>
                    {r.preview || <span style={{ fontStyle: 'italic', color: 'rgba(0,0,0,0.3)' }}>Empty document</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--subtext)', fontSize: 14 }}>No documents found.</p>
          )}
        </div>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--overlay)',
  marginBottom: 5,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}
const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  marginBottom: 14,
  padding: '8px 10px',
  fontSize: 13,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(0,0,0,0.10)',
  background: 'rgba(255,255,255,0.65)',
  color: 'var(--text)',
  fontFamily: 'inherit',
  outline: 'none',
}

// ── Editor View ──────────────────────────────────────────────────────────────

function FontSizeBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.8)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--subtext)', fontFamily: 'sans-serif', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      {children}
    </button>
  )
}

const panelStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
  borderRadius: 'var(--radius)',
  // isolation: isolate forces a new stacking context, ensuring overflow:hidden
  // properly clips Monaco's composited rendering layers at the rounded corners
  isolation: 'isolate',
  background: 'rgba(255,255,255,0.72)',
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid rgba(255,255,255,0.85)',
  boxShadow: '0 8px 32px rgba(0,40,120,0.08), 0 1px 4px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.95)',
}

function EditorView({ roomId, userName, userColor, onLeave }: {
  roomId: string; userName: string; userColor: string; onLeave: () => void
}) {
  const { connected, users, comments, changes, bindEditor, addComment, resolveComment } = useCollab(roomId, userName, userColor, '', localStorage.getItem('quorum-token') || '')
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const [content, setContent] = useState('')
  const [viewMode, setViewMode] = useState<'split' | 'editor' | 'preview'>('split')
  const [fontSize, setFontSize] = useState(14)
  const { pdfBytes, error, isCompiling, recompile } = useCompiler(content, roomId)

  const handleMount = useCallback((ed: MonacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = ed
    bindEditor(ed)
  }, [bindEditor])

  const getSource = useCallback(() => editorRef.current?.getValue() ?? '', [])
  const loadContent = useCallback((text: string) => { editorRef.current?.setValue(text) }, [])
  const { upload: _upload } = useAssets(roomId)

  // Trigger immediate recompile after assets are uploaded so images appear
  const uploadAssets = useCallback(async (files: FileList) => {
    await _upload(files)
    recompile()
  }, [_upload, recompile])

  const handleDelete = useCallback(async () => {
    if (!window.confirm(`Permanently delete room "${roomId}" and all its content? This cannot be undone.`)) return
    await fetch(`/api/rooms/${roomId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('quorum-token')}` },
      body: JSON.stringify({ password: '' }),
    })
    onLeave()
  }, [roomId, onLeave])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar
        roomId={roomId}
        roomPassword={''}
        connected={connected}
        isCompiling={isCompiling}
        hasError={!!error}
        users={users}
        ownName={userName}
        ownColor={userColor}
        pdfBytes={pdfBytes}
        getSource={getSource}
        onLoadContent={loadContent}
        onUploadAssets={uploadAssets}
        onLeave={onLeave}
        onDelete={handleDelete}
        viewMode={viewMode}
        onViewMode={setViewMode}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', padding: 10, gap: 10 }}>
        {viewMode !== 'preview' && (
          <div className="editor-panel" style={{ ...panelStyle, flexDirection: 'column' }}>
            <Editor onMount={handleMount} onContentChange={setContent} fontSize={fontSize} comments={comments} />
            {/* Font size controls */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '6px 12px', borderTop: '1px solid rgba(0,0,0,0.06)', background: 'rgba(255,255,255,0.5)', flexShrink: 0 }}>
              <FontSizeBtn onClick={() => setFontSize(s => Math.max(10, s - 1))}>−</FontSizeBtn>
              <span
                onClick={() => setFontSize(14)}
                title="Reset font size"
                style={{ fontSize: 11, fontFamily: 'inherit', color: 'var(--subtext)', cursor: 'pointer', minWidth: 40, textAlign: 'center' }}
              >
                {fontSize}px
              </span>
              <FontSizeBtn onClick={() => setFontSize(s => Math.min(28, s + 1))}>+</FontSizeBtn>
            </div>
          </div>
        )}

        {viewMode !== 'editor' && (
          <div style={panelStyle}>
            <Preview pdfBytes={pdfBytes} error={error} isCompiling={isCompiling} />
          </div>
        )}

        <Sidebar
          comments={comments}
          changes={changes}
          users={users}
          ownName={userName}
          ownColor={userColor}
          docId={roomId}
          editorRef={editorRef}
          onAddComment={addComment}
          onResolveComment={resolveComment}
        />
      </div>
    </div>
  )
}

// ── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const initialRoom = window.location.pathname.slice(1) || null
  const savedName   = localStorage.getItem('quorum-username') ?? ''
  const savedColor  = localStorage.getItem('quorum-color') ?? randomColor()

  const [session, setSession] = useState<{ room: string; name: string; color: string } | null>(
    initialRoom && savedName ? { room: initialRoom, name: savedName, color: savedColor } : null
  )
  const [token, setToken] = useState(() => localStorage.getItem('quorum-token') || '')
  const [username, setUsername] = useState(() => localStorage.getItem('quorum-username') || '')
  const [color, setColor] = useState(() => localStorage.getItem('quorum-color') || randomColor())
  const [showSettings, setShowSettings] = useState(false)

  const handleJoin = useCallback((room: string, name: string, color: string) => {
    setSession({ room, name, color })
  }, [])

  const handleLogin = useCallback((newToken: string, newUsername: string, newColor?: string) => {
    setToken(newToken)
    setUsername(newUsername)
    if (newColor) {
      setColor(newColor)
      localStorage.setItem('quorum-color', newColor)
    }
    localStorage.setItem('quorum-token', newToken)
    localStorage.setItem('quorum-username', newUsername)

    // Auto-join room if in URL after login
    const currentRoom = window.location.pathname.slice(1)
    if (currentRoom) {
      setSession({ room: currentRoom, name: newUsername, color: newColor || savedColor })
    }
  }, [savedColor])

  const handleLogout = useCallback(() => {
    setToken('')
    setUsername('')
    setSession(null)
    localStorage.removeItem('quorum-token')
    localStorage.removeItem('quorum-username')
    window.history.pushState({}, '', '/')
  }, [])

  const handleLeave = useCallback(() => {
    setSession(null)
    window.history.pushState({}, '', '/')
  }, [])

  if (!token) return <LoginScreen onLogin={handleLogin} />
  if (!session) {
    if (showSettings) {
      return <AccountSettings token={token} username={username} color={color}
        onCancel={() => setShowSettings(false)}
        onUpdate={(newUsername: string, newColor: string, newToken?: string) => {
          setUsername(newUsername)
          setColor(newColor)
          localStorage.setItem('quorum-username', newUsername)
          localStorage.setItem('quorum-color', newColor)
          if (newToken) {
            setToken(newToken)
            localStorage.setItem('quorum-token', newToken)
          }
          setShowSettings(false)
        }}
      />
    }
    return (
      <div>
        <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 100 }}>
          <button onClick={handleLogout} style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 'var(--radius-sm)' }}>
            Log Out ({username})
          </button>
        </div>
        <JoinScreen onJoin={handleJoin} token={token} username={username} onSettings={() => setShowSettings(true)} />
      </div>
    )
  }

  return <EditorView roomId={session.room} userName={session.name} userColor={session.color} onLeave={handleLeave} />
}
