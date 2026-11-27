// `.ss` two-step state machine: no socket needed, the build step just logs
// "socket not ready" and gives up, which is exactly what we want here.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startSoundSticker, handleSoundStickerInput, animMs } from '../../src/lib/soundStickerFlow.ts'
import type { WAMessage } from 'baileys'

// `bin/` is gitignored, so a clean CI checkout has no sidecars and `.ss` would
// early-return "not built" before a session even exists. The flow only checks
// they exist (the build gives up on the missing socket before exec), so empty
// stubs are enough — created only when absent, and only ours are cleaned up.
const BIN_DIR = fileURLToPath(new URL('../../bin/', import.meta.url))
const sidecar = (n: string) => `${BIN_DIR}${n}${process.platform === 'win32' ? '.exe' : ''}`
const stubbed: string[] = []

before(() => {
  for (const n of ['audio', 'sticker']) {
    const p = sidecar(n)
    if (existsSync(p)) continue
    mkdirSync(BIN_DIR, { recursive: true })
    writeFileSync(p, '')
    stubbed.push(p)
  }
})

after(() => {
  for (const p of stubbed) rmSync(p, { force: true })
})

const A = 'a@s.whatsapp.net'
const B = 'b@s.whatsapp.net'
const MSG = {} as WAMessage
const wait = () => new Promise((r) => setTimeout(r, 150))

const seen: string[] = []
const buttonIds: string[] = []

const ctx = (chat: string, mtype: string, mimetype?: string): CommandContext =>
  ({
    mtype,
    mimetype,
    chat,
    sender: A,
    download: async () => Buffer.from('visual'),
    reply: async (t: string) => { seen.push(t) },
    sendButtons: async (b: Array<{ id: string }>) => { buttonIds.push(b.map((x) => x.id).join(',')) },
  }) as unknown as CommandContext

const audio = (chat: string) =>
  ({ chat, mtype: 'audioMessage', mimetype: 'audio/ogg', text: '', download: async () => Buffer.from('audio') }) as never
const tap = (chat: string, id: string) =>
  ({ chat, mtype: 'interactiveResponseMessage', text: '', button: { id, text: id }, download: async () => Buffer.from('') }) as never
const text = (chat: string, t: string) =>
  ({ chat, mtype: 'extendedTextMessage', text: t, download: async () => Buffer.from('') }) as never

test('a photo starts the flow and only the command sender can finish it', async () => {
  seen.length = 0
  await startSoundSticker(ctx('t1', 'imageMessage', 'image/jpeg'))
  assert.match(seen.at(-1) ?? '', /audio/)

  assert.equal(await handleSoundStickerInput(MSG, audio('t1'), B), false)
  assert.equal(await handleSoundStickerInput(MSG, text('t1', 'halo'), A), false)
  assert.equal(await handleSoundStickerInput(MSG, audio('t1'), A), true)
  await wait()
  // the session is single-use
  assert.equal(await handleSoundStickerInput(MSG, audio('t1'), A), false)
})

test('a video offers both buttons and keeps the session for the audio branch', async () => {
  buttonIds.length = 0
  await startSoundSticker(ctx('t2', 'videoMessage', 'video/mp4'))
  assert.equal(buttonIds.at(-1), 'ss:video,ss:audio')

  // ss:audio re-arms the same session (the "send your own audio" prompt needs a
  // socket, so only the state change is observable here)
  assert.equal(await handleSoundStickerInput(MSG, tap('t2', 'ss:audio'), A), true)
  assert.equal(await handleSoundStickerInput(MSG, audio('t2'), A), true)
  await wait()
  assert.equal(await handleSoundStickerInput(MSG, audio('t2'), A), false)
})

test('ss:video builds from the video itself and a stale tap is still swallowed', async () => {
  await startSoundSticker(ctx('t3', 'videoMessage', 'video/mp4'))
  assert.equal(await handleSoundStickerInput(MSG, tap('t3', 'ss:video'), A), true)
  await wait()
  assert.equal(await handleSoundStickerInput(MSG, tap('t3', 'ss:video'), A), true)
  await wait()
})

test('a gif document behaves like a photo', async () => {
  seen.length = 0
  await startSoundSticker(ctx('t4', 'documentMessage', 'image/gif'))
  assert.match(seen.at(-1) ?? '', /audio/)
})

test('a second .ss restarts instead of stacking', async () => {
  await startSoundSticker(ctx('t5', 'imageMessage', 'image/jpeg'))
  await startSoundSticker(ctx('t5', 'imageMessage', 'image/jpeg'))
  assert.equal(await handleSoundStickerInput(MSG, audio('t5'), A), true)
  await wait()
})

test('a photo that quotes an audio is built in one shot', async () => {
  const c = ctx('t6', 'imageMessage', 'image/jpeg') as unknown as Record<string, unknown>
  c.quoted = { mtype: 'audioMessage', mimetype: 'audio/ogg', download: async () => Buffer.from('audio') }
  seen.length = 0
  await startSoundSticker(c as unknown as CommandContext)
  // one-shot: no "send the audio" prompt, straight to the (failed) build
  assert.doesNotMatch(seen.at(-1) ?? '', /kirim voice note/)
})

test('cancel drops the session', async () => {
  await startSoundSticker(ctx('t8', 'imageMessage', 'image/jpeg'))
  assert.equal(await handleSoundStickerInput(MSG, text('t8', 'batal'), A), true)
  assert.equal(await handleSoundStickerInput(MSG, audio('t8'), A), false)
})

test('nothing usable shows usage', async () => {
  seen.length = 0
  await startSoundSticker(ctx('t7', 'conversation'))
  assert.equal(seen.length, 1)
})

// --- sticker duration -------------------------------------------------------
// The sound is cut to the sticker's own animation length, so the sticker and the
// audio end together. A 7 s animation next to a 5 s sound is the bug this guards.

const chunk = (fourcc: string, size: number): Buffer => {
  const head = Buffer.alloc(8)
  head.write(fourcc, 0, 'ascii')
  head.writeUInt32LE(size, 4)
  const body = Buffer.alloc(size + (size & 1)) // chunks are padded to even
  return Buffer.concat([head, body])
}

const anmf = (ms: number): Buffer => {
  const b = chunk('ANMF', 16)
  b.writeUIntLE(ms, 8 + 12, 3)
  return b
}

const riff = (...chunks: Buffer[]): Buffer => {
  const body = Buffer.concat(chunks)
  const head = Buffer.alloc(12)
  head.write('RIFF', 0, 'ascii')
  head.writeUInt32LE(4 + body.length, 4)
  head.write('WEBP', 8, 'ascii')
  return Buffer.concat([head, body])
}

test('animMs sums ANMF frame durations', () => {
  assert.equal(animMs(riff(anmf(500), anmf(250))), 750)
  // odd-sized chunk in between must not desync the walk
  assert.equal(animMs(riff(chunk('ICCP', 3), anmf(1000))), 1000)
})

test('animMs reports 0 for a still image and for junk', () => {
  assert.equal(animMs(riff(chunk('VP8X', 10), chunk('VP8 ', 40))), 0)
  assert.equal(animMs(Buffer.from('not a webp at all')), 0)
  assert.equal(animMs(Buffer.alloc(0)), 0)
})
