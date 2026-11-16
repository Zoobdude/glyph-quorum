import React, { useEffect, useState } from 'react'
import { api, formatSize, type VersionInfo } from '../lib/api'
import { Modal, toast, toastError } from './ui'

interface Props {
  docId: string
  canRestore: boolean
  onClose: () => void
}

export function VersionHistory({ docId, canRestore, onClose }: Props) {
  const [versions, setVersions] = useState<VersionInfo[] | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ versions: VersionInfo[] }>(`/docs/${docId}/versions`)
      .then(({ versions }) => { setVersions(versions); setSelected(versions[0]?.id ?? null) })
      .catch(e => { toastError(e); setVersions([]) })
  }, [docId])

  useEffect(() => {
    if (selected === null) return
    setContent(null)
    const ctrl = new AbortController()
    api<{ version: { content: string } }>(`/docs/${docId}/versions/${selected}`, { signal: ctrl.signal })
      .then(({ version }) => setContent(version.content))
      .catch(e => { if (e.name !== 'AbortError') toastError(e) })
    return () => ctrl.abort()
  }, [docId, selected])

  const restore = async () => {
    if (selected === null) return
    setBusy(true)
    try {
      await api(`/docs/${docId}/versions/${selected}/restore`, { method: 'POST' })
      toast('Version restored')
      onClose()
    } catch (e) { toastError(e); setBusy(false) }
  }

  return (
    <Modal title="Version history" onClose={onClose} width={860} footer={canRestore && versions && versions.length > 0 ? <>
      <span style={{ flex: 1, alignSelf: 'center', fontSize: 12, color: 'var(--subtext)' }}>Restoring replaces the text for everyone. The current text is saved as a version first.</span>
      <button className="btn" onClick={onClose}>Close</button>
      <button className="btn btn-primary" disabled={busy || selected === null} onClick={restore}>Restore this version</button>
    </> : undefined}>
      {!versions ? <div className="spinner" /> : versions.length === 0 ? (
        <p style={{ color: 'var(--subtext)', padding: '12px 0' }}>No versions yet. Snapshots are saved automatically about every ten minutes while a document is being edited.</p>
      ) : (
        <div style={{ display: 'flex', gap: 14, height: 'min(56vh, 520px)' }}>
          <div style={{ width: 220, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }} role="listbox" aria-label="Versions">
            {versions.map(v => (
              <button key={v.id} role="option" aria-selected={selected === v.id} className="menu-item" onClick={() => setSelected(v.id)}
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1, background: selected === v.id ? 'var(--accent-soft)' : undefined }}>
                <span style={{ fontWeight: 550 }}>{new Date(v.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <span style={{ fontSize: 12, color: 'var(--subtext)' }}>{v.author} · {formatSize(v.size)}</span>
              </button>
            ))}
          </div>
          <pre style={{ flex: 1, minWidth: 0, margin: 0, padding: 14, overflow: 'auto', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {content ?? 'Loading…'}
          </pre>
        </div>
      )}
    </Modal>
  )
}
