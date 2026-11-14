import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'wakaru-memory-'))
process.env.WAKARU_DATA_DIR = dir
const mem = await import('../src/lib/aiMemory.ts')
const disk = await import('../src/lib/disk.ts')

after(async () => {
  disk.flushAll()
  await disk.whenIdle()
  await rm(dir, { recursive: true, force: true })
  delete process.env.WAKARU_DATA_DIR
})

test('facts are deduped and capped', () => {
  mem.addFacts('chat:one', ['suka kopi', 'Suka Kopi', 'tinggal di Bandung'])
  assert.deepEqual(mem.getMemory('chat:one').facts, ['suka kopi', 'tinggal di Bandung'])
  for (let i = 0; i < 15; i++) mem.addFacts('chat:one', [`fact ${i}`])
  assert.equal(mem.getMemory('chat:one').facts.length, 10)
})

test('summary is trimmed to the budget', () => {
  mem.setSummary('chat:two', 'x'.repeat(1_000))
  assert.equal(mem.getMemory('chat:two').summary.length, 600)
})

test('oldest keys are pruned beyond the cap', () => {
  for (let i = 0; i < mem.MEMORY_MAX_KEYS + 1; i++) mem.addFacts(`k${i}`, [`v${i}`])
  assert.equal(mem.getMemory('k0').facts.length, 0)
  assert.deepEqual(mem.getMemory(`k${mem.MEMORY_MAX_KEYS}`).facts, [`v${mem.MEMORY_MAX_KEYS}`])
})

test('clear removes one key only', () => {
  mem.addFacts('chat:keep', ['keep'])
  mem.addFacts('chat:drop', ['drop'])
  mem.clearMemory('chat:drop')
  assert.deepEqual(mem.getMemory('chat:keep').facts, ['keep'])
  assert.deepEqual(mem.getMemory('chat:drop').facts, [])
})
