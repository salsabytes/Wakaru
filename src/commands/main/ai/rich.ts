import type { RichPart } from '../../../lib/richmsg.ts'

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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // fenced code block -> native code card; an unterminated fence is closed at EOF
    const fence = /^\s*```\s*([A-Za-z0-9+#._-]*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      let j = i + 1
      while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) body.push(lines[j++])
      const code = body.join('\n').replace(/^\n+|\n+$/g, '')
      if (code.trim()) {
        flush()
        parts.push({ type: 'code', code, ...(fence[1] ? { language: fence[1] } : {}) })
      }
      i = j
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
      return [p.title ?? '', ...p.rows.map((r) => r.join(' · '))].filter(Boolean).join('\n')
    })
    .join('\n\n')

/** Anything beyond plain text needs the rich relay. */
export const hasRich = (parts: RichPart[]): boolean => parts.some((p) => p.type !== 'text')

if (process.env.AI_SELFTEST) {
  const eq = (label: string, got: unknown, want: unknown) => {
    const a = JSON.stringify(got)
    const b = JSON.stringify(want)
    if (a !== b) throw new Error(`${label}: got ${a}, want ${b}`)
  }
  const md = parseRich('INI HASILNYA\n| Nama | Umur |\n|---|:--:|\n| **Budi** | 20 |\n| Ani | 21 |\nselesai')
  eq('markdown table parts', md.length, 3)
  eq('markdown table title', 'title' in md[1] ? md[1].title : null, null)
  eq('markdown table rows', md[1].type === 'table' ? md[1].rows : [], [
    ['Nama', 'Umur'],
    ['*Budi*', '20'],
    ['Ani', '21'],
  ])
  eq('text around table', md[0].type === 'text' ? md[0].text : '', 'INI HASILNYA')
  eq('text after table', md[2].type === 'text' ? md[2].text : '', 'selesai')

  const titled = parseRich('@table Daftar Lagu\nLagu | Penyanyi\nDunia Yang Nanti | Raim Laode')
  eq('at-table title', titled[0].type === 'table' ? titled[0].title : '', 'Daftar Lagu')
  eq('pipeless rows', titled[0].type === 'table' ? titled[0].rows : [], [
    ['Lagu', 'Penyanyi'],
    ['Dunia Yang Nanti', 'Raim Laode'],
  ])

  eq('no table stays text', parseRich('halo *kak* 👍'), [{ type: 'text', text: 'halo *kak* 👍' }])
  eq('header only is text', parseRich('| cuma | header |'), [{ type: 'text', text: '| cuma | header |' }])
  eq('width capped', parseRich('| a | b | c | d | e | f | g |\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 |')[0], {
    type: 'table',
    rows: [
      ['a', 'b', 'c', 'd', 'e', 'f'],
      ['1', '2', '3', '4', '5', '6'],
    ],
  })
  eq('richToText', richToText(parseRich('@table T\n| A | B |\n| 1 | 2 |')), 'T\nA · B\n1 · 2')

  const code = parseRich('niii ini contohnya\n```python\ndef f(x):\n    return x ** 2  # kuadrat\n```\nsemoga kebaca')
  eq('code parts', code.length, 3)
  eq('code language', code[1].type === 'code' ? code[1].language : '', 'python')
  eq('code body untouched', code[1].type === 'code' ? code[1].code : '', 'def f(x):\n    return x ** 2  # kuadrat')
  eq('text before code', code[0].type === 'text' ? code[0].text : '', 'niii ini contohnya')
  eq('text after code', code[2].type === 'text' ? code[2].text : '', 'semoga kebaca')
  eq('unterminated fence', parseRich('```js\nconst a = 1')[0], { type: 'code', code: 'const a = 1', language: 'js' })
  eq('empty fence dropped', parseRich('```\n```'), [])

  const four = parseRich(Array.from({ length: 4 }, (_, k) => `@table T${k}\n| a | b |\n| 1 | 2 |`).join('\n'))
  eq('max 3 tables', four.filter((p) => p.type === 'table').length, 3)
  eq('4th table stays text', four.at(-1)?.type === 'text' ? true : false, true)
  console.log('ai rich self-check ok')
}
