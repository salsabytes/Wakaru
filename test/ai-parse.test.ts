import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRuns } from '../src/commands/main/ai/tools.ts'
import { parseRich, richToText } from '../src/commands/main/ai/rich.ts'
import { batchRichParts, buildRichParts, tokenizeCode, type RichPart } from '../src/lib/richmsg.ts'

test('parseRuns extracts @run markers', () => {
  const cases: [string, number][] = [
    ['@run:sticker', 1],
    ['@run:kick 628123@x\n@run:promote 628123@x', 2],
    ['just chatting, no markers', 0],
    ['do it: @run:join https://chat.whatsapp.com/ABC and tell me', 1],
    ['@run:ai hello', 1],
  ]
  for (const [text, want] of cases) assert.equal(parseRuns(text).length, want, text)
  assert.deepEqual(parseRuns('@run:kick 628@x'), [{ name: 'kick', args: '628@x' }])
})

test('parseRich turns markdown tables into table parts', () => {
  const md = parseRich('INI HASILNYA\n| Nama | Umur |\n|---|:--:|\n| **Budi** | 20 |\n| Ani | 21 |\nselesai')
  assert.equal(md.length, 3)
  assert.ok(md[1].type === 'table')
  assert.deepEqual(md[1].rows, [
    ['Nama', 'Umur'],
    ['*Budi*', '20'],
    ['Ani', '21'],
  ])
  assert.ok(md[0].type === 'text')
  assert.equal(md[0].text, 'INI HASILNYA')
  assert.ok(md[2].type === 'text')
  assert.equal(md[2].text, 'selesai')
})

test('parseRich supports @table titles and pipeless rows', () => {
  const titled = parseRich('@table Daftar Lagu\nLagu | Penyanyi\nDunia Yang Nanti | Raim Laode')
  assert.ok(titled[0].type === 'table')
  assert.equal(titled[0].title, 'Daftar Lagu')
  assert.deepEqual(titled[0].rows, [
    ['Lagu', 'Penyanyi'],
    ['Dunia Yang Nanti', 'Raim Laode'],
  ])
})

test('parseRich keeps non-tables as text', () => {
  assert.deepEqual(parseRich('halo *kak* 👍'), [{ type: 'text', text: 'halo *kak* 👍' }])
  assert.deepEqual(parseRich('| cuma | header |'), [{ type: 'text', text: '| cuma | header |' }])
})

test('parseRich caps table columns', () => {
  const part = parseRich('| a | b | c | d | e | f | g |\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 |')[0]
  assert.deepEqual(part, {
    type: 'table',
    rows: [
      ['a', 'b', 'c', 'd', 'e', 'f'],
      ['1', '2', '3', '4', '5', '6'],
    ],
  })
})

test('richToText mirrors tables and code', () => {
  assert.equal(richToText(parseRich('@table T\n| A | B |\n| 1 | 2 |')), 'T\nA · B\n1 · 2')
})

test('parseRich turns fenced code into a code part', () => {
  const code = parseRich('niii ini contohnya\n```python\ndef f(x):\n    return x ** 2  # kuadrat\n```\nsemoga kebaca')
  assert.equal(code.length, 3)
  assert.ok(code[1].type === 'code')
  assert.equal(code[1].language, 'python')
  assert.equal(code[1].code, 'def f(x):\n    return x ** 2  # kuadrat')
  assert.ok(code[0].type === 'text')
  assert.equal(code[0].text, 'niii ini contohnya')
  assert.ok(code[2].type === 'text')
  assert.equal(code[2].text, 'semoga kebaca')
  assert.deepEqual(parseRich('```js\nconst a = 1')[0], { type: 'code', code: 'const a = 1', language: 'js' })
  assert.deepEqual(parseRich('```\n```'), [])
})

test('parseRich keeps at most three tables', () => {
  const four = parseRich(Array.from({ length: 4 }, (_, k) => `@table T${k}\n| a | b |\n| 1 | 2 |`).join('\n'))
  assert.equal(four.filter((p) => p.type === 'table').length, 3)
  assert.ok(four.at(-1)?.type === 'text')
})

test('tokenizeCode handles @ (css at-rules) without hanging', () => {
  const css = '@media (max-width:600px){body{color:red}}\n@keyframes love{0%{opacity:1}}'
  const { tokens } = tokenizeCode(css, 'html')
  assert.ok(tokens.length > 0)
  assert.equal(tokens.map((t) => t.codeContent).join(''), css)
})

test('parseRich keeps short code in one part', () => {
  const code = 'const a = 1\nconst b = 2'
  const parts = parseRich('```js\n' + code + '\n```')
  const codes = parts.filter((p) => p.type === 'code')
  assert.equal(codes.length, 1)
  assert.equal(codes[0].type === 'code' ? codes[0].code : '', code)
})

test('parseRich splits long code without losing a character', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `const line${i} = ${i};`)
  const code = lines.join('\n')
  const parts = parseRich('```js\n' + code + '\n```')
  const codes = parts.filter((p) => p.type === 'code')
  assert.ok(codes.length > 1)
  assert.equal(codes.map((p) => (p.type === 'code' ? p.code : '')).join('\n'), code)
  for (const p of codes) assert.ok(p.type === 'code' && p.code.length <= 3500)
})

