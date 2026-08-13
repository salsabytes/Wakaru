import { makeSender, type Sender } from './sender.ts'

const requireUrl = async (ctx: CommandContext, name: string, usage: string): Promise<string | undefined> => {
  const url = ctx.text.trim()
  if (!url) {
    await ctx.reply(`usage: ${ctx.prefix}${name} ${usage}`)
    return undefined
  }
  await ctx.react('⏳')
  return url
}

export { requireUrl }

const fmtDur = (sec: number): string => {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export const fmtBytes = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`

// ponytail: sniff-based duration from the media buffer — mp3 assumes CBR
// (ytmp3 output is 128kbps CBR); VBR mp3 durations will be off, fine for a summary line.
export const mediaDuration = (buf: Buffer): string | undefined => {
  const mvhd = buf.indexOf(Buffer.from('mvhd'))
  if (mvhd > 0 && mvhd + 36 <= buf.length) {
    // mvhd box: [size]['mvhd'][version+flags][creation][modification][timescale][duration]
    const v1 = buf[mvhd + 4] === 1
    const ts = buf.readUInt32BE(mvhd + (v1 ? 24 : 16))
    const du = v1 ? Number(buf.readBigUInt64BE(mvhd + 28)) : buf.readUInt32BE(mvhd + 20)
    const sec = du / ts
    if (ts && du && sec < 86_400) return fmtDur(sec) // reject garbage from false 'mvhd' matches
  }
  let off = 0
  if (buf.subarray(0, 3).toString() === 'ID3') {
    off = 10 + ((buf[6] & 0x7f) << 21 | (buf[7] & 0x7f) << 14 | (buf[8] & 0x7f) << 7 | (buf[9] & 0x7f))
  }
  if (buf[off] === 0xff && (buf[off + 1] & 0xe0) === 0xe0) {
    const ver = (buf[off + 1] >> 3) & 0x03
    const layer = (buf[off + 1] >> 1) & 0x03
    const kbps = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320][(buf[off + 2] >> 4) & 0x0f]
    const srate = [44100, 48000, 32000][(buf[off + 2] >> 2) & 0x03]
    if (ver === 3 && layer === 1 && kbps && srate) return fmtDur(((buf.length - off) * 8) / (kbps * 1000))
  }
  return undefined
}

if (process.env.MEDIA_SELFTEST) {
  const mp4 = Buffer.alloc(64)
  mp4.write('mvhd', 4)
  mp4.writeUInt32BE(1000, 4 + 16) // timescale at M+16 (M = 'mvhd' position)
  mp4.writeUInt32BE(253000, 4 + 20) // duration at M+20 → 4:13
  if (mediaDuration(mp4) !== '4:13') throw new Error('mediaDuration mp4 fail')
  const v1mp4 = Buffer.alloc(64)
  v1mp4.write('mvhd', 4)
  v1mp4[8] = 1 // version 1
  v1mp4.writeUInt32BE(1000, 4 + 24) // timescale at M+24 (4B in v1 too)
  v1mp4.writeBigUInt64BE(253000n, 4 + 28) // duration at M+28 (8B)
  if (mediaDuration(v1mp4) !== '4:13') throw new Error('mediaDuration mp4 v1 fail')
  const mp3 = Buffer.alloc(128000) // 128kbps CBR → 8s
  mp3[0] = 0xff
  mp3[1] = 0xfb
  mp3[2] = 0x90
  if (mediaDuration(mp3) !== '0:08') throw new Error('mediaDuration mp3 fail')
  if (fmtBytes(3.2e6) !== '3.2 MB') throw new Error('fmtBytes fail')
  console.log('media self-check ok')
  process.exit(0)
}

export interface OutMedia {
  type: 'image' | 'video'
  buf: Buffer
  caption?: string
}

export async function sendMedia(ctx: CommandContext, media: OutMedia[]): Promise<void> {
  const dm = media.length > 1 && ctx.isGroup
  const sendOne = async (s: Sender) => {
    for (const [i, m] of media.entries()) {
      const caption = i === 0 ? m.caption : undefined
      if (m.type === 'video') await s.video(m.buf, caption)
      else await s.image(m.buf, caption)
    }
  }
  try {
    await sendOne(makeSender(ctx.sock, dm ? ctx.sender : ctx.chat))
  } catch (err) {
    if (dm) {
      await sendOne(makeSender(ctx.sock, ctx.chat))
      return
    }
    throw err
  }
  if (dm) await ctx.reply(`📩 ${media.length} file dikirim ke chat pribadimu ya`)
}
