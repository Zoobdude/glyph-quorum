import { spawn } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

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

/** Returns the assets directory for a given room (created on demand). */
export function getAssetsDir(docId: string): string {
  const dir = join(process.cwd(), 'data', 'assets', docId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Filenames (relative to the room's assets dir) of all .bib files uploaded to the room. */
export function listBibFilenames(docId: string): string[] {
  try {
    return readdirSync(getAssetsDir(docId)).filter(f => f.toLowerCase().endsWith('.bib'))
  } catch {
    return []
  }
}

/**
 * Rewrite citation shorthand into explicit Typst #cite() calls:
 *   [@key]  (bracketed, possibly multiple "; "-separated) -> parenthetical, e.g. "(Masson et al., 2021)"
 *   @key    (bare)                                        -> narrative, e.g. "Masson et al. (2021)"
 * Comment lines (// ...) are left untouched since Typst ignores them anyway.
 */
function preprocessCitations(body: string): string {
  return body
    .split('\n')
    .map(line => {
      if (/^\s*\/\//.test(line)) return line
      return line
        .replace(/\[(@[\w:-]+(?:\s*;\s*@[\w:-]+)*)\]/g, (_m, group: string) =>
          group.split(/\s*;\s*/).map(part => `#cite(<${part.slice(1)}>)`).join(' ')
        )
        .replace(/@([\w:-]+)/g, (_m, key: string) => `#cite(<${key}>, form: "prose")`)
    })
    .join('\n')
}

export type CompileResult =
  | { ok: true; pdfBase64: string }
  | { ok: false; error: string }

export async function compileTypst(content: string, docId: string, citationStyle: CitationStyle = 'author-date'): Promise<CompileResult> {
  // Compile inside the room's assets dir so relative image paths resolve.
  const root = getAssetsDir(docId)
  const inputPath  = join(root, '_compile.typ')
  const outputPath = join(root, '_compile.pdf')

  let cleanContent = preprocessCitations(content)
    // Drop any hand-written #bibliography(...) call — one is generated below,
    // governed by the room's citation style setting, and Typst rejects duplicates.
    .replace(/^\s*#bibliography\([^)]*\)\s*$/gm, '')

  if (cleanContent.includes('#cite(')) {
    const bibFiles = listBibFilenames(docId)
    if (bibFiles.length > 0) {
      const styleName = citationStyle === 'numbered' ? 'ieee' : 'apa'
      const pathsArg = bibFiles.length === 1
        ? `"${bibFiles[0]}"`
        : `(${bibFiles.map(f => `"${f}"`).join(', ')})`
      cleanContent += `\n#bibliography(${pathsArg}, style: "${styleName}")\n`
    }
  }

  writeFileSync(inputPath, cleanContent, 'utf8')

  return new Promise((resolve) => {
    const child = spawn(TYPST_BIN, [
      'compile', inputPath, outputPath,
      '--root', root,
      '--diagnostic-format', 'short',
    ])

    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    child.on('close', (code) => {
      try { unlinkSync(inputPath) } catch {}
      if (code === 0 && existsSync(outputPath)) {
        try {
          const pdfBase64 = readFileSync(outputPath).toString('base64')
          try { unlinkSync(outputPath) } catch {}
          resolve({ ok: true, pdfBase64 })
        } catch (e) {
          resolve({ ok: false, error: String(e) })
        }
      } else {
        try { if (existsSync(outputPath)) unlinkSync(outputPath) } catch {}
        resolve({ ok: false, error: stderr.trim() || `typst exited with code ${code}` })
      }
    })

    child.on('error', (err) => {
      try { if (existsSync(inputPath)) unlinkSync(inputPath) } catch {}
      resolve({ ok: false, error: `Failed to run typst: ${err.message}` })
    })
  })
}
