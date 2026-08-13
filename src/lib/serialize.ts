import type { WAMessage } from 'baileys'
import { downloadMediaMessage, getContentType, normalizeMessageContent } from 'baileys'

export interface MediaMeta {
  mtype: string
  chat: string
  sender: string
  text: string
  download: () => Promise<Buffer>
}

export interface SerializedMessage {
  chat: string
  sender: string
  isGroup: boolean
  mtype: string
  text: string
  mentionedJid: string[]
  download: () => Promise<Buffer>
  button?: { id: string; text: string }
  quoted?: MediaMeta
}

const bodyOf = (msg: WAMessage): [string, any] => {
  // getContentType skips header fields like messageContextInfo — Object.keys()[0] would pick the header and drop taps
  const message = normalizeMessageContent(msg.message as any)
  const mtype = getContentType(message) ?? ''
  return [mtype, (message as any)?.[mtype] ?? {}]
}

export const textOfMessage = (msg: WAMessage): string => {
  const [, content] = bodyOf(msg)
  return content.text || content.caption || msg.message?.conversation || ''
}

const parseParams = (json: string): any => {
  try {
    const p = JSON.parse(json)
    if (typeof p.response === 'string') return parseParams(p.response)
    return p
  } catch {
    return null
  }
}

function buttonOf(mtype: string, content: any): { id: string; text: string } | undefined {
  if (mtype === 'interactiveResponseMessage') {
    const nf = content?.nativeFlowResponseMessage
    if (!nf?.paramsJson) return undefined
    const p = parseParams(nf.paramsJson)
    if (!p) return undefined
    return { id: p.id ?? p.selectedRowId ?? p.rowId ?? '', text: p.display_text ?? p.title ?? p.row_title ?? '' }
  }
  if (mtype === 'buttonsResponseMessage') {
    return { id: content?.selectedButtonId ?? '', text: content?.selectedDisplayText ?? '' }
  }
  if (mtype === 'templateButtonReplyMessage') {
    return { id: content?.selectedId ?? '', text: content?.selectedDisplayText ?? '' }
  }
  if (mtype === 'listResponseMessage') {
    return { id: content?.singleSelectReply?.selectedRowId ?? '', text: content?.title ?? '' }
  }
  return undefined
}

export function serializeMessage(msg: WAMessage): SerializedMessage {
  const chat = msg.key?.remoteJid ?? ''
  const sender = msg.key?.participant || chat
  const [mtype, content] = bodyOf(msg)
  const button = buttonOf(mtype, content)
  const text = button?.text || textOfMessage(msg)

  const download = () => downloadMediaMessage(msg, 'buffer', {}) as unknown as Promise<Buffer>

  const ctxt = content.contextInfo
  const s: SerializedMessage = {
    chat,
    sender,
    isGroup: chat.endsWith('@g.us'),
    mtype,
    text,
    mentionedJid: ctxt?.mentionedJid ?? [],
    ...(button ? { button } : {}),
    download,
  }

  const q = ctxt?.quotedMessage
  if (q) {
    const qtype = Object.keys(q)[0]
    const qc = (q as any)?.[qtype] ?? {}
    s.quoted = {
      mtype: qtype,
      chat: ctxt.remoteJid ?? chat,
      sender: ctxt.participant ?? '',
      text: qc.text || qc.caption || '',
      download: () =>
        downloadMediaMessage(
          {
            key: { id: ctxt.stanzaId, remoteJid: ctxt.remoteJid, participant: ctxt.participant },
            message: q,
          } as WAMessage,
          'buffer',
          {},
        ) as unknown as Promise<Buffer>,
    }
  }

  return s
}
