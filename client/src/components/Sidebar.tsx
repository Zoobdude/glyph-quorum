import React, { useState, useRef, useEffect } from 'react'
import * as monaco from 'monaco-editor'
import type { Comment, UserPresence, Change, CitationStyle } from '../hooks/useCollab'
import { CommentThread } from './CommentThread'
import { ChangesList } from './ChangesList'
import type { useAssets } from '../hooks/useAssets'
import { assetUrl, formatSize } from '../lib/api'
import { Icon } from './ui'
import type { editor as MonacoEditor } from 'monaco-editor'

type Tab = 'comments' | 'changes' | 'assets' | 'users'

interface Props {
  comments: Comment[]
  changes: Change[]
  trackChanges: boolean
  users: UserPresence[]
  ownName: string
  ownColor: string
  docId: string
  editorRef: React.RefObject<MonacoEditor.IStandaloneCodeEditor | null>
  onAddComment: (c: Omit<Comment, 'id' | 'createdAt' | 'author' | 'authorColor'> & { text: string }) => void
  onResolveComment: (id: string) => void
  onAcceptChange: (id: string) => void
  onRejectChange: (id: string) => void
  citationStyle: CitationStyle
  onCitationStyleChange: (style: CitationStyle) => void
  canEdit: boolean
  assetStore: ReturnType<typeof useAssets>
  onAssetsChanged: () => void
  useLibrary: boolean
  onUseLibraryChange: (on: boolean) => void
  onCite: () => void
}

