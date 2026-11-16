import { useState, useCallback } from 'react'
import { api } from '../lib/api'

export interface Asset {
  name: string
  size: number
  modified: number
}

const ALLOWED = /\.(png|jpe?g|gif|webp|svg|pdf|bib)$/i
const MAX_BYTES = 20 * 1024 * 1024

/** Make a filename acceptable to the server: ASCII letters, digits, space, dot, dash, underscore, parentheses. */
export function safeAssetName(name: string): string {
  const clean = name.normalize('NFKD').replace(/[^A-Za-z0-9 ._()-]+/g, '_').replace(/^[^A-Za-z0-9]+/, '')
  return clean.length > 100 ? clean.slice(0, 100 - 8) + clean.slice(-8) : clean
}

export function useAssets(docId: string) {
  const [assets, setAssets]       = useState<Asset[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await api<{ files: Asset[] }>(`/docs/${docId}/assets`)
      setAssets(data.files ?? [])
    } catch (e) {
      setError(`Failed to load files: ${(e as Error).message}`)
    }
  }, [docId])

  /** Uploads the files and resolves with the names they were stored under. */
  const upload = useCallback(async (files: FileList | File[]): Promise<string[]> => {
    setError(null)
    setUploading(true)
    const stored: string[] = []
    try {
      for (const file of Array.from(files)) {
        const name = safeAssetName(file.name)
        if (!ALLOWED.test(name)) throw new Error(`${file.name}: unsupported file type`)
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 20 MB`)
        // Sent as raw bytes — no base64 inflation, no JSON parsing on the server.
        await api(`/docs/${docId}/assets/${encodeURIComponent(name)}`, { method: 'PUT', raw: file })
        stored.push(name)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
      await refresh()
    }
    return stored
  }, [docId, refresh])

  const remove = useCallback(async (name: string) => {
    try {
      await api(`/docs/${docId}/assets/${encodeURIComponent(name)}`, { method: 'DELETE' })
      await refresh()
    } catch (e) {
      setError(`Failed to delete: ${(e as Error).message}`)
    }
  }, [docId, refresh])

  return { assets, uploading, error, refresh, upload, remove }
}
