import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError, download, type Reference } from '../lib/api'
import { ENTRY_TYPES, FIELD_LABELS, authorsShort, fieldsFor, matches, plain, suggestKey, typeLabel, yearOf } from '../lib/refs'
import { PageShell } from '../components/PageShell'
import { Confirm, Icon, Modal, toast, toastError } from '../components/ui'

type Draft = { id?: string; key: string; type: string; fields: Record<string, string> }
type Dialog = { kind: 'edit'; draft: Draft } | { kind: 'import' } | { kind: 'delete'; ref: Reference } | null

/** The personal reference library: cite any entry from any document with @key — no .bib upload needed. */
export function References() {
  const [refs, setRefs] = useState<Reference[] | null>(null)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)

  const load = useCallback(() => api<{ refs: Reference[] }>('/refs').then(r => setRefs(r.refs)).catch(e => { toastError(e); setRefs([]) }), [])
  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (refs ?? []).filter(r => matches(r, q))
  }, [refs, query])

  const exportAll = async () => {
    try {
      const res = await fetch('/api/refs/export', { credentials: 'same-origin' })
      if (!res.ok) throw new Error('Export failed')
      download(await res.text(), 'references.bib', 'text/plain')
    } catch (e) { toastError(e) }
  }
  const remove = async (ref: Reference) => {
    try { await api(`/refs/${ref.id}`, { method: 'DELETE' }); toast('Reference deleted') } catch (e) { toastError(e) }
    load()
  }
  const copyKey = (key: string) => navigator.clipboard.writeText(`@${key}`).then(() => toast(`Copied @${key}`), () => {})

  return (
    <PageShell title="Reference library">
      <div className="page-head">
        <h1>Reference library</h1>
        <input className="input" type="search" placeholder="Search references" aria-label="Search references" value={query} onChange={e => setQuery(e.target.value)} />
        <button className="btn" onClick={() => setDialog({ kind: 'import' })}><Icon name="upload" size={16} />Import</button>
        <button className="btn" onClick={exportAll} disabled={!refs?.length}><Icon name="download" size={16} />Export .bib</button>
        <button className="btn btn-primary" onClick={() => setDialog({ kind: 'edit', draft: { key: '', type: 'article', fields: {} } })}><Icon name="plus" size={16} />Add reference</button>
      </div>
      <p className="hint" style={{ marginBottom: 16, maxWidth: 760 }}>
        References you keep here work in every document. Type <code>@key</code> for “Smith (2020)” or <code>[@key]</code> for “(Smith, 2020)”
        and the bibliography is added automatically — there is nothing to upload. Each document can turn this off in its Files tab.
      </p>

      {!refs ? <div className="spinner" /> : refs.length === 0 ? (
        <div className="empty">
          <Icon name="book" size={44} />
          <h3>Your library is empty</h3>
          <p>Add a reference by hand or from a DOI, or import a .bib file from Zotero, Mendeley or EndNote.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Key</th><th>Title</th><th>Authors</th><th>Year</th><th>Type</th><th style={{ width: 84 }} /></tr></thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.id} className="clickable" onClick={() => setDialog({ kind: 'edit', draft: { id: r.id, key: r.key, type: r.type, fields: { ...r.fields } } })}>
                  <td><span className="mono strong">{r.key}</span></td>
                  <td className="strong" style={{ maxWidth: 420 }}><div className="truncate" title={plain(r.fields.title)}>{plain(r.fields.title) || <span style={{ color: 'var(--overlay)' }}>Untitled</span>}</div></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{authorsShort(r)}</td>
                  <td>{yearOf(r)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{typeLabel(r.type)}</td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button className="icon-btn" title={`Copy @${r.key}`} aria-label={`Copy citation key ${r.key}`} onClick={e => { e.stopPropagation(); copyKey(r.key) }}><Icon name="copy" size={16} /></button>
                    <button className="icon-btn" title="Delete" aria-label={`Delete ${r.key}`} onClick={e => { e.stopPropagation(); setDialog({ kind: 'delete', ref: r }) }}><Icon name="trash" size={16} /></button>
                  </td>
                </tr>
              ))}
              {visible.length === 0 && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28 }}>Nothing matches “{query}”.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {refs && refs.length > 0 && <p className="hint" style={{ marginTop: 10, fontSize: 12 }}>{refs.length} {refs.length === 1 ? 'reference' : 'references'}</p>}

      {dialog?.kind === 'edit' && <EditReference draft={dialog.draft} onClose={() => setDialog(null)} onSaved={load} />}
      {dialog?.kind === 'import' && <ImportReferences onClose={() => setDialog(null)} onDone={load} />}
      {dialog?.kind === 'delete' && (
        <Confirm title="Delete reference?" action="Delete" danger onClose={() => setDialog(null)} onConfirm={() => remove(dialog.ref)}
          message={<>Documents that cite <code>@{dialog.ref.key}</code> will show an error until the citation is removed or the reference is added again.</>} />
      )}
    </PageShell>
  )
}

