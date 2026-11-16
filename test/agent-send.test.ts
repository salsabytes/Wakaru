import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { prepareSend, sendRepoPath, zipFiles } from '../src/lib/agentSend.ts'

const repo = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'wakaru-send-'))
  await mkdir(join(dir, 'src', 'lib'), { recursive: true })
  await writeFile(join(dir, 'src', 'a.ts'), 'export const a = 1\n')
  await writeFile(join(dir, 'src', 'lib', 'b.ts'), 'export const b = ' + '2'.repeat(500) + '\n')
  await writeFile(join(dir, 'src', '.secret'), 'hidden\n')
  await writeFile(join(dir, 'config.json'), '{"token":"nope"}\n')
  return dir
}

// Pull the first entry out of a zip: local header + deflate body.
const firstEntry = (zip: Buffer): string => {
  assert.equal(zip.readUInt32LE(0), 0x04034b50)
  const method = zip.readUInt16LE(8)
  const size = zip.readUInt32LE(18)
  const nameLen = zip.readUInt16LE(26)
  const name = zip.subarray(30, 30 + nameLen).toString('utf8')
  const body = zip.subarray(30 + nameLen, 30 + nameLen + size)
  const text = method === 0 ? body.toString('utf8') : inflateRawSync(body).toString('utf8')
  return `${name}\n${text}`
}

test('zipFiles writes a readable archive', () => {
  const zip = zipFiles([{ name: 'src/a.ts', data: Buffer.from('hello') }])
  assert.equal(firstEntry(zip), 'src/a.ts\nhello')
  // end of central directory: one entry
  const eocd = zip.length - 22
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50)
  assert.equal(zip.readUInt16LE(eocd + 10), 1)
})

test('a file is sent as itself, folder as a zip without secrets', async () => {
  const root = await repo()
  try {
    const one = await prepareSend(root, 'src/a.ts')
    assert.equal(one.fileName, 'a.ts')
    assert.equal(one.data.toString('utf8'), 'export const a = 1\n')
    assert.equal(one.mime, 'text/plain')

    const folder = await prepareSend(root, 'src')
    assert.equal(folder.fileName, 'src.zip')
    assert.equal(folder.mime, 'application/zip')
    const raw = folder.data.toString('latin1')
    assert.ok(raw.includes('src/a.ts'), 'top-level file keeps the folder name')
    assert.ok(raw.includes('src/lib/b.ts'), 'nested file is included')
    assert.ok(!raw.includes('.secret'), 'dotfiles stay out')
    assert.ok(!raw.includes('token'), 'config.json is not included')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('blocked paths never reach the chat', async () => {
  const root = await repo()
  try {
    await assert.rejects(() => prepareSend(root, 'config.json'), /blocked path/)
    await assert.rejects(() => prepareSend(root, '../outside.txt'), /escapes the repo/)
    await assert.rejects(() => prepareSend(root, ''), /needs a path/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('sendRepoPath posts a document and reports it', async () => {
  const root = await repo()
  const sent: Array<{ name: string; bytes: number }> = []
  const ctx = {
    sendDocument: async (data: Buffer, fileName: string) => {
      sent.push({ name: fileName, bytes: data.length })
    },
  } as unknown as CommandContext
  try {
    const ok = await sendRepoPath(ctx, root, 'src/a.ts')
    assert.match(ok, /^\[send\] sent a\.ts/)
    assert.equal(sent[0].name, 'a.ts')

    const bad = await sendRepoPath(ctx, root, 'nope.ts')
    assert.match(bad, /^\[send\] error: not found/)
    assert.equal(sent.length, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
