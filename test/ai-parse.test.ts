import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRuns } from '../src/commands/main/ai/tools.ts'
import { parseRich, richToText } from '../src/commands/main/ai/rich.ts'

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
