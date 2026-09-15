import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { WAMessage, WAMessageKey, WASocket } from 'baileys'
import { sendButtons, sendList, type Button, type ListContent } from './buttons.ts'

const exec = promisify(execFile)

const AUDIO_BIN = join(
  import.meta.dirname, '..', '..', 'bin',
  process.platform === 'win32' ? 'audio.exe' : 'audio',
)

// TikTok serves 1080p60 H.264 High@L5.x that arrives fine but WA's inline
// player won't play (verified Sep 2026: 1080x1920 L5.2 45MB fails even after
// relabelling to L4.2, while 576x1240 L3.1 1.2MB plays — the gate isn't the
// level label). Boxes are read from moov only so mdat payload can't
// false-positive. Fail-open: unparseable → 'ok', never blocks a send.
// ponytail: 720p/L4.0 ceiling is empirical from 2 samples; re-encode sidecar
// if WA's actual limit gets mapped (needs H.264 encoder, not worth it yet).
export const videoPlayability = (buf: Buffer): 'ok' | 'heavy' => {
  try {
    let off = 0
    let moov: Buffer | undefined
    while (off + 8 <= buf.length) {
      const size = buf.readUInt32BE(off)
      const name = buf.subarray(off + 4, off + 8).toString()
      if (!/^[a-z0-9]{4}$/i.test(name) || size < 8 || off + size > buf.length) break
      if (name === 'moov') {
        moov = buf.subarray(off, off + size)
        break
      }
      if (name === 'mdat') break
      off += size
    }
    if (!moov) return 'ok'
    if (moov.includes(Buffer.from('hvc1')) || moov.includes(Buffer.from('hev1'))) return 'heavy'
    const tag = Buffer.from('avcC')
    let i = moov.indexOf(tag)
    while (i > 0) {
      if (moov[i + 7] > 0x28) return 'heavy' // above High@L4.0
      i = moov.indexOf(tag, i + 4)
    }
    // tkhd width/height are the last 8 bytes of each tkhd box (16.16 fixed).
    // compared as total pixels so portrait video (e.g. 576x1240) isn't
    // penalised for its tall side — 720p (921600px) is the ceiling.
    const tkhd = Buffer.from('tkhd')
    let t = moov.indexOf(tkhd)
    while (t > 4) {
      const size = moov.readUInt32BE(t - 4)
      if (size >= 92 && t - 4 + size <= moov.length) {
        const w = moov.readUInt32BE(t - 4 + size - 8) / 65536
        const h = moov.readUInt32BE(t - 4 + size - 4) / 65536
        if (w * h > 921600) return 'heavy'
      }
      t = moov.indexOf(tkhd, t + 4)
    }
    return 'ok'
  } catch {
    return 'ok' // sniff never blocks a send
  }
}

// ytmp3.mobi's "mp3" is AAC in a fragmented MP4 (ftyp brand), which iOS WhatsApp refuses to play — remux to a standard M4A via the native binary when available
const remuxM4A = async (buffer: Buffer): Promise<Buffer | null> => {
  if (buffer.subarray(4, 8).toString() !== 'ftyp' || !existsSync(AUDIO_BIN)) return null
  const dir = await mkdtemp(join(tmpdir(), 'wakaru-audio-'))
  try {
    const input = join(dir, 'in.m4a')
    const output = join(dir, 'out.m4a')
    await writeFile(input, buffer)
    await exec(AUDIO_BIN, [input, output], { timeout: 30_000 })
    return await readFile(output)
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export const makeSender = (sock: WASocket, chat: string, quoted?: WAMessage) => {
  const opts = quoted ? { quoted } : undefined
  const send = (content: Parameters<typeof sock.sendMessage>[1]) => sock.sendMessage(chat, content, opts)
  return {
    text: async (text: string) => { await send({ text }) },
    react: async (emoji: string, key?: WAMessageKey) => { await sock.sendMessage(chat, { react: { text: emoji, key } }) },
    sticker: async (buffer: Buffer) => { await send({ sticker: buffer }) },
    image: async (buffer: Buffer, caption?: string) => { await send({ image: buffer, caption }) },
    video: async (buffer: Buffer, caption?: string) => { await send({ video: buffer, caption }) },
    gif: async (buffer: Buffer, caption?: string) => { await send({ video: buffer, caption, mimetype: 'image/gif', gifPlayback: true }) },
    document: async (buffer: Buffer, fileName: string, mimetype = 'application/octet-stream') => { await send({ document: buffer, fileName, mimetype }) },
    // title is only for AI capture — WhatsApp audio has no visible caption
    audio: async (buffer: Buffer, _title?: string) => {
      const clean = await remuxM4A(buffer)
      if (clean) buffer = clean
      const mp4 = buffer.subarray(4, 8).toString() === 'ftyp'
      await send({ audio: buffer, mimetype: mp4 ? 'audio/mp4' : 'audio/mpeg' })
    },
    buttons: async (buttons: Button[], text: string, footer?: string) => { await sendButtons(sock, chat, { text, footer, buttons }) },
    list: async (o: ListContent) => { await sendList(sock, chat, o) },
  }
}

export type Sender = ReturnType<typeof makeSender>