function EditReference({ draft, onClose, onSaved }: { draft: Draft; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState(draft.type)
  const [key, setKey] = useState(draft.key)
  const [fields, setFields] = useState(draft.fields)
  const [keyTouched, setKeyTouched] = useState(!!draft.key)
  const [doi, setDoi] = useState('')
  const [looking, setLooking] = useState(false)
  const [error, setError] = useState('')

  const standard = fieldsFor(type)
  // Fields that came from an import but are not part of this type's form are kept and shown below.
  const extra = Object.keys(fields).filter(f => !standard.includes(f))
  const set = (name: string, value: string) => setFields(f => ({ ...f, [name]: value }))
  const shownKey = keyTouched ? key : suggestKey(fields)

  const lookup = async () => {
    setError('')
    setLooking(true)
    try {
      const { entry } = await api<{ entry: Draft }>('/refs/lookup', { body: { doi } })
      setType(ENTRY_TYPES.some(t => t.id === entry.type) ? entry.type : 'misc')
      setFields(entry.fields)
      if (!keyTouched) setKey('')
    } catch (e) { setError((e as Error).message) } finally { setLooking(false) }
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const body = { key: shownKey, type, fields }
      if (draft.id) await api(`/refs/${draft.id}`, { method: 'PUT', body })
      else await api('/refs', { body })
      toast(draft.id ? 'Reference saved' : `Added — cite it with @${shownKey}`)
      onSaved()
      onClose()
    } catch (err) { setError((err as Error).message) }
  }

  return (
    <Modal title={draft.id ? 'Edit reference' : 'Add reference'} onClose={onClose} width={620}>
      <form onSubmit={save}>
        {!draft.id && (
          <div className="row" style={{ marginBottom: 16 }}>
            <div className="field" style={{ flex: 1 }}>
              <label className="label" htmlFor="rf-doi">Fill in from a DOI</label>
              <input id="rf-doi" className="input" value={doi} onChange={e => setDoi(e.target.value)} placeholder="10.1038/nature14539"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); if (doi.trim()) lookup() } }} />
            </div>
            <button type="button" className="btn" style={{ height: 36 }} disabled={!doi.trim() || looking} onClick={lookup}>{looking ? 'Looking up…' : 'Look up'}</button>
          </div>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="row" style={{ marginBottom: 14 }}>
          <div className="field" style={{ flex: '1 1 180px' }}>
            <label className="label" htmlFor="rf-type">Type</label>
            <select id="rf-type" className="select" style={{ width: '100%', height: 36 }} value={ENTRY_TYPES.some(t => t.id === type) ? type : 'misc'} onChange={e => setType(e.target.value)}>
              {ENTRY_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: '1 1 180px' }}>
            <label className="label" htmlFor="rf-key">Citation key</label>
            <input id="rf-key" className="input mono" value={shownKey} onChange={e => { setKeyTouched(true); setKey(e.target.value.replace(/[^A-Za-z0-9_:-]/g, '')) }}
              placeholder="Smith2020" maxLength={80} required spellCheck={false} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 14px' }}>
          {[...standard, ...extra].map(name => (
            <div key={name} className="field" style={name === 'title' || name === 'author' ? { gridColumn: '1 / -1' } : undefined}>
              <label className="label" htmlFor={`rf-${name}`}>{FIELD_LABELS[name] ?? name}</label>
              <input id={`rf-${name}`} className="input" value={fields[name] ?? ''} onChange={e => set(name, e.target.value)}
                placeholder={name === 'author' || name === 'editor' ? 'Smith, Jane and Doe, John' : undefined} />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={!shownKey}>{draft.id ? 'Save' : 'Add reference'}</button>
        </div>
      </form>
    </Modal>
  )
}

function ImportReferences({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('')
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const readFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const parts = await Promise.all(Array.from(files).map(f => f.text()))
    setText(t => [t, ...parts].filter(Boolean).join('\n\n'))
  }

  const run = async () => {
    setError('')
    setBusy(true)
    try {
      const r = await api<{ added: number; updated: number; skipped: number; unreadable: number }>('/refs/import', { body: { bibtex: text, replace } })
      const parts = [`${r.added} added`]
      if (r.updated) parts.push(`${r.updated} updated`)
      if (r.skipped) parts.push(`${r.skipped} already in your library`)
      if (r.unreadable) parts.push(`${r.unreadable} could not be read`)
      toast(parts.join(' · '))
      onDone()
      onClose()
    } catch (e) {
      setError((e as ApiError).status === 413 ? 'That is too much to import at once — split the file and import it in parts.' : (e as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <Modal title="Import references" onClose={onClose} width={640} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={!text.trim() || busy} onClick={run}>{busy ? 'Importing…' : 'Import'}</button>
    </>}>
      <p className="hint" style={{ marginBottom: 12 }}>Choose a <code>.bib</code> file exported from Zotero, Mendeley, EndNote or Google Scholar, or paste BibTeX below.</p>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="btn" style={{ marginBottom: 10 }} onClick={() => fileInput.current?.click()}><Icon name="upload" size={16} />Choose .bib file</button>
      <input ref={fileInput} type="file" accept=".bib,.bibtex,.txt" multiple hidden onChange={e => { readFiles(e.target.files); e.target.value = '' }} />
      <textarea className="textarea" rows={11} value={text} onChange={e => setText(e.target.value)} spellCheck={false} aria-label="BibTeX"
        placeholder={'@article{Smith2020,\n  title = {…},\n  author = {Smith, Jane},\n  year = {2020}\n}'} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13 }}>
        <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
        Replace references that have the same key
      </label>
    </Modal>
  )
}
