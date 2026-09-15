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

const VIDEO_BIN = join(
  import.meta.dirname, '..', '..', 'bin',
  process.platform === 'win32' ? 'video.exe' : 'video',
)

// TikTok serves H.264 High up to L5.2 / HEVC that WA's inline player refuses to
// play (message arrives fine, tap-to-play does nothing). Codec boxes live in
// moov — scan is confined there so mdat payload bytes can't false-positive.
// ponytail: L4.2 ceiling is empirical; the video sidecar relabels L5.x→L4.2,
// HEVC still falls back to raw (needs a real re-encode, not worth it yet).
export const waInlineVideoOk = (buf: Buffer): boolean => {
  try {
    let moov: Buffer | undefined
    let off = 0
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
    if (!moov) return true // fail-open: no moov (fragmented?) → keep current behavior
    if (moov.includes(Buffer.from('hvc1')) || moov.includes(Buffer.from('hev1'))) return false
    const tag = Buffer.from('avcC')
    let i = moov.indexOf(tag)
    while (i > 0) {
      if (moov[i + 7] > 0x2a) return false // above High@L4.2
      i = moov.indexOf(tag, i + 4)
    }
    return true
  } catch {
    return true // sniff never blocks a send
  }
}

// H.264 High@L5.x (what TikTok serves for 1080p60) relabelled to L4.2 — byte
// patch, milliseconds, zero quality loss. Binary missing/failed (HEVC, weird
// boxes) → null and the raw buffer goes out (fail-open, never blocks a send).
const patchVideoLevel = async (buffer: Buffer): Promise<Buffer | null> => {
  if (waInlineVideoOk(buffer) || !existsSync(VIDEO_BIN)) return null
  const dir = await mkdtemp(join(tmpdir(), 'wakaru-video-'))
  try {
    const input = join(dir, 'in.mp4')
    const output = join(dir, 'out.mp4')
    await writeFile(input, buffer)
    await exec(VIDEO_BIN, [input, output], { timeout: 60_000 })
    return await readFile(output)
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
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
    video: async (buffer: Buffer, caption?: string) => {
      const patched = await patchVideoLevel(buffer)
      if (patched) buffer = patched
      await send({ video: buffer, caption })
    },
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
