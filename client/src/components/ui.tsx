import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

// ── Icons (inline SVG, 24px grid, stroke) ────────────────────────────────────

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.9-3.9',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4',
  users: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM20 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 4.2a3.5 3.5 0 0 1 0 6.6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
  star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  more: 'M12 5.5h.01M12 12h.01M12 18.5h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  download: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  share: 'M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.300 6.5-3.8 9c-2.5-2.5-3.8-5.500-3.8-9S9.500 5.500 12 3z',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.500 4.500L19 7.500',
  restore: 'M4 12a8 8 0 1 0 2.600-5.900M4 4v4.500h4.500',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.500 20a7.500 7.500 0 0 1 15 0',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  history: 'M4 12a8 8 0 1 0 2.600-5.900M4 4v4.500h4.500M12 8v4.500l3 1.500',
  image: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 16l4.500-4.500 4 4 3-3L20 17M9 9h.01',
  cloud: 'M7 18a4.500 4.500 0 0 1-.500-9 6 6 0 0 1 11.600 1.500A3.800 3.800 0 0 1 17.500 18zM9.500 13.500l2 2 3.500-3.500',
  cloudOff: 'M7 18a4.500 4.500 0 0 1-.500-9 6 6 0 0 1 11.600 1.500A3.800 3.800 0 0 1 17.500 18zM10 12l4 4M14 12l-4 4',
  chevron: 'M6 9l6 6 6-6',
  eye: 'M2.500 12S6 5.500 12 5.500 21.500 12 21.500 12 18 18.500 12 18.500 2.500 12 2.500 12zM12 9.500a2.500 2.500 0 1 0 0 5 2.500 2.500 0 0 0 0-5z',
  shield: 'M12 3l7 3v5.500c0 4.500-3 8-7 9.500-4-1.500-7-5-7-9.500V6zM9 12l2.200 2.200L15.200 10',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.500v2M12 19.500v2M4.600 4.600l1.400 1.400M18 18l1.400 1.400M2.500 12h2M19.500 12h2M4.600 19.400L6 18M18 6l1.400-1.400',
  moon: 'M20 14.500A8 8 0 0 1 9.500 4a8 8 0 1 0 10.500 10.500z',
  monitor: 'M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 21h6M12 17v4',
  key: 'M14.500 9.500a4 4 0 1 0-3.700 2.500L4 18.800V21h3v-2h2v-2h2l1.700-1.700M16.500 7.500h.01',
  mail: 'M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.500 7l8.500 6 8.500-6',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  chart: 'M4 20V10M10 20V4M16 20v-7M21 20H3',
  quote: 'M9 7H6a2 2 0 0 0-2 2v3h4v3a2 2 0 0 1-2 2M19 7h-3a2 2 0 0 0-2 2v3h4v3a2 2 0 0 1-2 2',
  book: 'M5 4.500A1.500 1.500 0 0 1 6.500 3H19v15H6.500A1.500 1.500 0 0 0 5 19.500zM5 19.500A1.500 1.500 0 0 0 6.500 21H19',
} as const
export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18, fill }: { name: IconName; size?: number; fill?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'} stroke="currentColor"
      strokeWidth={name === 'more' ? 2.6 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

// ── Avatar ───────────────────────────────────────────────────────────────────

export function Avatar({ name, color, title, size }: { name: string; color: string; title?: string; size?: number }) {
  return (
    <span className="avatar" title={title ?? name} style={{ background: color, ...(size ? { width: size, height: size, fontSize: size * 0.42 } : null) }}>
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}

// ── Dropdown menu ────────────────────────────────────────────────────────────

interface MenuProps {
  /** Element (or point) the menu is attached to. */
  anchor: HTMLElement | { x: number; y: number }
  onClose: () => void
  align?: 'left' | 'right'
  children: React.ReactNode
}

export function Menu({ anchor, onClose, align = 'left', children }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    let left: number, top: number
    if (anchor instanceof HTMLElement) {
      const r = anchor.getBoundingClientRect()
      left = align === 'right' ? r.right - width : r.left
      top = r.bottom + 6
      if (top + height > window.innerHeight - 8) top = Math.max(8, r.top - height - 6)
    } else {
      left = anchor.x
      top = anchor.y
      if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8)
    }
    setPos({ left: Math.max(8, Math.min(left, window.innerWidth - width - 8)), top })
  }, [anchor, align])

  useEffect(() => {
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    // Defer so the click that opened the menu does not immediately close it.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', down, true)
      document.addEventListener('contextmenu', down, true)
    })
    document.addEventListener('keydown', key, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('contextmenu', down, true)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  useEffect(() => { if (pos) ref.current?.querySelector<HTMLElement>('.menu-item:not(:disabled)')?.focus({ preventScroll: true }) }, [pos])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('.menu-item:not(:disabled)') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }

  return createPortal(
    <div ref={ref} className="menu" role="menu" onKeyDown={onKeyDown}
      style={pos ? pos : { left: 0, top: 0, visibility: 'hidden' }}
      onClick={e => { if ((e.target as HTMLElement).closest('.menu-item')) onClose() }}>
      {children}
    </div>,
    document.body,
  )
}

