import { test } from 'node:test'
import assert from 'node:assert/strict'
import { proto, type WASocket } from 'baileys'
import { generateGroupStatusId, sendGroupStatus, wrapGroupStatus } from '../../../src/lib/wa/groupStatus.ts'

// A group status is only a group status because of two things: the message is
// wrapped in `groupStatusMessageV2` (field 103) and the inner content carries
// `contextInfo.isGroupStatus` (field 66). Stock Baileys rc14 has sugar for
// neither — `{ groupStatus: true }` is a fork-only key that gets dropped, which
// turns the command into a plain message with no error at all. These assertions
// pin the wire shape so that regression can't pass silently again.

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

/** Top-level field numbers of an encoded proto message. */
const topLevel = (raw: Uint8Array): number[] => {
  const buf = Buffer.from(raw)
  const out: number[] = []
  let at = 0
  while (at < buf.length) {
    const [key, next] = readVarint(buf, at)
    const field = Math.floor(key / 8)
    const wire = key & 7
    at = next
    out.push(field)
    if (wire === 2) {
      const [len, start] = readVarint(buf, at)
      at = start + len
    } else if (wire === 0) {
      at = readVarint(buf, at)[1]
    } else {
      throw new Error(`unexpected wire type ${wire} at field ${field}`)
    }
  }
  return out
}

const sock = (): { sock: WASocket; calls: any[] } => {
  const calls: any[] = []
  const stub = {
    user: { id: '628111111111:1@s.whatsapp.net', lid: '111111111111111@lid' },
    waUploadToServer: async () => {
      throw new Error('no upload in unit test')
    },
    relayMessage: async (jid: string, message: unknown, opts: unknown) => {
      calls.push({ jid, message, opts })
      return (opts as { messageId: string }).messageId
    },
  } as unknown as WASocket
  return { sock: stub, calls }
}

test('status ids use the app’s 3EB0 prefix and 16 random bytes', () => {
  const id = generateGroupStatusId()
  assert.match(id, /^3EB0[0-9A-F]{32}$/)
  assert.notEqual(generateGroupStatusId(), id)
})

test('text content is wrapped in groupStatusMessageV2 with isGroupStatus', () => {
  const wrapped = wrapGroupStatus({ extendedTextMessage: { text: 'halo grup' } })
  const bytes = proto.Message.encode(proto.Message.create(wrapped)).finish()

  assert.deepEqual(topLevel(bytes), [103]) // groupStatusMessageV2
  const back = proto.Message.decode(bytes)
  const inner = back.groupStatusMessageV2?.message
  assert.equal(inner?.extendedTextMessage?.text, 'halo grup')
  assert.equal(inner?.extendedTextMessage?.contextInfo?.isGroupStatus, true)
})

// Media statuses carry the flag on the media message itself, not on a sibling
// field, so the wrapper has to reach whichever key the inner content used.
test('media content keeps its caption and gets the flag too', () => {
  const wrapped = wrapGroupStatus({
    imageMessage: { url: 'https://mmg.whatsapp.net/x', mimetype: 'image/jpeg', caption: 'pantai', fileLength: 1234 },
  })
  const back = proto.Message.decode(proto.Message.encode(proto.Message.create(wrapped)).finish())
  const inner = back.groupStatusMessageV2?.message
  assert.equal(inner?.imageMessage?.caption, 'pantai')
  assert.equal(inner?.imageMessage?.contextInfo?.isGroupStatus, true)
})

// prepareWAMessageMedia hands back a proto.Message *instance*, not a plain
// object — if the wrapper dropped it, media statuses would arrive empty with no
// error at all, so the instance path is pinned here too.
test('a proto.Message instance at the media position is encoded through', () => {
  const instance = proto.Message.fromObject({
    imageMessage: { url: 'https://mmg.whatsapp.net/x', mimetype: 'image/jpeg', caption: 'pantai', fileLength: 1234, width: 800, height: 600 },
  })
  const back = proto.Message.decode(proto.Message.encode(proto.Message.create(wrapGroupStatus(instance))).finish())
  const inner = back.groupStatusMessageV2?.message
  assert.equal(inner?.imageMessage?.caption, 'pantai')
  assert.equal(inner?.imageMessage?.url, 'https://mmg.whatsapp.net/x')
  assert.equal(Number(inner?.imageMessage?.fileLength), 1234)
  assert.equal(inner?.imageMessage?.contextInfo?.isGroupStatus, true)
})

test('existing contextInfo survives the wrap', () => {
  const wrapped = wrapGroupStatus({ extendedTextMessage: { text: 'a', contextInfo: { mentionedJid: ['628@s.whatsapp.net'] } } })
  const ci = wrapped.groupStatusMessageV2?.message?.extendedTextMessage?.contextInfo
  assert.deepEqual(ci?.mentionedJid, ['628@s.whatsapp.net'])
  assert.equal(ci?.isGroupStatus, true)
})

// The `<meta is_group_status>` node is what makes the post show up on members'
// phones; the server accepts the payload without it and silently does nothing.
test('relay carries the group_status meta node and a 3EB0 id', async () => {
  const { sock: stub, calls } = sock()
  const id = await sendGroupStatus(stub, '120363000000000000@g.us', { text: 'pengumuman' })

  assert.equal(calls.length, 1)
  const [{ jid, message, opts }] = calls
  assert.equal(jid, '120363000000000000@g.us')
  assert.equal(opts.messageId, id)
  assert.match(id, /^3EB0/)
  assert.equal(message.groupStatusMessageV2.message.extendedTextMessage.contextInfo.isGroupStatus, true)
  assert.deepEqual(opts.additionalNodes, [
    { tag: 'meta', attrs: { is_group_status: 'true', origin: 'group_status' } },
  ])
})
