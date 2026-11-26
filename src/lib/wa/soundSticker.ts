// Sound stickers: a normal sticker whose StickerMessage also carries a short
// Opus clip (`audioMessage`, field 26), wrapped in Message field 134
// (`audioStickerMessage`, a FutureProofMessage).
//
// Wire layout, confirmed against real stickers in the wild (Baileys #2932):
//   134 { 1: Message { 26: StickerMessage { ...known fields, 24: 0, 26: AudioMessage } } }
// Fields 24/25/26 do not exist in the WAProto shipped with Baileys 7.0.0-rc14,
// so protobufjs drops them on both encode and decode. Sending is therefore done
// by patching `proto.Message.encode`: the sticker is still built and uploaded
// through the normal `{ sticker }` path (so the `<enc mediatype="sticker">`
// attribute and every media field stay exactly as WhatsApp expects) and only
// the byte layout is rewritten at the very end.
//
// Unknown keys are ignored by protobufjs encoders, which is what lets a plain
// object carry `soundAudio` until we pick it out here.
//
// ponytail: receiving sound stickers is NOT handled — they decode as empty
// messages until WAProto gains field 134. Adding that means patching `decode`
// too; do it together with an unwrap in serialize.ts.
import { type WAMessage, type WASocket, generateWAMessageFromContent, prepareWAMessageMedia, proto } from 'baileys'
import { logger } from '../logger.ts'

const AUDIO_MIMETYPE = 'audio/ogg; codecs=opus'
const FIELD_AUDIO_STICKER = 134
const FIELD_STICKER_AUDIO = 26

type StickerWithSound = proto.Message.IStickerMessage & { soundAudio?: proto.Message.IAudioMessage }

const varint = (n: number): Buffer => {
  const out: number[] = []
  while (n > 127) {
    out.push((n & 0x7f) | 0x80)
    n = Math.floor(n / 128)
  }
  out.push(n)
  return Buffer.from(out)
}

// tag + length prefix: field 26 len-delimited is 0xd2 0x01, field 134 is 0x82 0x08
const lenField = (field: number, payload: Buffer): Buffer =>
  Buffer.concat([varint((field << 3) | 2), varint(payload.length), payload])

let patched = false

// Has upstream caught up? Then the official path wins and our patch must stay
// out. Detection is by name, so a match is not proof the field encoding is
// identical — the caller logs it once and the send path uses the plain object.
const hasNativeSupport = (): boolean => {
  const M = proto.Message as unknown as { StickerMessage?: Record<string, unknown> }
  return !!M.StickerMessage && 'audioMessage' in M.StickerMessage
}

export const ensureSoundStickerEncoding = (): boolean => {
  if (patched) return true
  if (hasNativeSupport()) return false
  const M = proto.Message
  const origEncode = M.encode.bind(M)
  M.encode = ((m: proto.IMessage, w?: Parameters<typeof M.encode>[1]) => {
    const sticker = m?.stickerMessage as StickerWithSound | null | undefined
    const audio = sticker?.soundAudio
    if (!sticker || !audio) return origEncode(m, w)

    const stickerBytes = Buffer.from(M.StickerMessage.encode(sticker).finish())
    const audioBytes = Buffer.from(M.AudioMessage.encode(audio).finish())
    // field 24 = 0 always; field 25 (emoji) is optional and omitted
    const withAudio = Buffer.concat([
      stickerBytes,
      varint(24 << 3), varint(0),
      lenField(FIELD_STICKER_AUDIO, audioBytes),
    ])

    // the sticker must not also sit at the top level, or WA sees a plain sticker
    const { stickerMessage: _drop, ...rest } = m
    const writer = w ?? origEncode({})
    origEncode(rest, writer)
    writer.uint32((FIELD_AUDIO_STICKER << 3) | 2)
    writer.bytes(lenField(1, lenField(26, withAudio)))
    void _drop
    return writer
  }) as typeof M.encode
  patched = true
  return true
}

export interface SoundStickerInput {
  sticker: Buffer
  // already Ogg Opus, produced by `audio soundsticker`
  audio: Buffer
  seconds: number
  quoted?: WAMessage
}

// Baileys computes no sticker metadata, but WA reads `isAnimated` to decide how
// long a sound sticker loops (3x alongside the animation) and the client's
// sticker viewer wants the real size. Both are cheap to read off the WebP
// header: a VP8X chunk carries the animation flag plus 24-bit canvas size.
const webpMeta = (buf: Buffer): { width?: number; height?: number; isAnimated?: boolean } => {
  if (buf.length < 30 || buf.toString('hex', 0, 4) !== '52494646' || buf.toString('ascii', 8, 12) !== 'WEBP') return {}
  const kind = buf.toString('ascii', 12, 16)
  if (kind === 'VP8X') {
    const flags = buf[20]
    const width = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1
    const height = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1
    return { width, height, isAnimated: (flags & 0x02) !== 0 }
  }
  if (kind === 'VP8 ') {
    // lossy: 3-byte frame tag, 3-byte sync, then 14-bit dimensions
    if (buf.length < 30) return {}
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, isAnimated: false }
  }
  if (kind === 'VP8L') {
    const bits = buf.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, isAnimated: false }
  }
  return {}
}

/** Uploads both media parts and relays a sound sticker. Throws on failure. */
export const sendSoundSticker = async (sock: WASocket, chat: string, input: SoundStickerInput): Promise<void> => {
  // a false return means upstream Baileys grew the fields itself; the plain
  // object below is then encoded by the official code path.
  if (!ensureSoundStickerEncoding()) logger.warn('soundsticker: WAProto has native audioMessage support, encode patch skipped')

  const upload = sock.waUploadToServer
  const stickerPart = await prepareWAMessageMedia({ sticker: input.sticker }, { upload, mediaTypeOverride: 'sticker' })
  const audioPart = await prepareWAMessageMedia(
    { audio: input.audio, mimetype: AUDIO_MIMETYPE, seconds: input.seconds },
    { upload },
  )
  if (!stickerPart?.stickerMessage || !audioPart?.audioMessage) throw new Error('media upload returned no message')

  const content: proto.IMessage = {
    stickerMessage: {
      ...stickerPart.stickerMessage,
      ...webpMeta(input.sticker),
      soundAudio: audioPart.audioMessage,
    } as StickerWithSound,
  }
  const msg = generateWAMessageFromContent(chat, content, {
    userJid: sock.user?.id ?? '',
    ...(input.quoted ? { quoted: input.quoted } : {}),
  })
  await sock.relayMessage(chat, msg.message!, { messageId: msg.key.id! })
}