export function MenuItem({ icon, children, onClick, danger, disabled, checked }: {
  icon?: IconName; children: React.ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean; checked?: boolean
}) {
  return (
    <button className={`menu-item${danger ? ' danger' : ''}`} role="menuitem" disabled={disabled} onClick={onClick}>
      {icon && <Icon name={icon} size={16} />}
      <span className="truncate">{children}</span>
      {checked && <span className="check"><Icon name="check" size={16} /></span>}
    </button>
  )
}

/** A button that toggles a dropdown menu anchored to itself. */
export function MenuButton({ className = 'icon-btn', label, title, align, children, menu }: {
  className?: string; label?: string; title?: string; align?: 'left' | 'right'; children: React.ReactNode; menu: React.ReactNode
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <button className={className} title={title} aria-label={label ?? title} aria-haspopup="menu" aria-expanded={!!anchor}
        onClick={e => { e.stopPropagation(); setAnchor(a => (a ? null : e.currentTarget)) }}>
        {children}
      </button>
      {anchor && <Menu anchor={anchor} align={align} onClose={() => setAnchor(null)}>{menu}</Menu>}
    </>
  )
}

// ── Modal ────────────────────────────────────────────────────────────────────

export function Modal({ title, onClose, children, footer, width }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || !ref.current) return
      // Keep keyboard focus inside the dialog.
      const focusable = ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, a[href]')
      if (focusable.length === 0) return
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', key)
    if (!ref.current?.contains(document.activeElement)) {
      (ref.current?.querySelector<HTMLElement>('[autofocus], input, select, textarea') ?? ref.current)?.focus()
    }
    return () => { document.removeEventListener('keydown', key); previous?.focus?.() }
  }, [onClose])

  return createPortal(
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} style={width ? { maxWidth: width } : undefined}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** Confirmation dialog for destructive actions. */
export function Confirm({ title, message, action, danger, onConfirm, onClose }: {
  title: string; message: React.ReactNode; action: string; danger?: boolean; onConfirm: () => void; onClose: () => void
}) {
  return (
    <Modal title={title} onClose={onClose} width={420} footer={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => { onConfirm(); onClose() }}>{action}</button>
    </>}>
      <p style={{ color: 'var(--subtext)', fontSize: 14 }}>{message}</p>
    </Modal>
  )
}

/** Small dialog asking for a single line of text (rename, etc.). */
export function Prompt({ title, label, initial, action, onSubmit, onClose }: {
  title: string; label: string; initial: string; action: string; onSubmit: (value: string) => void; onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (value.trim()) { onSubmit(value.trim()); onClose() } }
  return (
    <Modal title={title} onClose={onClose} width={420}>
      <form onSubmit={submit}>
        <label className="label" htmlFor="prompt-input">{label}</label>
        <input id="prompt-input" className="input" value={value} maxLength={120} autoFocus onFocus={e => e.currentTarget.select()} onChange={e => setValue(e.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim()}>{action}</button>
        </div>
      </form>
    </Modal>
  )
}

// ── Toasts ───────────────────────────────────────────────────────────────────

interface ToastItem { id: number; text: string; error: boolean }
let toasts: ToastItem[] = []
let nextToast = 1
const toastListeners = new Set<() => void>()
const emit = () => toastListeners.forEach(l => l())

export function toast(text: string, error = false): void {
  const id = nextToast++
  toasts = [...toasts.slice(-2), { id, text, error }]
  emit()
  setTimeout(() => { toasts = toasts.filter(t => t.id !== id); emit() }, error ? 5000 : 2600)
}
/** Report a failed action to the user. */
export const toastError = (e: unknown) => toast((e as Error)?.message || 'Something went wrong', true)

export function Toasts() {
  const items = useSyncExternalStore(cb => { toastListeners.add(cb); return () => toastListeners.delete(cb) }, () => toasts)
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {items.map(t => <div key={t.id} className={`toast${t.error ? ' error' : ''}`}>{t.text}</div>)}
    </div>,
    document.body,
  )
}
