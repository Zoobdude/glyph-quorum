import React, { useRef, useEffect, useState, useCallback, useLayoutEffect } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
// @ts-ignore
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

interface Props {
  pdfBytes: Uint8Array | null
  error: string | null
  isCompiling: boolean
}

interface Loaded { doc: PDFDocumentProxy; version: number; sizes: { w: number; h: number }[] }

const GUTTER = 28
const MAX_CANVAS_PIXELS = 16_000_000

/**
 * PDF preview that only rasterises the pages near the viewport.
 * Page containers persist between compiles and each canvas is swapped in place once
 * its replacement is ready, so typing never causes flicker or a scroll jump.
 */
export function Preview({ pdfBytes, error, isCompiling }: Props) {
  const scrollRef  = useRef<HTMLDivElement>(null)
  const pageRefs   = useRef<(HTMLDivElement | null)[]>([])
  const visible    = useRef(new Set<number>())
  const loadedRef  = useRef<Loaded | null>(null)
  const scaleRef   = useRef(1)
  const queue      = useRef<Promise<void>>(Promise.resolve())
  const versionRef = useRef(0)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [zoom, setZoom]     = useState(1)
  const [width, setWidth]   = useState(0)

  // Track container width so pages re-fit when the panel is resized
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Parse each new PDF (cheap), keeping the previous one on screen until it is ready.
  useEffect(() => {
    if (!pdfBytes) return
    const version = ++versionRef.current
    let cancelled = false
    ;(async () => {
      try {
        // pdf.js takes ownership of the buffer, so hand it a copy.
        const doc = await pdfjsLib.getDocument({ data: pdfBytes.slice(), isEvalSupported: false }).promise
        const sizes: Loaded['sizes'] = []
        for (let p = 1; p <= doc.numPages; p++) {
          const vp = (await doc.getPage(p)).getViewport({ scale: 1 })
          sizes.push({ w: vp.width, h: vp.height })
        }
        if (cancelled || version !== versionRef.current) { doc.destroy(); return }
        const previous = loadedRef.current
        loadedRef.current = { doc, version, sizes }
        setLoaded(loadedRef.current)
        // Free the old document once in-flight renders against it have drained.
        if (previous) queue.current = queue.current.then(() => { previous.doc.destroy() })
      } catch (e) {
        console.error('PDF load error:', e)
      }
    })()
    return () => { cancelled = true }
  }, [pdfBytes])

  useEffect(() => () => { loadedRef.current?.doc.destroy(); loadedRef.current = null }, [])

  const widest = loaded ? Math.max(...loaded.sizes.map(s => s.w)) : 1
  const scale = width > 0 ? Math.max(0.1, ((width - GUTTER * 2) / widest) * zoom) : 0
  scaleRef.current = scale

  const renderPage = useCallback((index: number) => {
    queue.current = queue.current.then(async () => {
      const cur = loadedRef.current
      const host = pageRefs.current[index]
      const s = scaleRef.current
      if (!cur || !host || s <= 0 || index >= cur.sizes.length || !visible.current.has(index)) return
      const key = `${cur.version}:${s.toFixed(4)}`
      if (host.dataset.rendered === key) return
      try {
        const page = await cur.doc.getPage(index + 1)
        let ratio = Math.min(window.devicePixelRatio || 1, 2)
        const base = page.getViewport({ scale: s })
        if (base.width * base.height * ratio * ratio > MAX_CANVAS_PIXELS) ratio = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height))
        const vp = page.getViewport({ scale: s * ratio })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(vp.width)
        canvas.height = Math.floor(vp.height)
        await page.render({ canvasContext: canvas.getContext('2d', { alpha: false })!, viewport: vp }).promise
        // Skip the swap if a newer document or zoom level arrived while rendering.
        if (loadedRef.current !== cur || scaleRef.current !== s) return
        host.replaceChildren(canvas)
        host.dataset.rendered = key
      } catch (e) {
        if ((e as Error)?.name !== 'RenderingCancelledException') console.error('PDF render error:', e)
      }
    })
  }, [])

  // Render pages as they approach the viewport…
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !loaded) return
    const io = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.index)
        if (entry.isIntersecting) { visible.current.add(index); renderPage(index) }
        else visible.current.delete(index)
      }
    }, { root, rootMargin: '800px 0px' })
    pageRefs.current.slice(0, loaded.sizes.length).forEach(el => el && io.observe(el))
    return () => { io.disconnect(); visible.current.clear() }
  }, [loaded?.sizes.length, scale > 0, renderPage]) // eslint-disable-line react-hooks/exhaustive-deps

  // …and refresh the ones already on screen whenever the document or scale changes.
  useEffect(() => {
    if (!loaded || scale <= 0) return
    const t = setTimeout(() => visible.current.forEach(renderPage), 0)
    return () => clearTimeout(t)
  }, [loaded, scale, renderPage])

  const changeZoom = useCallback((delta: number) => {
    setZoom(z => Math.min(3, Math.max(0.25, Math.round((z + delta) * 100) / 100)))
  }, [])

  // Ctrl/⌘ + wheel zooms the preview, like any document viewer.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      changeZoom(e.deltaY < 0 ? 0.1 : -0.1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [changeZoom])

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <div ref={scrollRef} className="preview-scroll">
        {loaded && scale > 0 && loaded.sizes.map((size, i) => (
          <div
            key={i}
            ref={el => { pageRefs.current[i] = el }}
            data-index={i}
            className="preview-page"
            style={{ width: Math.floor(size.w * scale), height: Math.floor(size.h * scale) }}
          />
        ))}
        {!loaded && (
          <div className="center-fill" style={{ position: 'absolute', inset: 0 }}>
            {isCompiling || pdfBytes
              ? <><div className="spinner" /><span>Compiling…</span></>
              : !error && <span>Start typing to see the preview</span>}
          </div>
        )}
      </div>

      {error && (
        <div role="alert" style={{ flexShrink: 0, maxHeight: '38%', overflow: 'auto', padding: '10px 14px', borderTop: '1px solid var(--danger-line)', background: 'var(--danger-bg)', whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.55, color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {loaded && (
        <div className="panel-foot">
          <button className="icon-btn" onClick={() => changeZoom(-0.1)} aria-label="Zoom out">−</button>
          <button onClick={() => setZoom(1)} title="Fit to width" style={{ fontSize: 12, color: 'var(--subtext)', background: 'none', border: 'none', minWidth: 44, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </button>
          <button className="icon-btn" onClick={() => changeZoom(0.1)} aria-label="Zoom in">+</button>
          <span style={{ marginLeft: 8, color: 'var(--overlay)' }}>{loaded.sizes.length} {loaded.sizes.length === 1 ? 'page' : 'pages'}</span>
        </div>
      )}
    </div>
  )
}
