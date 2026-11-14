import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'wakaru-scrape-cache-'))
process.env.WAKARU_DATA_DIR = dir
const cache = await import('../src/lib/scrapers/cache.ts')
const disk = await import('../src/lib/disk.ts')

after(async () => {
  disk.flushAll()
  await disk.whenIdle()
  await rm(dir, { recursive: true, force: true })
  delete process.env.WAKARU_DATA_DIR
})

test('cached downloads are stored and cleared', async () => {
  cache.setCachedDownload('https://example.com/a', { directUrl: 'https://cdn/a', title: 'A' })
  assert.equal(cache.getCachedDownload('https://example.com/a')?.title, 'A')

  cache.clearDownloadCache()
  await disk.whenIdle()
  assert.equal(cache.getCachedDownload('https://example.com/a'), undefined)
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'dl-cache.json'), 'utf8')), {})
})

test('the cache is capped at the oldest entries', () => {
  for (let i = 0; i < 501; i++) cache.setCachedDownload(`https://example.com/${i}`, { title: `${i}` })
  assert.equal(cache.getCachedDownload('https://example.com/0'), undefined)
  assert.equal(cache.getCachedDownload('https://example.com/500')?.title, '500')
})