export function Sidebar({ comments, changes, trackChanges, users, ownName, ownColor, docId, editorRef, onAddComment, onResolveComment, onAcceptChange, onRejectChange, citationStyle, onCitationStyleChange, canEdit, assetStore, onAssetsChanged, useLibrary, onUseLibraryChange, onCite }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [tab, setTab] = useState<Tab>('comments')
  const [draft, setDraft] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const { assets, uploading, error: assetError, refresh } = assetStore
  const upload = async (files: FileList) => { await assetStore.upload(files); onAssetsChanged() }
  const remove = async (name: string) => { await assetStore.remove(name); onAssetsChanged() }

  /** Insert a reference to an uploaded file at the cursor. */
  const insertAsset = (name: string) => {
    const ed = editorRef.current
    const sel = ed?.getSelection()
    if (!ed || !sel || !canEdit) return
    const text = /\.bib$/i.test(name) ? '' : `#image("${name}", width: 80%)`
    if (!text) return
    ed.executeEdits('insert-asset', [{ range: sel, text, forceMoveMarkers: true }])
    ed.focus()
  }

  useEffect(() => { if (tab === 'assets') refresh() }, [tab, refresh])

  const addComment = () => {
    const ed = editorRef.current
    const text = draft.trim()
    if (!text || !ed) return
    const sel = ed.getSelection()
    const pos = ed.getPosition()
    const range = sel
      ? { startLineNumber: sel.startLineNumber, startColumn: sel.startColumn, endLineNumber: sel.endLineNumber, endColumn: sel.endColumn }
      : { startLineNumber: pos?.lineNumber ?? 1, startColumn: pos?.column ?? 1, endLineNumber: pos?.lineNumber ?? 1, endColumn: pos?.column ?? 1 }
    onAddComment({ text, range, resolved: false })
    setDraft('')
  }

  const activeComments = comments.filter(c => !c.resolved)
  const resolvedComments = comments.filter(c => c.resolved)
  const pendingChanges = changes.filter(c => c.status === 'pending')

  const navigateToChange = (change: Change) => {
    const ed = editorRef.current
    const model = ed?.getModel()
    if (!ed || !model || change.startOffset === undefined) return
    const pos = model.getPositionAt(change.startOffset)
    ed.revealLineInCenter(pos.lineNumber)
    ed.setPosition(pos)
    ed.focus()
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'comments', label: activeComments.length ? `Comments (${activeComments.length})` : 'Comments' },
    { id: 'changes',  label: pendingChanges.length ? `Changes (${pendingChanges.length})` : 'Changes' },
    { id: 'assets',   label: 'Files' },
    { id: 'users',    label: `People (${users.length + 1})` },
  ]

  if (collapsed) {
    return (
      <div className="panel" style={{ flex: 'none', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '8px 4px' }}>
        <button onClick={() => setCollapsed(false)} title="Expand sidebar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--subtext)', fontSize: 18, lineHeight: 1, padding: 4 }}>‹</button>
        {activeComments.length > 0 && (
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-soft)', borderRadius: 10, padding: '1px 5px' }}>{activeComments.length}</span>
        )}
        {pendingChanges.length > 0 && (
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--green)', background: 'var(--green-soft)', borderRadius: 10, padding: '1px 5px' }}>{pendingChanges.length}</span>
        )}
      </div>
    )
  }

  return (
    <div className="panel hide-narrow" style={{ flex: 'none', width: 'var(--sidebar-w)', flexDirection: 'column' }}>
      {/* Tab bar with collapse button */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '11px 9px',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              background: 'none',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              cursor: 'pointer',
              color: tab === t.id ? 'var(--accent)' : 'var(--overlay)',
              transition: 'color .1s',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setCollapsed(true)}
          title="Collapse sidebar"
          style={{ background: 'none', border: 'none', borderBottom: '2px solid transparent', cursor: 'pointer', color: 'var(--overlay)', fontSize: 13, padding: '10px 8px', flexShrink: 0, marginBottom: -1 }}
        >
          ›
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tab === 'comments' && (
          <>
            {canEdit && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addComment() } }}
                placeholder="Add a comment at cursor…"
                rows={2}
                style={{
                  resize: 'none',
                  fontSize: 12,
                  padding: '7px 9px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--line)',
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
              <button
                onClick={addComment}
                disabled={!draft.trim()}
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-sm)',
                  cursor: draft.trim() ? 'pointer' : 'default',
                  background: draft.trim() ? 'var(--accent)' : 'var(--track)',
                  color: draft.trim() ? '#fff' : 'var(--overlay)',
                  border: 'none',
                  alignSelf: 'flex-end',
                  transition: 'background .1s',
                }}
              >
                Comment <kbd style={{ fontSize: 9, opacity: 0.7, fontFamily: 'inherit' }}>⌘↵</kbd>
              </button>
            </div>}

            {activeComments.map(c => (
              <CommentThread
                key={c.id}
                comment={c}
                onResolve={canEdit ? onResolveComment : () => {}}
                onNavigate={() => {
                  const ed = editorRef.current
                  if (!ed) return
                  ed.revealLineInCenter(c.range.startLineNumber)
                  // Select the highlighted range, or just place cursor if zero-width
                  const { startLineNumber: sl, startColumn: sc, endLineNumber: el, endColumn: ec } = c.range
                  if (sl === el && sc === ec) {
                    ed.setPosition({ lineNumber: sl, column: sc })
                  } else {
                    ed.setSelection(new monaco.Range(sl, sc, el, ec))
                  }
                  ed.focus()
                }}
              />
            ))}

            {resolvedComments.length > 0 && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: 11, color: 'var(--overlay)', cursor: 'pointer', userSelect: 'none' }}>
                  {resolvedComments.length} resolved
                </summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  {resolvedComments.map(c => (
                    <CommentThread key={c.id} comment={c} onResolve={onResolveComment} />
                  ))}
                </div>
              </details>
            )}

            {activeComments.length === 0 && !draft && (
              <p style={{ textAlign: 'center', color: 'var(--overlay)', fontSize: 12, paddingTop: 8 }}>
                No open comments
              </p>
            )}
          </>
        )}

        {tab === 'changes' && (
          <ChangesList
            changes={changes}
            trackChanges={trackChanges}
            onAccept={onAcceptChange}
            onReject={onRejectChange}
            onNavigate={navigateToChange}
          />
        )}

        {tab === 'assets' && (
          <>
            {/* Citation style */}
            <div style={{
              padding: '10px 10px 9px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--line)',
              background: 'var(--surface)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--overlay)', marginBottom: 7 }}>
                Citation style
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {([
                  ['author-date', 'Author-Date'],
                  ['numbered', 'Numbered'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => onCitationStyleChange(mode)}
                    style={{
                      flex: 1,
                      background: citationStyle === mode ? 'var(--accent-soft)' : 'var(--surface)',
                      border: `1px solid ${citationStyle === mode ? 'var(--accent)' : 'var(--line)'}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: '5px 0',
                      fontSize: 11,
                      fontWeight: citationStyle === mode ? 600 : 400,
                      color: citationStyle === mode ? 'var(--accent)' : 'var(--subtext)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      transition: 'all .1s',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'var(--overlay)', lineHeight: 1.5, marginTop: 8, marginBottom: 0 }}>
                <code>@key</code> gives “Masson et al. (2021)”, <code>[@key]</code> gives “(Masson et al., 2021)”.
              </p>

              {/* Reference library: resolves keys without uploading a .bib file */}
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)', fontSize: 12, cursor: canEdit ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={useLibrary} disabled={!canEdit} onChange={e => onUseLibraryChange(e.target.checked)} style={{ marginTop: 2, accentColor: 'var(--accent)' }} />
                <span>
                  <b style={{ fontWeight: 600 }}>Use reference library</b>
                  <span style={{ display: 'block', color: 'var(--overlay)', fontSize: 11, lineHeight: 1.45 }}>
                    Citations are looked up in the libraries of this document’s owner and editors. A .bib file uploaded here takes priority.
                  </span>
                </span>
              </label>
              {canEdit && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button className="btn" style={{ flex: 1, height: 28, fontSize: 12 }} onClick={onCite}><Icon name="quote" size={14} />Insert citation</button>
                  <a className="btn" style={{ height: 28, fontSize: 12 }} href="/references" target="_blank" rel="noopener">Library</a>
                </div>
              )}
            </div>

            {/* Drop zone / upload button */}
            {canEdit && <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault()
                setDragOver(false)
                if (e.dataTransfer.files.length) upload(e.dataTransfer.files)
              }}
              style={{
                width: '100%',
                padding: '16px 0',
                textAlign: 'center',
                fontSize: 12,
                borderRadius: 'var(--radius-sm)',
                border: `1px dashed ${dragOver ? 'var(--accent)' : 'var(--line-strong)'}`,
                background: dragOver ? 'var(--accent-soft)' : 'var(--surface)',
                color: uploading ? 'var(--overlay)' : dragOver ? 'var(--accent)' : 'var(--subtext)',
                cursor: uploading ? 'default' : 'pointer',
                transition: 'border-color .1s, background .1s',
              }}
            >
              {uploading ? 'Uploading…' : 'Click or drop images or a .bib file here'}
            </div>}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.svg,.pdf,.bib"
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files) upload(e.target.files); e.target.value = '' }}
            />

            {/* Error */}
            {assetError && (
              <p style={{ fontSize: 11, color: 'var(--red)', lineHeight: 1.4 }}>{assetError}</p>
            )}

            {/* Usage hint */}
            <p style={{ fontSize: 11, color: 'var(--overlay)', lineHeight: 1.5 }}>
              Reference an image in Typst:{' '}
              <code style={{ fontFamily: 'monospace', fontSize: 10 }}>image("filename.png")</code>
            </p>

            {/* Asset list */}
            {assets.length === 0 && !uploading && (
              <p style={{ textAlign: 'center', color: 'var(--overlay)', fontSize: 12, paddingTop: 4 }}>
                No files yet
              </p>
            )}
            <div className="asset-grid">
              {assets.map(a => {
                const isImage = /\.(png|jpe?g|gif|webp|svg)$/i.test(a.name)
                return (
                  <div key={a.name} className="asset">
                    <button className="pic" disabled={!canEdit || !isImage} title={isImage && canEdit ? 'Insert into document at cursor' : a.name} onClick={() => insertAsset(a.name)}>
                      {isImage
                        ? <img src={assetUrl(docId, a.name, a.modified)} alt="" loading="lazy" decoding="async" />
                        : <Icon name={/\.bib$/i.test(a.name) ? 'book' : 'file'} size={28} />}
                    </button>
                    <div className="meta">
                      <div className="n truncate" title={a.name}>{a.name}</div>
                      <div className="z">
                        {formatSize(a.size)} · <a href={`${assetUrl(docId, a.name)}?download`} download={a.name}>Download</a>
                      </div>
                    </div>
                    {canEdit && <button className="icon-btn x" onClick={() => remove(a.name)} aria-label={`Delete ${a.name}`} title="Delete file"><Icon name="x" size={14} /></button>}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {tab === 'users' && (
          <>
            <UserRow name={ownName} color={ownColor} label="You" />
            {users.map(u => <UserRow key={u.clientId} name={u.name} color={u.color} />)}
          </>
        )}
      </div>
    </div>
  )
}

function UserRow({ name, color, label }: { name: string; color: string; label?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{name}</span>
      {label && <span style={{ fontSize: 11, color: 'var(--overlay)', marginLeft: 2 }}>{label}</span>}
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', marginLeft: 'auto' }} />
    </div>
  )
}
