import { htmlToText, type RichPart } from '../../../lib/richmsg.ts'

/**
 * Parse AI replies into "rich parts" (plain text, tables, code blocks).
 *
 * Why: WhatsApp can render native tables/code cards, but only if we send the
 *   right message format. The AI just writes text, so we detect patterns here.
 *
 * What we detect:
 * - Markdown tables:  | A | B |  (with optional --- separator row)
 * - @table blocks:    @table Title  + lines like "A | B"
 * - Fenced code:      ```python ... ```  (kept exactly as-is, no formatting)
 *
 * Safety: big tables are trimmed (WhatsApp cells are small). Code is never
 *   "fixed up" — we pass it through byte-for-byte.
 */

const MAX_COLS = 6
const MAX_ROWS = 30
const MAX_TABLES = 3
// Code is never truncated. Long code is split into several code parts because a
// single huge card (multiple code primitives / big payload) fails to render on
// WhatsApp — sendRichParts then delivers each code part as its own message.
const CODE_PART_MAX = 3500

// Every HTML reply is rendered as a live preview card, not source code.
const HTML_PREVIEW_LANGS = new Set(['html', 'html5', 'htm', 'html-preview', 'preview'])

/** WhatsApp renders *bold* with ONE star and shows [text](url) raw. */
export const waText = (s: string): string =>
  s.replace(/\[(.+?)\]\((https?:[^)\s]+)\)/g, '$1 $2').replace(/\*\*(.+?)\*\*/g, '*$1*')

const cell = (s: string): string => waText(s.trim()).replace(/\s*\n\s*/g, ' ').slice(0, 120)

const splitRow = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell)
    .slice(0, MAX_COLS)

// a table row: leading pipes, or "a | b" (the model sometimes drops the edges)
const isRow = (line: string): boolean => /^\s*\|.*\|/.test(line) || /\S\s*\|\s*\S/.test(line)

// |---|:--:|---| alignment row inside a Markdown table
const isSep = (line: string): boolean => /^[\s|:-]+$/.test(line) && line.includes('-') && line.includes('|')

// Split long code at line boundaries (hard split only if a single line is too long)
const splitCode = (code: string, max = CODE_PART_MAX): string[] => {
  if (code.length <= max) return [code]
  const out: string[] = []
  let rest = code
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max)
    if (cut < max * 0.4) cut = max
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
    if (!rest) break
  }
  if (rest) out.push(rest)
  return out
}

export const parseRich = (text: string): RichPart[] => {
  const lines = String(text ?? '').split(/\r?\n/)
  const parts: RichPart[] = []
  let buf: string[] = []
  let tables = 0

  const flush = () => {
    const t = waText(buf.join('\n')).trim()
    if (t) parts.push({ type: 'text', text: t })
    buf = []
  }

  const pushCode = (code: string, language?: string) => {
    flush()
    const chunks = splitCode(code)
    for (let k = 0; k < chunks.length; k++) {
      // tell the user the code is continued, so nobody thinks it's cut off
      if (chunks.length > 1) parts.push({ type: 'text', text: `📄 kode ${k + 1}/${chunks.length}` })
      parts.push({ type: 'code', code: chunks[k], ...(language ? { language } : {}) })
    }
  }

  // any HTML the model sends becomes a live preview card (Android only) PLUS
  // the source code right after it, so everyone can still copy the code
  const pushPreview = (html: string) => {
    flush()
    parts.push({ type: 'text', text: '📱 preview HTML cuma tampil di Android — kode sumbernya di bawah 👇' })
    parts.push({ type: 'html', html })
    pushCode(html, 'html')
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // fenced code block -> native code card; an unterminated fence is closed at EOF.
    // 3+ backticks so ````html (nested fences) is still recognised.
    const fence = /^\s*`{3,}\s*([A-Za-z0-9+#._-]*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && !/^\s*`{3,}\s*$/.test(lines[j])) body.push(lines[j++])
      const code = body.join('\n').replace(/^\n+|\n+$/g, '')
      if (code.trim()) {
        const lang = (fence[1] || '').toLowerCase()
        if (HTML_PREVIEW_LANGS.has(lang)) pushPreview(code)
        else pushCode(code, fence[1] || undefined)
      }
      i = j
      continue
    }

    // models sometimes forget the fence on long HTML — detect the document itself
    if (/^\s*<!doctype\s+html/i.test(line) || /^\s*<html[\s>]/i.test(line)) {
      const body: string[] = []
      let j = i
      while (j < lines.length) {
        body.push(lines[j])
        if (/<\/html>\s*$/i.test(lines[j])) { j++; break }
        j++
      }
      const code = body.join('\n').replace(/^\n+|\n+$/g, '')
      if (code.trim()) pushPreview(code)
      i = j - 1
      continue
    }

    const head = /^\s*@table\b\s*(.*)$/i.exec(line)
    if (!head && !isRow(line)) {
      buf.push(line)
      continue
    }

    const raw = head ? [] : [line]
    const title = head ? cell(head[1]) : ''
    let j = i + 1
    while (j < lines.length && isRow(lines[j])) raw.push(lines[j++])

    const rows = raw.filter((l) => !isSep(l)).map(splitRow).filter((r) => r.some(Boolean))
    if (rows.length >= 2 && tables < MAX_TABLES) {
      flush()
      tables++
      parts.push({ type: 'table', rows: rows.slice(0, MAX_ROWS), ...(title ? { title } : {}) })
    } else {
      // not a usable table (needs a header + at least one body row): keep it as text
      buf.push(line, ...raw.slice(1))
    }
    i = j - 1
  }
  flush()
  return parts
}

/** Plain-text mirror, used when the rich relay fails. */
export const richToText = (parts: RichPart[]): string =>
  parts
    .map((p) => {
      if (p.type === 'text') return p.text
      if (p.type === 'code') return '```' + (p.language ?? '') + '\n' + p.code + '\n```'
      if (p.type === 'html') return htmlToText(p.html)
      return [p.title ?? '', ...p.rows.map((r) => r.join(' · '))].filter(Boolean).join('\n')
    })
    .join('\n\n')

/** Anything beyond plain text needs the rich relay. */
export const hasRich = (parts: RichPart[]): boolean => parts.some((p) => p.type !== 'text')
