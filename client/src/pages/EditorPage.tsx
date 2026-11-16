import React, { useState, useRef, useCallback, useEffect } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { Toolbar, type ViewMode } from '../components/Toolbar'
import { Editor } from '../components/Editor'
import { Preview } from '../components/Preview'
import { Sidebar } from '../components/Sidebar'
import { ShareDialog } from '../components/ShareDialog'
import { VersionHistory } from '../components/VersionHistory'
import { CitePicker } from '../components/CitePicker'
import { Confirm, toast, toastError } from '../components/ui'
import { useCollab } from '../hooks/useCollab'
import { useCompiler } from '../hooks/useCompiler'
import { useAssets } from '../hooks/useAssets'
import { api, ApiError, download, fileBase, type DocMeta } from '../lib/api'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useUser } from '../auth'
import { APP_NAME } from '../lib/brand'

/** Loads the document's metadata and permissions, then mounts the editor. */
export default function EditorPage() {
  const docId = useParams().docId!
  const [doc, setDoc] = useState<DocMeta | null>(null)
  const [failure, setFailure] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    try {
      setDoc((await api<{ doc: DocMeta }>(`/docs/${docId}`)).doc)
      setFailure(null)
    } catch (e) {
      // A dropped connection is not a reason to throw the user out of a document they have open.
      if ((e as ApiError).status !== 0) { setDoc(null); setFailure(e as ApiError) }
    }
  }, [docId])

  useEffect(() => { setDoc(null); setFailure(null); load() }, [load])

  // The server drops the live connection whenever sharing changes; re-check what we may do.
  const recheck = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onDisconnected = useCallback(() => {
    if (recheck.current) clearTimeout(recheck.current)
    recheck.current = setTimeout(load, 400)
  }, [load])
  useEffect(() => () => { if (recheck.current) clearTimeout(recheck.current) }, [])

  if (failure) {
    return (
      <div className="center-fill">
        <h1 style={{ fontSize: 20, color: 'var(--text)' }}>{failure.status === 404 ? 'Document not found' : 'Could not open this document'}</h1>
        <p style={{ maxWidth: 380 }}>
          {failure.status === 404 ? 'It may have been deleted, or you may not have access. Ask the owner to share it with your account.' : failure.message}
        </p>
        <Link to="/" className="btn btn-primary">Go to my documents</Link>
      </div>
    )
  }
  if (!doc) return <div className="center-fill"><div className="spinner" /></div>

  // Remount when the role changes so the editor and live connection pick up the new permissions.
  return <EditorView key={`${doc.id}:${doc.role}`} doc={doc} setDoc={setDoc} onDisconnected={onDisconnected} />
}

