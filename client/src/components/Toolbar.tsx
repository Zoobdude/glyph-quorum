import React, { useEffect, useRef, useState } from 'react'
import type { UserPresence } from '../hooks/useCollab'
import type { DocMeta } from '../lib/api'
import { Link } from 'react-router-dom'
import { LOGO_URL } from '../lib/brand'
import { AccountMenu } from '../auth'
import { Avatar, Icon, MenuButton, MenuItem } from './ui'

export type ViewMode = 'split' | 'editor' | 'preview'

interface Props {
  doc: DocMeta
  title: string
  onRename: (title: string) => void
  onToggleStar: () => void
  connected: boolean
  synced: boolean
  unsaved: boolean
  isCompiling: boolean
  hasError: boolean
  users: UserPresence[]
  hasPdf: boolean
  onImport: (files: FileList) => void
  onDownloadTyp: () => void
  onDownloadPdf: () => void
  onShare: () => void
  onHistory: () => void
  onCopy: () => void
  onTrash: () => void
  onCite: () => void
  viewMode: ViewMode
  onViewMode: (m: ViewMode) => void
  trackChanges: boolean
  onToggleTrackChanges: (on: boolean) => void
  spellCheckEnabled: boolean
  onToggleSpellCheck: (on: boolean) => void
}

export function Toolbar(p: Props) {
  const { doc } = p
  const canEdit = doc.role !== 'viewer'
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(p.title)
  const editing = useRef(false)
  useEffect(() => { if (!editing.current) setDraft(p.title) }, [p.title])

  const commitTitle = () => {
    editing.current = false
    const next = draft.trim()
    if (next && next !== p.title) p.onRename(next)
    else setDraft(p.title)
  }

  return (
    <header className="ed-top">
      <Link to="/" className="brand" title="All documents" aria-label="Back to all documents"><img src={LOGO_URL} alt="" /></Link>

      <div className="ed-left">
        <input
          className="ed-title"
          aria-label="Document title"
          value={draft}
          readOnly={!canEdit}
          maxLength={120}
          size={Math.max(6, Math.min(36, Math.round(draft.length * 0.85)))}
          onFocus={() => { editing.current = true }}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') { setDraft(p.title); editing.current = false; requestAnimationFrame(() => (e.target as HTMLInputElement).blur()) }
          }}
        />
        <button className={`icon-btn${doc.starred ? ' on' : ''}`} onClick={p.onToggleStar} aria-pressed={doc.starred}
          title={doc.starred ? 'Remove star' : 'Add star'} aria-label={doc.starred ? 'Remove star' : 'Add star'}>
          <Icon name="star" fill={doc.starred} />
        </button>

        <MenuButton className="btn btn-ghost" title="File" menu={<>
          {canEdit && <MenuItem icon="upload" onClick={() => fileInputRef.current?.click()}>Import .typ or upload images…</MenuItem>}
          <MenuItem icon="download" onClick={p.onDownloadTyp}>Download source (.typ)</MenuItem>
          <MenuItem icon="download" onClick={p.onDownloadPdf} disabled={!p.hasPdf}>Download PDF</MenuItem>
          <div className="menu-sep" />
          <MenuItem icon="history" onClick={p.onHistory}>Version history</MenuItem>
          <MenuItem icon="copy" onClick={p.onCopy}>Make a copy</MenuItem>
          {doc.role === 'owner' && <>
            <div className="menu-sep" />
            <MenuItem icon="trash" danger onClick={p.onTrash}>Move to trash</MenuItem>
          </>}
        </>}>
          File<Icon name="chevron" size={14} />
        </MenuButton>

        {canEdit && (
          <MenuButton className="btn btn-ghost" title="Tools" menu={<>
            <MenuItem icon="quote" onClick={p.onCite}>Insert citation…</MenuItem>
            <div className="menu-sep" />
            <MenuItem icon="edit" checked={p.trackChanges} onClick={() => p.onToggleTrackChanges(!p.trackChanges)}>Track changes (suggest edits)</MenuItem>
            <MenuItem icon="book" checked={p.spellCheckEnabled} onClick={() => p.onToggleSpellCheck(!p.spellCheckEnabled)}>Spell check</MenuItem>
          </>}>
            Tools<Icon name="chevron" size={14} />
          </MenuButton>
        )}

        <SaveStatus canEdit={canEdit} connected={p.connected} synced={p.synced} unsaved={p.unsaved} />
      </div>

      <div className="seg" role="group" aria-label="Layout">
        {(['editor', 'split', 'preview'] as const).map(m => (
          <button key={m} className={p.viewMode === m ? 'active' : ''} aria-pressed={p.viewMode === m} onClick={() => p.onViewMode(m)}>
            {{ editor: 'Source', split: 'Split', preview: 'Preview' }[m]}
          </button>
        ))}
      </div>

      <div className="ed-right">
        {p.trackChanges && canEdit && (
          <button className="pill hide-medium" style={{ background: 'var(--green-soft)', color: 'var(--green)', border: 'none' }}
            title="Edits are recorded as suggestions. Click to turn off." onClick={() => p.onToggleTrackChanges(false)}>
            <span className="dot" />Suggesting
          </button>
        )}
        <CompileStatus isCompiling={p.isCompiling} hasError={p.hasError} />

        {p.users.length > 0 && (
          <div className="avatar-stack" aria-label={`${p.users.length} other ${p.users.length === 1 ? 'person' : 'people'} here`}>
            {p.users.slice(0, 4).map(u => <Avatar key={u.clientId} name={u.name} color={u.color} />)}
            {p.users.length > 4 && <span className="avatar" style={{ background: '#64748b' }}>+{p.users.length - 4}</span>}
          </div>
        )}

        <button className="btn btn-primary" onClick={p.onShare}>
          <Icon name={doc.linkAccess === 'none' ? 'lock' : 'globe'} size={15} /><span className="hide-narrow">Share</span>
        </button>
        <AccountMenu />
      </div>

      <input ref={fileInputRef} type="file" accept=".typ,.txt,image/*,.svg,.pdf,.bib" multiple hidden
        onChange={e => { if (e.target.files?.length) p.onImport(e.target.files); e.target.value = '' }} />
    </header>
  )
}

