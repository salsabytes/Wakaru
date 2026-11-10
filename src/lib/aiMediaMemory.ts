import type { AiFileInput } from './llm.ts'
import { addPendingAiFiles } from './aiHistory.ts'
import { logger } from './logger.ts'
import type { SerializedMessage } from './serialize.ts'

// Media types we can remember for a later `.ai` question
const MEDIA_TYPES = new Set(['imageMessage', 'documentMessage', 'videoMessage', 'audioMessage', 'stickerMessage'])
const MAX_AI_FILE_BYTES = 20 * 1024 * 1024 // 20MB safety cap per remembered file

const mimeOf = (mtype?: string, mimetype?: string, fileName?: string): string => {
  const m = String(mimetype || '').split(';')[0].trim()
  if (m) return m
  if (mtype === 'imageMessage') return 'image/jpeg'
  if (mtype === 'stickerMessage') return 'image/webp'
  if (mtype === 'videoMessage') return 'video/mp4'
  if (mtype === 'audioMessage') return 'audio/mpeg'
  if (mtype === 'documentMessage') {
    const ext = String(fileName || '').split('.').pop()?.toLowerCase() || ''
    if (ext === 'pdf') return 'application/pdf'
    if (ext === 'txt') return 'text/plain'
    if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  return 'application/octet-stream'
}

const nameOf = (mtype?: string, mime?: string, fileName?: string): string => {
  if (fileName) return fileName
  const ext = (mime || '').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin'
  if (mtype === 'imageMessage') return `image.${ext}`
  if (mtype === 'stickerMessage') return 'sticker.webp'
  if (mtype === 'videoMessage') return `video.${ext}`
  if (mtype === 'audioMessage') return `audio.${ext}`
  return `file.${ext}`
}

// Save media-only messages as "pending" files so the next `.ai` can analyze them
export async function rememberAiMedia(m: SerializedMessage, sender: string): Promise<void> {
  if (!MEDIA_TYPES.has(m.mtype) || !m.download) return
  try {
    const buf = await m.download()
    if (!buf?.length || buf.length > MAX_AI_FILE_BYTES) return
    const mime = mimeOf(m.mtype, m.mimetype)
    const file: AiFileInput = { data: buf.toString('base64'), mime, name: nameOf(m.mtype, mime) }
    addPendingAiFiles(`${m.chat}:${sender}`, [file])
  } catch (e) {
    logger.warn('ai media remember failed:', (e as Error).message)
  }
}
