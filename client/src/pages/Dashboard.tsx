import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, thumbUrl, timeAgo, type DocMeta, type DocView } from '../lib/api'
import { Link, useNavigate } from 'react-router-dom'
import { TEMPLATES } from '../lib/templates'
import { APP_NAME, LOGO_URL } from '../lib/brand'
import { AccountMenu, useUser } from '../auth'
import { Confirm, Icon, Menu, MenuItem, Prompt, toast, toastError, type IconName } from '../components/ui'
import { ShareDialog } from '../components/ShareDialog'

const VIEWS: { id: DocView; label: string; icon: IconName; empty: [string, string] }[] = [
  { id: 'mine',    label: 'My documents',   icon: 'file',  empty: ['No documents yet', 'Create a document or drop a .typ file here to get started.'] },
  { id: 'shared',  label: 'Shared with me', icon: 'users', empty: ['Nothing shared with you yet', 'Documents other people share with you will appear here.'] },
  { id: 'recent',  label: 'Recent',         icon: 'clock', empty: ['No recent documents', 'Documents you open will appear here.'] },
  { id: 'starred', label: 'Starred',        icon: 'star',  empty: ['No starred documents', 'Star the documents you want to find quickly.'] },
  { id: 'trash',   label: 'Trash',          icon: 'trash', empty: ['Trash is empty', 'Documents you move to the trash can be restored from here.'] },
]

type Sort = 'modified' | 'title'
type Layout = 'grid' | 'list'
type Dialog =
  | { kind: 'rename' | 'share' | 'delete'; doc: DocMeta }
  | null

const stored = <T extends string>(key: string, fallback: T): T => {
  try { return (localStorage.getItem(key) as T) || fallback } catch { return fallback }
}

