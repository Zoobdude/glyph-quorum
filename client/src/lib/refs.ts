import type { Reference } from './api'

/** Entry types offered in the form, with the fields usually filled in for each. */
export const ENTRY_TYPES: { id: string; label: string; fields: string[] }[] = [
  { id: 'article', label: 'Journal article', fields: ['title', 'author', 'journal', 'year', 'volume', 'number', 'pages', 'doi'] },
  { id: 'book', label: 'Book', fields: ['title', 'author', 'publisher', 'year', 'edition', 'address', 'isbn'] },
  { id: 'incollection', label: 'Book chapter', fields: ['title', 'author', 'booktitle', 'editor', 'publisher', 'year', 'pages'] },
  { id: 'inproceedings', label: 'Conference paper', fields: ['title', 'author', 'booktitle', 'year', 'pages', 'publisher', 'doi'] },
  { id: 'techreport', label: 'Report', fields: ['title', 'author', 'institution', 'year', 'number', 'url'] },
  { id: 'phdthesis', label: 'Thesis', fields: ['title', 'author', 'school', 'year', 'url'] },
  { id: 'online', label: 'Web page', fields: ['title', 'author', 'url', 'year', 'urldate', 'organization'] },
  { id: 'misc', label: 'Other', fields: ['title', 'author', 'howpublished', 'year', 'url', 'note'] },
]

export const FIELD_LABELS: Record<string, string> = {
  title: 'Title', author: 'Authors', journal: 'Journal', year: 'Year', volume: 'Volume', number: 'Issue / number', pages: 'Pages',
  doi: 'DOI', publisher: 'Publisher', edition: 'Edition', address: 'Place', isbn: 'ISBN', booktitle: 'Book / proceedings title',
  editor: 'Editors', institution: 'Institution', school: 'University', url: 'URL', urldate: 'Date accessed', organization: 'Organisation',
  howpublished: 'How published', note: 'Note',
}

export const typeLabel = (type: string) => ENTRY_TYPES.find(t => t.id === type)?.label ?? type
export const fieldsFor = (type: string) => (ENTRY_TYPES.find(t => t.id === type) ?? ENTRY_TYPES[ENTRY_TYPES.length - 1]).fields

/** BibTeX value → readable text: drop protective braces and the commonest TeX escapes. */
export const plain = (v: string | undefined): string =>
  (v ?? '').replace(/\\([&%$#_])/g, '$1').replace(/--/g, '–').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()

const year = (r: Pick<Reference, 'fields'>) => /\d{4}/.exec(r.fields.year ?? r.fields.date ?? '')?.[0] ?? ''

/** "Smith", "Smith & Doe", "Smith et al." from a BibTeX author list. */
export function authorsShort(r: Pick<Reference, 'fields'>): string {
  const names = plain(r.fields.author ?? r.fields.editor).split(/\s+and\s+/i).filter(Boolean)
    .map(n => (n.includes(',') ? n.split(',')[0] : n.split(' ').slice(-1)[0]).trim())
  if (names.length === 0) return ''
  return names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names[0]} et al.`
}

export const yearOf = year

/** Suggest a key like Smith2020 from the author and year. */
export function suggestKey(fields: Record<string, string>): string {
  const first = authorsShort({ fields }).split(/[ &]/)[0] ?? ''
  const base = first.normalize('NFKD').replace(/[^A-Za-z]/g, '')
  return base ? `${base}${year({ fields })}` : ''
}

export const matches = (r: Reference, q: string): boolean =>
  !q || `${r.key} ${plain(r.fields.title)} ${plain(r.fields.author)} ${r.fields.year ?? ''} ${plain(r.fields.journal ?? r.fields.booktitle)}`.toLowerCase().includes(q)
