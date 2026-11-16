import React, { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Reference } from '../lib/api'
import { authorsShort, matches, plain, yearOf } from '../lib/refs'
import { Modal, toastError } from './ui'

interface Props {
  onInsert: (text: string) => void
  onClose: () => void
}

/** Search the reference library and insert a citation at the cursor. */
export function CitePicker({ onInsert, onClose }: Props) {
  const [refs, setRefs] = useState<Reference[] | null>(null)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)

  useEffect(() => {
    api<{ refs: Reference[] }>('/refs').then(r => setRefs(r.refs)).catch(e => { toastError(e); setRefs([]) })
  }, [])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (refs ?? []).filter(r => matches(r, q)).slice(0, 60)
  }, [refs, query])
  useEffect(() => setIndex(0), [query])

  const insert = (r: Reference | undefined, parenthetical: boolean) => {
    if (!r) return
    onInsert(parenthetical ? `[@${r.key}]` : `@${r.key}`)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(visible.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); insert(visible[index], e.shiftKey) }
  }

  return (
    <Modal title="Insert citation" onClose={onClose} width={600}>
      <input className="input" type="search" placeholder="Search your reference library" aria-label="Search references" value={query} autoFocus
        onChange={e => setQuery(e.target.value)} onKeyDown={onKeyDown} />
      <div role="listbox" aria-label="References" style={{ marginTop: 10, maxHeight: 'min(46vh, 380px)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!refs ? <div className="spinner" style={{ margin: 12 }} /> : visible.length === 0 ? (
          <p className="hint" style={{ padding: '18px 4px' }}>
            {refs.length === 0 ? 'Your reference library is empty. ' : 'No references match. '}
            <Link to="/references" target="_blank" rel="noopener">Open the reference library</Link> to add some.
          </p>
        ) : visible.map((r, i) => (
          <div key={r.id} role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => insert(r, false)}
            ref={el => { if (i === index) el?.scrollIntoView({ block: 'nearest' }) }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 7, cursor: 'pointer', background: i === index ? 'var(--accent-soft)' : undefined }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="truncate" style={{ fontWeight: 550 }}>{plain(r.fields.title) || r.key}</div>
              <div className="truncate" style={{ fontSize: 12, color: 'var(--subtext)' }}>
                {[authorsShort(r), yearOf(r)].filter(Boolean).join(', ')} · <span className="mono">@{r.key}</span>
              </div>
            </div>
            {i === index && (
              <button className="btn" style={{ height: 26, fontSize: 12 }} title="Insert as (Author, Year)" onClick={e => { e.stopPropagation(); insert(r, true) }}>(Author, Year)</button>
            )}
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 12, fontSize: 12 }}>
        <kbd>Enter</kbd> inserts <code>@key</code> — “Smith (2020)”. <kbd>Shift</kbd>+<kbd>Enter</kbd> inserts <code>[@key]</code> — “(Smith, 2020)”.
      </p>
    </Modal>
  )
}