export function Dashboard() {
  const user = useUser()
  const navigate = useNavigate()
  const [view, setView] = useState<DocView>('mine')
  const [docs, setDocs] = useState<DocMeta[] | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>(() => stored('gq-sort', 'modified'))
  const [layout, setLayout] = useState<Layout>(() => stored('gq-layout', 'grid'))
  const [menu, setMenu] = useState<{ doc: DocMeta; anchor: HTMLElement | { x: number; y: number } } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const requestId = useRef(0)

  useEffect(() => { document.title = APP_NAME }, [])
  useEffect(() => { try { localStorage.setItem('gq-sort', sort); localStorage.setItem('gq-layout', layout) } catch {} }, [sort, layout])

  const load = useCallback(async (v: DocView = view) => {
    const id = ++requestId.current
    try {
      const { docs } = await api<{ docs: DocMeta[] }>(`/docs?view=${v}`)
      if (id === requestId.current) setDocs(docs)
    } catch (e) {
      if (id === requestId.current) { setDocs([]); toastError(e) }
    }
  }, [view])

  useEffect(() => { setDocs(null); load(view) }, [view]) // eslint-disable-line react-hooks/exhaustive-deps
  // Pick up edits made in other tabs when the user comes back to this one.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [load])

  const visible = useMemo(() => {
    if (!docs) return null
    const q = query.trim().toLowerCase()
    const list = q ? docs.filter(d => d.title.toLowerCase().includes(q) || d.ownerName.toLowerCase().includes(q)) : docs.slice()
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }))
    else if (view !== 'recent' && view !== 'trash') list.sort((a, b) => b.updatedAt - a.updatedAt)
    return list
  }, [docs, query, sort, view])

  // ── Actions ────────────────────────────────────────────────────────────────

  const create = async (title?: string, content?: string) => {
    try {
      const { id } = await api<{ id: string }>('/docs', { body: { title, content } })
      navigate(`/d/${id}`)
    } catch (e) { toastError(e) }
  }

  const importFiles = async (files: File[]) => {
    const typ = files.filter(f => /\.(typ|txt)$/i.test(f.name) && f.size <= 2 * 1024 * 1024)
    if (typ.length === 0) { toast('Only .typ files up to 2 MB can be imported', true); return }
    try {
      const ids: string[] = []
      for (const f of typ.slice(0, 20)) {
        const { id } = await api<{ id: string }>('/docs', { body: { title: f.name.replace(/\.(typ|txt)$/i, ''), content: await f.text() } })
        ids.push(id)
      }
      if (ids.length === 1) navigate(`/d/${ids[0]}`)
      else { toast(`Imported ${ids.length} documents`); setView('mine'); load('mine') }
    } catch (e) { toastError(e) }
  }

  /** Apply a change optimistically, then confirm with the server (reloading on failure). */
  const mutate = async (update: (docs: DocMeta[]) => DocMeta[], call: () => Promise<unknown>, done?: string) => {
    setDocs(d => d && update(d))
    try { await call(); if (done) toast(done) }
    catch (e) { toastError(e); load() }
  }
  const patch = (doc: DocMeta, body: Partial<Pick<DocMeta, 'title' | 'starred'>> & { trashed?: boolean }, update: (docs: DocMeta[]) => DocMeta[], done?: string) =>
    mutate(update, () => api(`/docs/${doc.id}`, { method: 'PATCH', body }), done)
  const without = (doc: DocMeta) => (docs: DocMeta[]) => docs.filter(d => d.id !== doc.id)
  const replace = (doc: DocMeta, changes: Partial<DocMeta>) => (docs: DocMeta[]) => docs.map(d => (d.id === doc.id ? { ...d, ...changes } : d))

  const toggleStar = (doc: DocMeta) =>
    patch(doc, { starred: !doc.starred }, view === 'starred' && doc.starred ? without(doc) : replace(doc, { starred: !doc.starred }))
  const duplicate = async (doc: DocMeta) => {
    try {
      await api(`/docs/${doc.id}/copy`, { method: 'POST' })
      toast('Copy created in My documents')
      if (view === 'mine') load()
    } catch (e) { toastError(e) }
  }

  const open = (doc: DocMeta) => { if (!doc.trashedAt) navigate(`/d/${doc.id}`) }
  const openMenu = (doc: DocMeta, anchor: HTMLElement | { x: number; y: number }) => setMenu({ doc, anchor })

  const current = VIEWS.find(v => v.id === view)!
  const m = menu?.doc

  return (
    <div className="dash">
      <header className="dash-top">
        <Link to="/" className="brand"><img src={LOGO_URL} alt="" /><b>{APP_NAME}</b></Link>
        <div className="dash-search">
          <Icon name="search" />
          <input className="input" type="search" placeholder="Search documents" aria-label="Search documents" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
        <AccountMenu />
      </header>

      <nav className="dash-nav" aria-label="Document views">
        <button className="btn btn-primary btn-lg" onClick={() => create()}><Icon name="plus" />New document</button>
        {VIEWS.map(v => (
          <button key={v.id} className={`nav-item${view === v.id ? ' active' : ''}`} aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}>
            <Icon name={v.icon} />{v.label}
          </button>
        ))}
        <div className="menu-sep hide-narrow" style={{ margin: '10px 8px' }} />
        <button className="nav-item" onClick={() => fileInput.current?.click()}><Icon name="upload" />Import .typ</button>
        <input ref={fileInput} type="file" accept=".typ,.txt" multiple hidden
          onChange={e => { if (e.target.files?.length) importFiles(Array.from(e.target.files)); e.target.value = '' }} />
      </nav>

      <main className={`dash-main${dragging ? ' dragging' : ''}`}
        onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
        onDrop={e => { e.preventDefault(); setDragging(false); importFiles(Array.from(e.dataTransfer.files)) }}>

        {view === 'mine' && !query && (
          <section aria-label="Start a new document">
            <h2 className="section-title">Start a new document</h2>
            <div className="templates">
              <button className="template" onClick={() => create()}>
                <div className="sheet blank"><Icon name="plus" size={34} /></div>
                <div className="name">Blank</div>
              </button>
              {TEMPLATES.map(t => (
                <button key={t.id} className="template" onClick={() => create(t.title, t.content)}>
                  <div className="sheet" aria-hidden="true">
                    <i className="h" style={{ width: '62%' }} />
                    {[92, 100, 84, 96, 70, 100, 88, 94, 60].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}
                  </div>
                  <div className="name">{t.name}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="dash-head">
          <h1>{query ? `Results in ${current.label}` : current.label}</h1>
          <select className="select" aria-label="Sort by" value={sort} onChange={e => setSort(e.target.value as Sort)}>
            <option value="modified">Last modified</option>
            <option value="title">Title</option>
          </select>
          <button className="icon-btn" title={layout === 'grid' ? 'List view' : 'Grid view'} aria-label={layout === 'grid' ? 'Switch to list view' : 'Switch to grid view'}
            onClick={() => setLayout(l => (l === 'grid' ? 'list' : 'grid'))}>
            <Icon name={layout === 'grid' ? 'list' : 'grid'} />
          </button>
        </div>

        {!visible ? (
          <div className="doc-grid" aria-busy="true">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton" />)}</div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <Icon name={query ? 'search' : current.icon} size={44} />
            <h3>{query ? 'No matching documents' : current.empty[0]}</h3>
            <p>{query ? `Nothing in ${current.label} matches “${query}”.` : current.empty[1]}</p>
          </div>
        ) : layout === 'grid' ? (
          <div className="doc-grid">
            {visible.map(d => <DocCard key={d.id} doc={d} mine={d.ownerId === user.id} onOpen={open} onMenu={openMenu} onStar={toggleStar} />)}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="doc-list">
              <thead><tr><th>Name</th><th className="hide-narrow">Owner</th><th>{view === 'trash' ? 'Trashed' : 'Modified'}</th><th style={{ width: 80 }} /></tr></thead>
              <tbody>
                {visible.map(d => (
                  <tr key={d.id} onClick={() => open(d)} onContextMenu={e => { e.preventDefault(); openMenu(d, { x: e.clientX, y: e.clientY }) }}>
                    <td><div className="name"><Thumb doc={d} className="mini" /><span className="truncate">{d.title}</span></div></td>
                    <td className="hide-narrow">{d.ownerId === user.id ? 'me' : d.ownerName}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{timeAgo(d.trashedAt ?? d.updatedAt)}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {!d.trashedAt && <StarButton doc={d} onStar={toggleStar} />}
                      <button className="icon-btn" aria-label={`Actions for ${d.title}`} onClick={e => { e.stopPropagation(); openMenu(d, e.currentTarget) }}><Icon name="more" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {menu && m && (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)}>
          {m.trashedAt ? <>
            <MenuItem icon="restore" onClick={() => patch(m, { trashed: false }, without(m), 'Document restored')}>Restore</MenuItem>
            <MenuItem icon="trash" danger onClick={() => setDialog({ kind: 'delete', doc: m })}>Delete forever</MenuItem>
          </> : <>
            <MenuItem icon="file" onClick={() => open(m)}>Open</MenuItem>
            <MenuItem icon="external" onClick={() => window.open(`/d/${m.id}`, '_blank', 'noopener')}>Open in new tab</MenuItem>
            <div className="menu-sep" />
            {m.role !== 'viewer' && <MenuItem icon="edit" onClick={() => setDialog({ kind: 'rename', doc: m })}>Rename</MenuItem>}
            <MenuItem icon="copy" onClick={() => duplicate(m)}>Make a copy</MenuItem>
            <MenuItem icon="share" onClick={() => setDialog({ kind: 'share', doc: m })}>{m.role === 'owner' ? 'Share' : 'See who has access'}</MenuItem>
            <MenuItem icon="star" onClick={() => toggleStar(m)}>{m.starred ? 'Remove star' : 'Add star'}</MenuItem>
            {m.role === 'owner' && <>
              <div className="menu-sep" />
              <MenuItem icon="trash" danger onClick={() => patch(m, { trashed: true }, without(m), 'Moved to trash')}>Move to trash</MenuItem>
            </>}
          </>}
        </Menu>
      )}

      {dialog?.kind === 'rename' && (
        <Prompt title="Rename document" label="Title" initial={dialog.doc.title} action="Rename" onClose={() => setDialog(null)}
          onSubmit={title => patch(dialog.doc, { title }, replace(dialog.doc, { title }))} />
      )}
      {dialog?.kind === 'share' && <ShareDialog doc={dialog.doc} canManage={dialog.doc.role === 'owner'} onClose={() => { setDialog(null); load() }} />}
      {dialog?.kind === 'delete' && (
        <Confirm title="Delete forever?" action="Delete forever" danger onClose={() => setDialog(null)}
          message={<>“{dialog.doc.title}” and all of its files and version history will be permanently deleted. This cannot be undone.</>}
          onConfirm={() => mutate(without(dialog.doc), () => api(`/docs/${dialog.doc.id}`, { method: 'DELETE' }), 'Document deleted')} />
      )}
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** First-page preview rendered by the server; lazy-loaded and cached by document version. */
function Thumb({ doc, className }: { doc: DocMeta; className?: string }) {
  // Keyed by document version, so a cached image whose load event fires before effects run is never missed.
  const key = `${doc.id}:${doc.updatedAt}`
  const [result, setResult] = useState<{ key: string; state: 'loaded' | 'failed' } | null>(null)
  const state = result?.key === key ? result.state : 'loading'
  const setState = (next: 'loaded' | 'failed') => setResult({ key, state: next })
  if (state === 'failed') return className ? <span className={className} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-icon)' }}><Icon name="file" size={14} /></span> : <div className="ph"><Icon name="file" size={40} /></div>
  return <img className={`${className ?? ''}${state === 'loaded' ? ' loaded' : ''}`} src={thumbUrl(doc)} alt="" loading="lazy" decoding="async"
    onLoad={() => setState('loaded')} onError={() => setState('failed')} />
}

function StarButton({ doc, onStar, className = '' }: { doc: DocMeta; onStar: (d: DocMeta) => void; className?: string }) {
  return (
    <button className={`icon-btn ${className}${doc.starred ? ' on' : ''}`} aria-pressed={doc.starred} aria-label={doc.starred ? 'Remove star' : 'Add star'} title={doc.starred ? 'Remove star' : 'Add star'}
      onClick={e => { e.stopPropagation(); onStar(doc) }}>
      <Icon name="star" fill={doc.starred} />
    </button>
  )
}

const DocCard = React.memo(function DocCard({ doc, mine, onOpen, onMenu, onStar }: {
  doc: DocMeta; mine: boolean
  onOpen: (d: DocMeta) => void
  onMenu: (d: DocMeta, anchor: HTMLElement | { x: number; y: number }) => void
  onStar: (d: DocMeta) => void
}) {
  return (
    <div className="doc-card" role="link" tabIndex={0} aria-label={doc.title}
      onClick={() => onOpen(doc)}
      onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(doc) }}
      onContextMenu={e => { e.preventDefault(); onMenu(doc, { x: e.clientX, y: e.clientY }) }}>
      <div className="doc-thumb"><Thumb doc={doc} /></div>
      {!doc.trashedAt && <StarButton doc={doc} onStar={onStar} className="star" />}
      <div className="doc-info">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t truncate" title={doc.title}>{doc.title}</div>
          <div className="s truncate">
            {doc.trashedAt ? `Trashed ${timeAgo(doc.trashedAt)}` : `Edited ${timeAgo(doc.updatedAt)}`}
            {!mine && ` · ${doc.ownerName}`}
          </div>
        </div>
        <button className="icon-btn" aria-label={`Actions for ${doc.title}`} onClick={e => { e.stopPropagation(); onMenu(doc, e.currentTarget) }}><Icon name="more" /></button>
      </div>
    </div>
  )
})