function SaveStatus({ canEdit, connected, synced, unsaved }: { canEdit: boolean; connected: boolean; synced: boolean; unsaved: boolean }) {
  let icon: 'cloud' | 'cloudOff' | 'eye' = 'cloud'
  let label = 'Saved'
  let title = 'Every change is saved automatically'
  if (!connected) {
    icon = 'cloudOff'
    label = synced ? 'Offline' : 'Connecting…'
    title = synced ? 'Connection lost — your edits are kept and will sync when you are back online' : 'Connecting to the server'
  } else if (!canEdit) { icon = 'eye'; label = 'View only'; title = 'You can read this document but not change it' }
  else if (unsaved) label = 'Saving…'
  return (
    <span className="ed-status hide-medium" title={title} style={!connected && synced ? { color: 'var(--yellow)' } : undefined} role="status">
      <Icon name={icon} size={16} />{label}
    </span>
  )
}

function CompileStatus({ isCompiling, hasError }: { isCompiling: boolean; hasError: boolean }) {
  if (hasError && !isCompiling) {
    return <span className="pill" style={{ background: 'var(--danger-bg)', color: 'var(--red)' }} title="The document has errors — see the preview panel"><span className="dot" />Error</span>
  }
  // Keep the slot occupied so the toolbar does not shift every time a compile starts.
  return (
    <span className="pill hide-medium" style={{ color: 'var(--overlay)', visibility: isCompiling ? 'visible' : 'hidden' }} aria-hidden={!isCompiling}>
      <span className="spinner" style={{ width: 12, height: 12 }} />Compiling
    </span>
  )
}
