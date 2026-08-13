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
