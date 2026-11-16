/** A minimal, dependency-free BibTeX reader and writer — enough for reference-manager exports. */

export interface BibEntry {
  type: string
  key: string
  fields: Record<string, string>
}

export const KEY_RE = /^[A-Za-z0-9_:-]{1,80}$/
export const FIELD_RE = /^[a-z][a-z0-9_-]{0,39}$/
export const TYPE_RE = /^[a-z]{2,20}$/

/** Make any citation key usable with the `@key` shorthand and Typst labels. */
export const cleanKey = (key: string): string =>
  key.normalize('NFKD').replace(/[^A-Za-z0-9_:-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)

const MONTHS = new Set(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])

export function parseBibtex(text: string): { entries: BibEntry[]; skipped: number } {
  const entries: BibEntry[] = []
  const macros: Record<string, string> = {}
  let skipped = 0
  let i = 0
  const n = text.length

  const ws = () => { while (i < n && /\s/.test(text[i])) i++ }
  /** Read a {...} group starting at the opening brace; returns the inside. */
  const braced = (): string => {
    let depth = 0
    const start = i + 1
    for (; i < n; i++) {
      if (text[i] === '\\') { i++; continue }
      if (text[i] === '{') depth++
      else if (text[i] === '}' && --depth === 0) return text.slice(start, i++)
    }
    return text.slice(start)
  }
  const quoted = (): string => {
    let depth = 0
    const start = ++i
    for (; i < n; i++) {
      if (text[i] === '\\') { i++; continue }
      if (text[i] === '{') depth++
      else if (text[i] === '}') depth--
      else if (text[i] === '"' && depth <= 0) return text.slice(start, i++)
    }
    return text.slice(start)
  }
  /** value := piece ('#' piece)*  where piece is {…}, "…", a number, or a macro name. */
  const value = (): string => {
    let out = ''
    for (;;) {
      ws()
      if (text[i] === '{') out += braced()
      else if (text[i] === '"') out += quoted()
      else {
        const m = /^[^\s,#})]+/.exec(text.slice(i, i + 200))
        if (!m) break
        i += m[0].length
        const word = m[0]
        out += /^\d+$/.test(word) ? word : macros[word.toLowerCase()] ?? (MONTHS.has(word.toLowerCase()) ? word.toLowerCase() : word)
      }
      ws()
      if (text[i] === '#') { i++; continue }
      break
    }
    return out.replace(/\s+/g, ' ').trim()
  }

  while (i < n) {
    const at = text.indexOf('@', i)
    if (at < 0) break
    i = at + 1
    const tm = /^[A-Za-z]+/.exec(text.slice(i, i + 30))
    if (!tm) continue
    const type = tm[0].toLowerCase()
    i += tm[0].length
    ws()
    if (text[i] !== '{' && text[i] !== '(') continue
    if (type === 'comment' || type === 'preamble') { if (text[i] === '{') braced(); continue }
    i++ // past the opening delimiter

    if (type === 'string') {
      ws()
      const nm = /^[^\s=]+/.exec(text.slice(i, i + 100))
      if (nm) { i += nm[0].length; ws(); if (text[i] === '=') { i++; macros[nm[0].toLowerCase()] = value() } }
      continue
    }

    ws()
    const km = /^[^,\s})]*/.exec(text.slice(i, i + 300))
    const rawKey = km ? km[0] : ''
    i += rawKey.length
    const fields: Record<string, string> = {}
    for (;;) {
      ws()
      if (text[i] === ',') { i++; continue }
      if (i >= n || text[i] === '}' || text[i] === ')') { i++; break }
      const fm = /^[^\s=,})]+/.exec(text.slice(i, i + 100))
      if (!fm) { i++; continue }
      i += fm[0].length
      ws()
      if (text[i] !== '=') continue
      i++
      const name = fm[0].toLowerCase()
      const v = value()
      if (FIELD_RE.test(name) && v && Object.keys(fields).length < 60) fields[name] = v.slice(0, 20_000)
    }
    const key = cleanKey(rawKey)
    if (key && TYPE_RE.test(type) && Object.keys(fields).length > 0) entries.push({ type, key, fields })
    else skipped++
  }
  return { entries, skipped }
}

/** Drop braces that do not pair up, so one bad value cannot corrupt the whole file. */
function balance(v: string): string {
  let depth = 0
  let out = ''
  for (let i = 0; i < v.length; i++) {
    const c = v[i]
    if (c === '\\' && i + 1 < v.length) { out += c + v[++i]; continue }
    if (c === '{') depth++
    else if (c === '}') { if (depth === 0) continue; depth-- }
    out += c
  }
  return out + '}'.repeat(depth)
}

export function formatBibtex(entries: BibEntry[]): string {
  return entries.map(e => {
    const lines = Object.entries(e.fields).map(([name, v]) => `  ${name} = {${balance(v)}},`)
    return `@${e.type}{${e.key},\n${lines.join('\n')}\n}`
  }).join('\n\n') + (entries.length ? '\n' : '')
}
