import { useState, useEffect, useRef, useCallback } from 'react'
import { apiBytes, ApiError } from '../lib/api'
import type { CitationStyle } from './useCollab'

const DEBOUNCE_MS = 350

/**
 * Compiles the document to PDF as it changes.
 * At most one request is in flight; edits made meanwhile are coalesced into a
 * single follow-up compile, so the preview is never more than one compile behind.
 */
export function useCompiler(content: string, docId: string, citationStyle: CitationStyle = 'author-date', useLibrary = true, enabled = true) {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCompiling, setIsCompiling] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ content, citationStyle, useLibrary })
  latest.current = { content, citationStyle, useLibrary }
  const running = useRef(false)
  const dirty = useRef(false)
  const alive = useRef(true)

  const compile = useCallback(async () => {
    if (running.current) { dirty.current = true; return }
    running.current = true
    setIsCompiling(true)
    do {
      dirty.current = false
      try {
        const bytes = await apiBytes(`/docs/${docId}/compile`, { body: latest.current })
        if (!alive.current) return
        setPdfBytes(bytes)
        setError(null)
      } catch (e) {
        if (!alive.current) return
        setError((e as ApiError).status === 422 ? (e as Error).message : `Could not compile: ${(e as Error).message}`)
        if ((e as ApiError).status !== 422) break // server/network trouble: wait for the next edit instead of hammering
      }
    } while (dirty.current)
    running.current = false
    setIsCompiling(false)
  }, [docId])

  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // Debounced compile on content change
  useEffect(() => {
    if (!enabled) return
    timerRef.current = setTimeout(compile, DEBOUNCE_MS)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [content, citationStyle, useLibrary, compile, enabled])

  // Immediate recompile (e.g. after asset upload)
  const recompile = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    compile()
  }, [compile])

  return { pdfBytes, error, isCompiling, recompile }
}
