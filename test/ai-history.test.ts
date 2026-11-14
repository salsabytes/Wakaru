import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
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
