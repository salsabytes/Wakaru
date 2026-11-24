import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fitFiles, type AiFileInput } from '../../../src/lib/ai/llm.ts'

// The ext endpoint hard-rejects bodies over 256 KiB, and base64 costs 4/3 the
// raw bytes, so a plain phone photo used to be dropped without reaching the model.
const SIDECAR = join(import.meta.dirname, '..', '..', '..', 'bin', process.platform === 'win32' ? 'sticker.exe' : 'sticker')

// Minimal valid JPEG: 1x1 white pixel from a base64 constant, padded with a
// COM segment so the test controls the byte size without shipping fixtures.
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
)

const sized = (bytes: number): AiFileInput => ({
  data: TINY_JPEG.toString('base64'),
  mime: 'image/jpeg',
  name: 'photo.jpg',
})

test('a file already inside the budget is passed through untouched', async () => {
  const f = sized(TINY_JPEG.length)
  const out = await fitFiles([f], 200_000)
  assert.equal(out.files.length, 1)
  assert.equal(out.dropped, 0)
  assert.equal(out.files[0], f)
})

test('a non-image over budget is dropped, not silently kept', async () => {
  const big = { data: 'A'.repeat(400_000), mime: 'application/pdf', name: 'doc.pdf' }
  const out = await fitFiles([big], 100_000)
  assert.equal(out.dropped, 1)
  assert.equal(out.files.length, 0)
})

test('an oversized image is shrunk to fit instead of being dropped', async (t) => {
  if (!existsSync(SIDECAR)) {
    t.skip('sticker sidecar not built')
    return
  }
  // 600 KB of JPEG-ish payload: way over a 150 KB body share
  const padded = Buffer.concat([TINY_JPEG, Buffer.alloc(600_000, 0x41)])
  const f: AiFileInput = { data: padded.toString('base64'), mime: 'image/jpeg', name: 'huge.jpg' }
  const out = await fitFiles([f], 150_000)
  assert.equal(out.dropped, 0, 'a decodable image must not be dropped')
  assert.equal(out.files.length, 1)
  assert.equal(out.files[0].mime, 'image/jpeg')
  assert.ok(Buffer.byteLength(out.files[0].data) <= 150_000, 'shrunk image must fit the budget')
})