function EditorView({ doc, setDoc, onDisconnected }: { doc: DocMeta; setDoc: (d: DocMeta) => void; onDisconnected: () => void }) {
  const user = useUser()
  const navigate = useNavigate()
  const canEdit = doc.role !== 'viewer'
  const collab = useCollab(doc.id, user.name, user.color, { onDisconnected })
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const [content, setContent] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>(() => (window.innerWidth < 900 ? 'editor' : 'split'))
  const [fontSize, setFontSize] = useState(14)
  const [dialog, setDialog] = useState<'share' | 'history' | 'trash' | 'cite' | null>(null)
  // Wait for the first sync before compiling, so an empty placeholder is never rendered.
  const { pdfBytes, error, isCompiling, recompile } = useCompiler(content, doc.id, collab.citationStyle, collab.useLibrary, collab.synced)
  const assetStore = useAssets(doc.id)

  const title = collab.title ?? doc.title
  useEffect(() => { document.title = `${title} – ${APP_NAME}` }, [title])

  // Warn before closing the tab while edits have not reached the server yet.
  useEffect(() => {
    if (!collab.unsaved) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [collab.unsaved])

  const { bindEditor } = collab
  const handleMount = useCallback((ed: MonacoEditor.IStandaloneCodeEditor) => {
    editorRef.current = ed
    bindEditor(ed)
  }, [bindEditor])

  const patch = useCallback(async (body: Record<string, unknown>, optimistic: Partial<DocMeta>) => {
    setDoc({ ...doc, ...optimistic })
    try { await api(`/docs/${doc.id}`, { method: 'PATCH', body }) }
    catch (e) { setDoc(doc); toastError(e) }
  }, [doc, setDoc])

  /** File ▸ Import: a .typ file replaces the text (undoable); anything else is stored as a document file. */
  const importFiles = useCallback(async (files: FileList) => {
    const list = Array.from(files)
    const source = list.find(f => /\.(typ|txt)$/i.test(f.name))
    const others = list.filter(f => !/\.(typ|txt)$/i.test(f.name))
    const ed = editorRef.current
    const model = ed?.getModel()
    if (source && ed && model) {
      ed.pushUndoStop()
      ed.executeEdits('import', [{ range: model.getFullModelRange(), text: (await source.text()).replace(/\r\n/g, '\n') }])
      ed.pushUndoStop()
      toast(`Imported ${source.name} — undo to revert`)
    }
    if (others.length) {
      const stored = await assetStore.upload(others)
      if (stored.length) toast(`Uploaded ${stored.length} ${stored.length === 1 ? 'file' : 'files'}`)
      recompile()
    }
  }, [assetStore, recompile])

  /** Insert text at the cursor (replacing any selection), as a single undoable edit. */
  const insertText = useCallback((text: string) => {
    const ed = editorRef.current
    const sel = ed?.getSelection()
    if (!ed || !sel) return
    ed.executeEdits('insert', [{ range: sel, text, forceMoveMarkers: true }])
    // The dialog returns focus to whatever opened it; move it to the editor afterwards.
    setTimeout(() => ed.focus(), 0)
  }, [])

  const makeCopy = async () => {
    try {
      const { id } = await api<{ id: string }>(`/docs/${doc.id}/copy`, { method: 'POST' })
      window.open(`/d/${id}`, '_blank', 'noopener')
      toast('Copy created')
    } catch (e) { toastError(e) }
  }

  const moveToTrash = async () => {
    try {
      await api(`/docs/${doc.id}`, { method: 'PATCH', body: { trashed: true } })
      toast('Moved to trash')
      navigate('/')
    } catch (e) { toastError(e) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Toolbar
        doc={doc}
        title={title}
        onRename={t => patch({ title: t }, { title: t })}
        onToggleStar={() => patch({ starred: !doc.starred }, { starred: !doc.starred })}
        connected={collab.connected}
        synced={collab.synced}
        unsaved={collab.unsaved}
        isCompiling={isCompiling}
        hasError={!!error}
        users={collab.users}
        hasPdf={!!pdfBytes}
        onImport={importFiles}
        onDownloadTyp={() => download(editorRef.current?.getValue() ?? content, `${fileBase(title)}.typ`, 'text/plain')}
        onDownloadPdf={() => { if (pdfBytes) download(pdfBytes as BlobPart, `${fileBase(title)}.pdf`, 'application/pdf') }}
        onShare={() => setDialog('share')}
        onHistory={() => setDialog('history')}
        onCopy={makeCopy}
        onTrash={() => setDialog('trash')}
        onCite={() => setDialog('cite')}
        viewMode={viewMode}
        onViewMode={setViewMode}
        trackChanges={collab.trackChanges}
        onToggleTrackChanges={collab.setTrackChanges}
        spellCheckEnabled={collab.spellCheckEnabled}
        onToggleSpellCheck={collab.setSpellCheckEnabled}
      />

      {doc.trashedAt && (
        <div className="banner" role="status">
          This document is in the trash.
          <button className="btn" style={{ height: 26 }} onClick={() => patch({ trashed: false }, { trashedAt: null })}>Restore</button>
        </div>
      )}

      <div className="ed-body">
        {/* The editor stays mounted in preview mode so the live binding and undo history survive layout switches. */}
        <div className="panel editor-panel" style={{ flexDirection: 'column', display: viewMode === 'preview' ? 'none' : 'flex' }}>
          <Editor
            onMount={handleMount}
            onContentChange={setContent}
            fontSize={fontSize}
            comments={collab.comments}
            changes={collab.changes}
            spellCheckEnabled={collab.spellCheckEnabled && canEdit}
            dictionary={collab.dictionary}
            onAddToDictionary={collab.addToDictionary}
            readOnly={!canEdit}
          />
          <div className="panel-foot">
            <button className="icon-btn" onClick={() => setFontSize(s => Math.max(10, s - 1))} aria-label="Smaller text">−</button>
            <button onClick={() => setFontSize(14)} title="Reset font size" style={{ fontSize: 12, color: 'var(--subtext)', background: 'none', border: 'none', minWidth: 44 }}>{fontSize}px</button>
            <button className="icon-btn" onClick={() => setFontSize(s => Math.min(28, s + 1))} aria-label="Larger text">+</button>
          </div>
        </div>

        {viewMode !== 'editor' && (
          <div className="panel">
            <Preview pdfBytes={pdfBytes} error={error} isCompiling={isCompiling} />
          </div>
        )}

        <Sidebar
          comments={collab.comments}
          changes={collab.changes}
          trackChanges={collab.trackChanges}
          users={collab.users}
          ownName={user.name}
          ownColor={user.color}
          docId={doc.id}
          editorRef={editorRef}
          onAddComment={collab.addComment}
          onResolveComment={collab.resolveComment}
          onAcceptChange={collab.acceptChange}
          onRejectChange={collab.rejectChange}
          citationStyle={collab.citationStyle}
          onCitationStyleChange={collab.setCitationStyle}
          canEdit={canEdit}
          assetStore={assetStore}
          onAssetsChanged={recompile}
          useLibrary={collab.useLibrary}
          onUseLibraryChange={collab.setUseLibrary}
          onCite={() => setDialog('cite')}
        />
      </div>

      {dialog === 'share' && (
        <ShareDialog doc={{ id: doc.id, title }} canManage={doc.role === 'owner'}
          onClose={() => { setDialog(null); api<{ doc: DocMeta }>(`/docs/${doc.id}`).then(r => setDoc(r.doc)).catch(() => {}) }} />
      )}
      {dialog === 'cite' && <CitePicker onClose={() => setDialog(null)} onInsert={insertText} />}
      {dialog === 'history' && <VersionHistory docId={doc.id} canRestore={canEdit} onClose={() => setDialog(null)} />}
      {dialog === 'trash' && (
        <Confirm title="Move to trash?" action="Move to trash" danger onClose={() => setDialog(null)} onConfirm={moveToTrash}
          message={<>“{title}” will be moved to the trash and collaborators will lose access. You can restore it from the trash at any time.</>} />
      )}
    </div>
  )
}
