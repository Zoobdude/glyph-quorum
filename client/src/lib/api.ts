export interface User { id: string; email: string; name: string; color: string; role: 'admin' | 'user' }
export type RegistrationMode = 'open' | 'invite' | 'closed'
export interface Reference { id: string; key: string; type: string; fields: Record<string, string>; updatedAt: number }
export type Role = 'owner' | 'editor' | 'viewer'
export type LinkAccess = 'none' | 'viewer' | 'editor'
export type DocView = 'mine' | 'shared' | 'recent' | 'starred' | 'trash'

export interface DocMeta {
  id: string
  title: string
  ownerId: string
  ownerName: string
  role: Role
  linkAccess: LinkAccess
  starred: boolean
  createdAt: number
  updatedAt: number
  trashedAt: number | null
  openedAt?: number | null
}

/** Someone as shown in sharing lists. */
export type Person = Pick<User, 'id' | 'email' | 'name' | 'color'>
export interface Member extends Person { role: 'viewer' | 'editor' }
export interface VersionInfo { id: number; createdAt: number; author: string; size: number }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** Fired when any request discovers the session is gone, so the app can show the sign-in page. */
export const UNAUTHORIZED_EVENT = 'gq:unauthorized'

interface Options { method?: string; body?: unknown; raw?: BodyInit; signal?: AbortSignal }

async function request(path: string, { method, body, raw, signal }: Options = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: method ?? (body !== undefined || raw !== undefined ? 'POST' : 'GET'),
      headers: raw !== undefined ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      credentials: 'same-origin',
      signal,
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new ApiError(0, 'Could not reach the server — check your connection.')
  }
  if (!res.ok) {
    const message = await res.json().then(d => d.error as string).catch(() => '') || `Request failed (${res.status})`
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(res.status, message)
  }
  return res
}

export const api = <T = unknown>(path: string, opts?: Options): Promise<T> => request(path, opts).then(r => r.json() as Promise<T>)
export const apiBytes = (path: string, opts?: Options): Promise<Uint8Array> => request(path, opts).then(async r => new Uint8Array(await r.arrayBuffer()))

export const thumbUrl = (doc: Pick<DocMeta, 'id' | 'updatedAt'>) => `/api/docs/${doc.id}/thumbnail?v=${doc.updatedAt}`
export const assetUrl = (docId: string, name: string, modified?: number) =>
  `/api/docs/${docId}/assets/${encodeURIComponent(name)}${modified ? `?m=${modified}` : ''}`

export function timeAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`
  const d = new Date(ts)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function download(data: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Turn a document title into a safe download filename. */
export const fileBase = (title: string) => title.replace(/[^\w .-]+/g, '_').trim().slice(0, 80) || 'document'