test('batchRichParts puts at most one code card per message', () => {
  const code = (n: number): RichPart => ({ type: 'code', code: 'x'.repeat(3400), language: `l${n}` })
  const parts: RichPart[] = [
    { type: 'text', text: 'intro' },
    code(1),
    code(2),
    code(3),
    { type: 'text', text: 'outro' },
  ]
  const batches = batchRichParts(parts)
  assert.deepEqual(batches.map((b) => b.length), [2, 1, 2])
  assert.equal(batches.flat().length, parts.length)
  for (const b of batches) assert.ok(b.filter((p) => p.type === 'code').length <= 1)
  // trailing text rides along with the last code card instead of its own message
  assert.equal(batches.at(-1)?.at(-1)?.type, 'text')
})

test('batchRichParts keeps a code label with its own card', () => {
  const card = (code: string): RichPart => ({ type: 'code', code, language: 'js' })
  const parts: RichPart[] = [
    { type: 'text', text: 'intro' },
    { type: 'text', text: '📄 kode 1/2' },
    card('a'),
    { type: 'text', text: '📄 kode 2/2' },
    card('b'),
    { type: 'text', text: 'cara main: tap' },
  ]
  const batches = batchRichParts(parts)
  assert.deepEqual(batches.map((b) => b.length), [3, 3])
  assert.deepEqual(batches[1].map((p) => p.type), ['text', 'code', 'text'])
  assert.equal(batches[1][0].type === 'text' ? batches[1][0].text : '', '📄 kode 2/2')
})

test('split code is labelled so the user knows it continues', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `const line${i} = ${i};`)
  const parts = parseRich('```js\n' + lines.join('\n') + '\n```')
  const codes = parts.filter((p) => p.type === 'code').length
  const labels = parts.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p.text : ''))
  assert.ok(codes > 1)
  assert.deepEqual(
    labels,
    Array.from({ length: codes }, (_, k) => `📄 kode ${k + 1}/${codes}`),
  )
})

test('parseRich turns unfenced HTML into a preview card', () => {
  const html = '<!DOCTYPE html>\n<html><body><h1>hai</h1></body></html>\nini penjelasannya'
  const parts = parseRich(html)
  const card = parts.find((p) => p.type === 'html')
  assert.ok(card)
  assert.match(card.type === 'html' ? card.html : '', /^<!DOCTYPE html>/)
  assert.equal(parts.at(-1)?.type, 'text')
})

test('parseRich turns a plain html fence into preview + source code', () => {
  const parts = parseRich('```html\n<div>ok</div>\n```')
  const card = parts.find((p) => p.type === 'html')
  const code = parts.find((p) => p.type === 'code')
  assert.equal(card?.type === 'html' ? card.html : '', '<div>ok</div>')
  assert.equal(code?.type === 'code' ? code.code : '', '<div>ok</div>')
  assert.equal(code?.type === 'code' ? code.language : '', 'html')
})

test('parseRich accepts 4-backtick fences', () => {
  const parts = parseRich('````html\n<div>ok</div>\n````')
  const card = parts.find((p) => p.type === 'html')
  assert.equal(card?.type === 'html' ? card.html : '', '<div>ok</div>')
})

test('parseRich turns an html-preview fence into an Android preview card', () => {
  const html = '<!DOCTYPE html>\n<html><body><h1>hai</h1></body></html>'
  const parts = parseRich('nih preview-nya\n```html-preview\n' + html + '\n```\nsemoga suka')
  const card = parts.find((p) => p.type === 'html')
  assert.ok(card)
  assert.equal(card.type === 'html' ? card.html : '', html)
  const texts = parts.filter((p) => p.type === 'text').map((p) => (p.type === 'text' ? p.text : ''))
  assert.ok(texts.some((t) => t.includes('Android')))
  assert.equal(richToText(parts).includes('hai'), true)
})

test('buildRichParts renders html as a section and mirrors its text', () => {
  const inner = buildRichParts([{ type: 'html', html: '<p>halo dunia</p>' }])
  const sections = JSON.parse(
    Buffer.from(inner.botForwardedMessage.message.richResponseMessage.unifiedResponse.data, 'base64').toString(),
  )
  assert.equal(JSON.stringify(sections).includes('GenAIaeacdsnwHtmlPrimitive'), true)
  const subs = inner.botForwardedMessage.message.richResponseMessage.submessages
  assert.equal(subs.some((s) => (s.messageText ?? '').includes('halo dunia')), true)
})

test('batchRichParts keeps one preview card per message with its note', () => {
  const parts: RichPart[] = [
    { type: 'text', text: '📱 preview HTML cuma tampil di Android' },
    { type: 'html', html: '<p>a</p>' },
    { type: 'text', text: '📱 preview HTML cuma tampil di Android' },
    { type: 'html', html: '<p>b</p>' },
  ]
  const batches = batchRichParts(parts)
  assert.deepEqual(batches.map((b) => b.length), [2, 2])
  for (const b of batches) {
    assert.equal(b[0].type, 'text')
    assert.equal(b[1].type, 'html')
  }
})
