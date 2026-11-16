import type * as Monaco from 'monaco-editor'

export interface TokenDef {
  id: string
  label: string
  description: string
  token: string       // monarch token name (postfix .typst added automatically)
  defaultColor: string
  fontStyle: string   // fixed — not user-configurable to keep things simple
}

export const TOKEN_DEFS: TokenDef[] = [
  {
    id: 'heading',
    label: 'Heading',
    description: '= Title, == Section…',
    token: 'heading',
    defaultColor: '#1d4ed8',
    fontStyle: 'bold'
  },
  {
    id: 'keyword',
    label: 'Keyword',
    description: '#set, #let, #show, #if…',
    token: 'keyword',
    defaultColor: '#7c3aed',
    fontStyle: 'bold'
  },
  {
    id: 'function',
    label: 'Function',
    description: '#name, #rect, #align…',
    token: 'function',
    defaultColor: '#0369a1',
    fontStyle: ''
  },
  {
    id: 'bold',
    label: 'Bold text',
    description: '*bold*',
    token: 'bold',
    defaultColor: '#111827',
    fontStyle: 'bold'
  },
  {
    id: 'italic',
    label: 'Italic text',
    description: '_italic_',
    token: 'italic',
    defaultColor: '#374151',
    fontStyle: 'italic'
  },
  {
    id: 'string',
    label: 'String',
    description: '"text"',
    token: 'string',
    defaultColor: '#059669',
    fontStyle: ''
  },
  {
    id: 'number',
    label: 'Number / Unit',
    description: '12pt, 50%, 1.5em…',
    token: 'number',
    defaultColor: '#b45309',
    fontStyle: ''
  },
  {
    id: 'comment',
    label: 'Comment',
    description: '// line  /* block */',
    token: 'comment',
    defaultColor: '#9ca3af',
    fontStyle: 'italic'
  },
  {
    id: 'math',
    label: 'Math',
    description: '$x^2 + y^2$',
    token: 'math',
    defaultColor: '#c2410c',
    fontStyle: ''
  },
  {
    id: 'raw',
    label: 'Raw / Code',
    description: '`inline`  ```block```',
    token: 'raw',
    defaultColor: '#0f766e',
    fontStyle: ''
  },
  {
    id: 'label',
    label: 'Label',
    description: '<fig:one>',
    token: 'label',
    defaultColor: '#7e22ce',
    fontStyle: ''
  },
  {
    id: 'reference',
    label: 'Reference',
    description: '@fig:one',
    token: 'reference',
    defaultColor: '#be185d',
    fontStyle: ''
  },
  {
    id: 'list',
    label: 'List marker',
    description: '-, +, 1.',
    token: 'list',
    defaultColor: '#2563eb',
    fontStyle: 'bold'
  },
  {
    id: 'escape',
    label: 'Escape',
    description: '\\* \\_ \\#…',
    token: 'escape',
    defaultColor: '#6b7280',
    fontStyle: ''
  },
  {
    id: 'rule',
    label: 'Horizontal rule',
    description: '---',
    token: 'rule',
    defaultColor: '#d1d5db',
    fontStyle: ''
  }
]

export type TokenColors = Record<string, string>  // id → hex color

export const DEFAULT_TOKEN_COLORS: TokenColors = Object.fromEntries(
  TOKEN_DEFS.map(d => [d.id, d.defaultColor])
)

const EDITOR_UI_COLORS = {
  'editor.background': '#f5f8ff00',
  'editor.foreground': '#1a1d2e',
  'editorLineNumber.foreground': '#c4c9d6',
  'editorLineNumber.activeForeground': '#6b7280',
  'editor.lineHighlightBackground': '#0000000a',
  'editor.selectionBackground': '#2563eb26',
  'editor.inactiveSelectionBackground': '#2563eb14',
  'editorCursor.foreground': '#2563eb',
  'editorWhitespace.foreground': '#e5e7eb',
  'editorIndentGuide.background1': '#e5e7eb',
  'editorIndentGuide.activeBackground1': '#d1d5db',
  'scrollbarSlider.background': '#00000018',
  'scrollbarSlider.hoverBackground': '#00000030',
  'scrollbarSlider.activeBackground': '#00000040',
  'focusBorder': '#00000000',
}

const DARK_EDITOR_UI_COLORS = {
  'editor.background': '#181c2500',
  'editor.foreground': '#e6e9f0',
  'editorLineNumber.foreground': '#4a5365',
  'editorLineNumber.activeForeground': '#a3acbd',
  'editor.lineHighlightBackground': '#ffffff0a',
  'editor.selectionBackground': '#6b9bff40',
  'editor.inactiveSelectionBackground': '#6b9bff22',
  'editorCursor.foreground': '#6b9bff',
  'editorWhitespace.foreground': '#2a303d',
  'editorIndentGuide.background1': '#2a303d',
  'editorIndentGuide.activeBackground1': '#3a4252',
  'scrollbarSlider.background': '#ffffff18',
  'scrollbarSlider.hoverBackground': '#ffffff30',
  'scrollbarSlider.activeBackground': '#ffffff40',
  'focusBorder': '#00000000',
}

/** Blend a colour toward white so syntax colours chosen for a light background stay readable on a dark one. */
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0')
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`
}

export function buildMonacoTheme(
  colors: TokenColors,
  dark = false
): Monaco.editor.IStandaloneThemeData {
  const rules: Monaco.editor.ITokenThemeRule[] = TOKEN_DEFS.map(def => {
    const color = colors[def.id] ?? def.defaultColor
    return {
      token: `${def.token}.typst`,
      foreground: (dark ? lighten(color, 0.5) : color).replace('#', ''),
      fontStyle: def.fontStyle
    }
  })

  return {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules,
    colors: dark ? DARK_EDITOR_UI_COLORS : EDITOR_UI_COLORS
  }
}
