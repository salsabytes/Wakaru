import type { AiFileInput } from './llm.ts'
import { addPendingAiFiles } from './aiHistory.ts'
import { fileMime, fileNameOf } from '../fileinfo.ts'
import { logger } from '../logger.ts'
import type { SerializedMessage } from '../wa/serialize.ts'

// Media types we can remember for a later `.ai` question
const MEDIA_TYPES = new Set(['imageMessage', 'documentMessage', 'videoMessage', 'audioMessage', 'stickerMessage'])
const MAX_AI_FILE_BYTES = 20 * 1024 * 1024 // 20MB safety cap per remembered file

// Save media-only messages as "pending" files so the next `.ai` can analyze them
export async function rememberAiMedia(m: SerializedMessage, sender: string): Promise<void> {
  if (!MEDIA_TYPES.has(m.mtype) || !m.download) return
  try {
    const buf = await m.download()
    if (!buf?.length || buf.length > MAX_AI_FILE_BYTES) return
    const mime = fileMime(m.mtype, m.mimetype, m.fileName)
    const file: AiFileInput = { data: buf.toString('base64'), mime, name: fileNameOf(m.mtype, mime, m.fileName) }
    addPendingAiFiles(`${m.chat}:${sender}`, [file])
  } catch (e) {
    logger.warn('ai media remember failed:', (e as Error).message)
  }
}
