import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proto } from 'baileys'
import { ensureSoundStickerEncoding } from '../../../src/lib/wa/soundSticker.ts'

// Wire layout of a sound sticker, verified against real ones in the wild
// (Baileys issue #2932): 134 { 1 { 26: StickerMessage { 24=0, 26: AudioMessage } } }
// Fields 24/25/26 are absent from the WAProto Baileys ships, so these bytes are
// produced by the encode patch and would silently regress to a plain sticker
// if that patch ever stopped applying.

const readVarint = (buf: Buffer, at: number): [number, number] => {
  let shift = 0
  let out = 0
  for (;;) {
    const byte = buf[at++]
    out += (byte & 0x7f) * 2 ** shift
    if (!(byte & 0x80)) return [out, at]
    shift += 7
  }
}

type Field = { field: number; value?: number; data?: Buffer }

const parse = (buf: Buffer): Field[] => {
  const fields: Field[] = []
  let at = 0
  while (at < buf.length) {
    const [key, next] = readVarint(buf, at)
    const field = Math.floor(key / 8)
    const wire = key & 7
    at = next
    if (wire === 2) {
      const [len, start] = readVarint(buf, at)
      fields.push({ field, data: buf.subarray(start, start + len) })
      at = start + len
    } else if (wire === 0) {
      const [value, after] = readVarint(buf, at)
      fields.push({ field, value })
      at = after
    } else {
      throw new Error(`unexpected wire type ${wire} for field ${field}`)
    }
  }
  return fields
}

const bytes32 = (fill: number) => new Uint8Array(32).fill(fill)

const stickerWithSound = () => ({
  url: 'https://mmg.whatsapp.net/sticker',
  mimetype: 'image/webp',
  fileSha256: bytes32(1),
  fileEncSha256: bytes32(2),
  mediaKey: bytes32(3),
  directPath: '/v/t62.15575-24/sticker',
  fileLength: 2048,
  height: 512,
  width: 512,
  isAnimated: true,
  soundAudio: {
    url: 'https://mmg.whatsapp.net/audio',
    mimetype: 'audio/ogg; codecs=opus',
    fileSha256: bytes32(7),
    fileEncSha256: bytes32(8),
    mediaKey: bytes32(9),
    directPath: '/v/t62.7117-24/audio',
    fileLength: 12_345,
    seconds: 4,
    ptt: false,
  },
})

const encode = (message: proto.IMessage) => Buffer.from(proto.Message.encode(message).finish())

test('sound sticker encodes as 134 { 1 { 26: sticker with audio } }', () => {
  assert.equal(ensureSoundStickerEncoding(), true)
  const top = parse(encode({ stickerMessage: stickerWithSound() as never }))

  assert.deepEqual(
    top.map((f) => f.field),
    [134],
    'sticker must move under field 134, never stay at the top level',
  )
  const wrapper = parse(top[0].data!)
  assert.deepEqual(wrapper.map((f) => f.field), [1])
  const nested = parse(wrapper[0].data!)
  assert.deepEqual(nested.map((f) => f.field), [26], 'payload must be a stickerMessage')

  const stickerFields = parse(nested[0].data!)
  assert.equal(stickerFields.find((f) => f.field === 24)?.value, 0, 'field 24 must be present and 0')
  const audioField = stickerFields.find((f) => f.field === 26)
  assert.ok(audioField?.data, 'field 26 must carry the AudioMessage')

  const audio = proto.Message.AudioMessage.decode(audioField.data!)
  assert.equal(audio.mimetype, 'audio/ogg; codecs=opus')
  assert.equal(Number(audio.seconds), 4)
  assert.equal(Number(audio.fileLength), 12_345)
  assert.equal(audio.mediaKey?.length, 32)

  const sticker = proto.Message.StickerMessage.decode(nested[0].data!)
  assert.equal(sticker.mimetype, 'image/webp')
  assert.equal(sticker.isAnimated, true)
  assert.equal(sticker.height, 512)
})

test('a plain sticker is left untouched', () => {
  ensureSoundStickerEncoding()
  const { soundAudio: _drop, ...plain } = stickerWithSound()
  const top = parse(encode({ stickerMessage: plain as never }))
  assert.deepEqual(top.map((f) => f.field), [26], 'no audio means no 134 wrapper')
  const sticker = proto.Message.StickerMessage.decode(top[0].data!)
  assert.equal(sticker.mimetype, 'image/webp')
})

test('the nested deviceSentMessage copy is rewritten too', () => {
  ensureSoundStickerEncoding()
  // relayMessage sends this to the sender's own other devices
  const bytes = encode({
    deviceSentMessage: {
      destinationJid: '628123@s.whatsapp.net',
      message: { stickerMessage: stickerWithSound() as never },
    },
  })
  const dsm = parse(parse(bytes)[0].data!)
  const inner = parse(dsm.find((f) => f.field === 2)!.data!)
  assert.deepEqual(inner.map((f) => f.field), [134], 'own devices must also get a sound sticker')
})
