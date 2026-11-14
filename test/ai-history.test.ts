import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'wakaru-history-'))
process.env.WAKARU_DATA_DIR = dir
const hist = await import('../src/lib/aiHistory.ts')
const disk = await import('../src/lib/disk.ts')

after(async () => {
  disk.flushAll()
  await disk.whenIdle()
  await rm(dir, { recursive: true, force: true })
  delete process.env.WAKARU_DATA_DIR
})

test('pending media is capped by the oldest key', () => {
  for (let i = 0; i < 501; i++) hist.addPendingAiFiles(`chat:${i}`, [{ data: 'eA==' }])
  assert.deepEqual(hist.getPendingAiFiles('chat:0'), [])
  assert.equal(hist.getPendingAiFiles('chat:500').length, 1)
})

test('pending media can be cleared', () => {
  hist.addPendingAiFiles('chat:clear', [{ data: 'eA==' }])
  hist.clearPendingAiFiles('chat:clear')
  assert.deepEqual(hist.getPendingAiFiles('chat:clear'), [])
})

test('persisted history drops media payloads', async () => {
  hist.saveAiHistory('persist:chat', 'lihat gambar', 'oke', [
    { data: 'aGVsbG8=', mime: 'image/png', name: 'foto.png' },
  ])
  assert.equal(hist.getAiHistory('persist:chat')[0].files?.[0]?.data, 'aGVsbG8=')

  await disk.saveJsonNow('ai-history.json')
  const raw = await readFile(join(dir, 'ai-history.json'), 'utf8')
  assert.equal(raw.includes('aGVsbG8='), false)

  const parsed = JSON.parse(raw)
  assert.deepEqual(parsed['persist:chat'][0][0], { role: 'user', content: 'lihat gambar' })
})

test('history media is capped by total bytes', () => {
  const big = 'x'.repeat(hist.FILE_MEMORY_MAX_BYTES / 2 + 1)
  hist.saveAiHistory('bytes:chat', 'satu', 'oke', [{ data: big }])
  hist.saveAiHistory('bytes:chat', 'dua', 'oke', [{ data: big }])

  const history = hist.getAiHistory('bytes:chat')
  const total = history.flatMap((m) => m.files ?? []).reduce((n, f) => n + f.data.length, 0)
  assert.ok(total <= hist.FILE_MEMORY_MAX_BYTES)
  assert.equal(history.at(-2)?.files?.[0]?.data, big)
})

test('history keeps 20 exchanges (40 messages)', () => {
  for (let i = 0; i < 25; i++) hist.saveAiHistory('long:chat', `tanya ${i}`, `jawab ${i}`)
  const h = hist.getAiHistory('long:chat')
  assert.equal(h.length, 40)
  assert.equal(h.at(-2)?.content, 'tanya 24')
})

test('old bulky code is compacted so the conversation survives', () => {
  const big = '```html\n' + 'x'.repeat(20000) + '\n```'
  hist.saveAiHistory('compact:chat', 'bikin game', big)
  for (let i = 0; i < 5; i++) hist.saveAiHistory('compact:chat', `lanjut ${i}`, 'oke')
  const h = hist.getAiHistory('compact:chat')
  assert.equal(h[1]?.content.includes('dipadatkan'), true)
  assert.ok(h.length > 10)
})
