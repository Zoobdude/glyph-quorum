import { spawn, execSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { cpus } from 'os'
import { ASSETS_DIR, ID_RE } from './db.js'
import { formatBibtex } from './bibtex.js'
import { resolveCitations, libraryVersion, onLibraryChange } from './references.js'

export type CitationStyle = 'numbered' | 'author-date'

function findTypstBin(): string {
  try {
    const cmd = process.platform === 'win32' ? 'where typst' : 'which typst'
    const found = execSync(cmd, { encoding: 'utf8' }).trim().split('\n')[0]
    if (found && existsSync(found)) return found
  } catch {}

  const candidates: string[] =
    process.platform === 'win32'
      ? [
          `${process.env.LOCALAPPDATA}\\Programs\\typst\\typst.exe`,
          `${process.env.USERPROFILE}\\.cargo\\bin\\typst.exe`,
        ]
      : process.platform === 'darwin'
        ? [
            '/opt/homebrew/bin/typst',
            '/usr/local/bin/typst',
            `${process.env.HOME}/.cargo/bin/typst`,
          ]
        : [
            '/usr/bin/typst',
            '/usr/local/bin/typst',
            `${process.env.HOME}/.cargo/bin/typst`,
          ]

  return candidates.find(existsSync) ?? 'typst'
}

const TYPST_BIN = findTypstBin()

/** Returns the assets directory for a document (created on demand). */
export function getAssetsDir(docId: string): string {
  if (!ID_RE.test(docId)) throw new Error('invalid document id')
  const dir = join(ASSETS_DIR, docId)
  mkdirSync(dir, { recursive: true })
  return dir
}

// Assets only change through our API, so a per-document counter is enough to
// invalidate cached compile results when files are added or removed.
const assetVersions = new Map<string, number>()
export function touchAssets(docId: string): void {
  assetVersions.set(docId, (assetVersions.get(docId) ?? 0) + 1)
  cache.delete(docId)
}

function listBibFilenames(docId: string): string[] {
  try {
    return readdirSync(getAssetsDir(docId)).filter(f => f.toLowerCase().endsWith('.bib'))
  } catch {
    return []
  }
}

/** Citation keys defined in the document's .bib files (e.g. `@article{Smith2020, ...}` defines `Smith2020`). */
function bibKeys(docId: string, bibFiles: string[]): Set<string> {
  const keys = new Set<string>()
  const dir = getAssetsDir(docId)
  for (const f of bibFiles) {
    try {
      const text = readFileSync(join(dir, f), 'utf8')
      for (const m of text.matchAll(/^\s*@\w+\s*[{(]\s*([^\s,]+)\s*,/gm)) keys.add(m[1])
    } catch {}
  }
  return keys
}

// String literals, inline raw text and line comments are never rewritten.
const PROTECTED = /("(?:\\.|[^"\\])*"|`[^`]*`|(?<!:)\/\/.*$)/

/**
 * Rewrite citation shorthand into explicit Typst #cite() calls:
 *   [@key]  (bracketed, possibly multiple "; "-separated) -> parenthetical, e.g. "(Masson et al., 2021)"
 *   @key    (bare)                                        -> narrative, e.g. "Masson et al. (2021)"
 * Only keys that exist in the document's .bib files are rewritten, so everything else —
 * `#import "@preview/..."`, e-mail addresses, Typst's own `@label` references — is left alone.
 */
function preprocessCitations(body: string, keys: Set<string>): string {
  const rewrite = (text: string) => text
    .replace(/\[(@[\w:-]+(?:\s*;\s*@[\w:-]+)*)\]/g, (m, group: string) => {
      const parts = group.split(/\s*;\s*/).map(part => part.slice(1))
      return parts.every(k => keys.has(k)) ? parts.map(k => `#cite(<${k}>)`).join(' ') : m
    })
    .replace(/(?<![\w@])@([\w:-]+)/g, (m, key: string) => (keys.has(key) ? `#cite(<${key}>, form: "prose")` : m))

  let inFence = false
  return body
    .split('\n')
    .map(line => {
      const fence = /^\s*```/.test(line)
      if (fence) { inFence = !inFence; return line }
      if (inFence) return line
      return line.split(PROTECTED).map((part, i) => (i % 2 ? part : rewrite(part))).join('')
    })
    .join('\n')
}

/** Every citation key the source might be referring to: `@key`, `[@key]` and `<key>` (as in `#cite(<key>)`). */
function citedKeys(content: string): Set<string> {
  const keys = new Set<string>()
  for (const m of content.matchAll(/(?<![\w@])@([\w:-]+)|<([\w:-]+)>/g)) keys.add((m[1] ?? m[2]).replace(/[:-]+$/, ''))
  return keys
}

/** Quote arbitrary text as a Typst string literal. */
const typstString = (text: string): string =>
  `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`

function buildSource(content: string, docId: string, citationStyle: CitationStyle, useLibrary: boolean): string {
  const bibFiles = listBibFilenames(docId)
  const keys = bibKeys(docId, bibFiles)

  // Reference library: pull in just the entries this document cites that its own .bib files do not define.
  // They are passed to Typst inline, so nothing is written into the document's files.
  let libraryBib = ''
  if (useLibrary) {
    const wanted = [...citedKeys(content)].filter(k => !keys.has(k))
    const entries = wanted.length ? resolveCitations(docId, wanted) : []
    for (const e of entries) keys.add(e.key)
    libraryBib = formatBibtex(entries)
  }
  if (bibFiles.length === 0 && !libraryBib) return content

  let source = preprocessCitations(content, keys)
    // Drop any hand-written #bibliography(...) call — one is generated below,
    // governed by the document's citation style setting, and Typst rejects duplicates.
    .replace(/^\s*#bibliography\([^)]*\)\s*$/gm, '')
  if (source.includes('#cite(')) {
    const styleName = citationStyle === 'numbered' ? 'ieee' : 'apa'
    // Asset filenames are restricted to a safe character set on upload, so they can be quoted verbatim.
    const sources = bibFiles.map(f => `"${f}"`)
    if (libraryBib) sources.push(`bytes(${typstString(libraryBib)})`)
    source += `\n#bibliography(${sources.length === 1 ? sources[0] : `(${sources.join(', ')})`}, style: "${styleName}")\n`
  }
  return source
}

export type CompileResult =
  | { ok: true; data: Buffer }
  | { ok: false; error: string }

export interface CompileRequest {
  docId: string
  content: string
  citationStyle?: CitationStyle
  /** 'pdf' for the full document, 'png' for a low-resolution render of the first page. */
  format?: 'pdf' | 'png'
  /** Resolve citations against the collaborators' reference libraries (default on). */
  useLibrary?: boolean
}

// ── Scheduling: bounded concurrency, in-flight de-duplication, last-result cache ──

const MAX_CONCURRENT = Math.max(1, Math.min(4, cpus().length - 1))
const MAX_QUEUE = 64
const TIMEOUT_MS = 30_000
const MAX_OUTPUT = 64 * 1024 * 1024

export const BUSY = 'The server is busy compiling other documents — try again shortly.'

let running = 0
const waiting: (() => void)[] = []

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    if (waiting.length >= MAX_QUEUE) throw new Error('busy')
    await new Promise<void>(resolve => waiting.push(resolve))
  }
  running++
  try {
    return await fn()
  } finally {
    running--
    waiting.shift()?.()
  }
}

/** Collaborators typing in the same document all request the same compile — run it once. */
const inFlight = new Map<string, Promise<CompileResult>>()
/** Most recent successful PDF per document (small LRU). */
const cache = new Map<string, { key: string; result: CompileResult }>()
const CACHE_DOCS = 48
onLibraryChange(() => cache.clear())

export function compileTypst({ docId, content, citationStyle = 'author-date', format = 'pdf', useLibrary = true }: CompileRequest): Promise<CompileResult> {
  const key = createHash('sha1')
    .update(`${docId}\0${format}\0${citationStyle}\0${assetVersions.get(docId) ?? 0}\0${useLibrary ? libraryVersion() : 'off'}\0`)
    .update(content)
    .digest('base64')

  if (format === 'pdf') {
    const hit = cache.get(docId)
    if (hit?.key === key) return Promise.resolve(hit.result)
  }
  const pending = inFlight.get(key)
  if (pending) return pending

  const job = withSlot(() => runTypst(docId, buildSource(content, docId, citationStyle, useLibrary), format))
    .catch((e): CompileResult => ({
      ok: false,
      error: (e as Error).message === 'busy' ? BUSY : String(e),
    }))
    .then(result => {
      if (format === 'pdf' && result.ok && result.data.length < 16 * 1024 * 1024) {
        cache.delete(docId)
        cache.set(docId, { key, result })
        if (cache.size > CACHE_DOCS) cache.delete(cache.keys().next().value as string)
      }
      return result
    })
    .finally(() => inFlight.delete(key))
  inFlight.set(key, job)
  return job
}

function runTypst(docId: string, source: string, format: 'pdf' | 'png'): Promise<CompileResult> {
  // The source is piped over stdin and the result read from stdout, so nothing is
  // written to disk and concurrent compiles of one document cannot collide.
  // --root confines every file read to the document's own asset directory.
  const root = getAssetsDir(docId)
  const args = ['compile', '-', '-', '--format', format, '--root', root, '--diagnostic-format', 'short']
  if (format === 'png') args.push('--pages', '1', '--ppi', '56')

  return new Promise(resolve => {
    const child = spawn(TYPST_BIN, args, {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      // Do not hand server environment (secrets, config) to the compiler.
      env: { PATH: process.env.PATH, HOME: process.env.HOME, XDG_CACHE_HOME: process.env.XDG_CACHE_HOME, XDG_DATA_HOME: process.env.XDG_DATA_HOME, LANG: 'C.UTF-8' } as NodeJS.ProcessEnv,
    })

    const out: Buffer[] = []
    let outSize = 0
    let stderr = ''
    let failure: string | null = null

    const timer = setTimeout(() => {
      failure = `Compilation timed out after ${TIMEOUT_MS / 1000} seconds`
      child.kill('SIGKILL')
    }, TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      outSize += chunk.length
      if (outSize > MAX_OUTPUT) { failure = 'Compiled output is too large'; child.kill('SIGKILL'); return }
      out.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 20_000) stderr += chunk.toString() })
    child.stdin.on('error', () => {}) // EPIPE if typst exits before reading everything

    child.on('error', err => {
      clearTimeout(timer)
      resolve({ ok: false, error: `Failed to run typst: ${err.message}` })
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (failure) resolve({ ok: false, error: failure })
      else if (code === 0 && outSize > 0) resolve({ ok: true, data: Buffer.concat(out) })
      else resolve({ ok: false, error: cleanDiagnostics(stderr, root) || `typst exited with code ${code}` })
    })

    child.stdin.end(source, 'utf8')
  })
}

function cleanDiagnostics(stderr: string, root: string): string {
  return stderr
    .split(root).join('')            // never reveal server paths
    .replace(/^<stdin>:/gm, 'line ')
    .replace(/^\\\\\?\\/gm, '')
    .trim()
}
