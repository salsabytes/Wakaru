import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'wakaru-disk-'))
process.env.WAKARU_DATA_DIR = dir
const disk = await import('../src/lib/disk.ts')

after(async () => {
  disk.flushAll()
  await disk.whenIdle()
  await rm(dir, { recursive: true, force: true })
  delete process.env.WAKARU_DATA_DIR
})

test('saveJsonNow writes immediately', async () => {
  disk.register('now.json', () => ({ a: 1 }))
  await disk.saveJsonNow('now.json')
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'now.json'), 'utf8')), { a: 1 })
})

test('flushAll writes the latest throttled snapshot', async () => {
  let value = { b: 1 }
  disk.register('throttle.json', () => value)
  disk.saveJson('throttle.json', 60_000)
  value = { b: 2 }
  disk.flushAll()
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'throttle.json'), 'utf8')), { b: 2 })
})
