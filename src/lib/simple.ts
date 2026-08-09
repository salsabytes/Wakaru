import type { WAMessage, WASocket } from 'baileys'
import { downloadMediaMessage } from 'baileys'

export interface MediaMeta {
  mtype: string
  chat: string
  sender: string
  fromMe: boolean
  text: string
  download: () => Promise<Buffer>
}

export interface SerializedMessage {
  chat: string
  sender: string
  isGroup: boolean
  fromMe: boolean
  mtype: string
  text: string
  download: () => Promise<Buffer>
  quoted?: MediaMeta
}

const bodyOf = (msg: WAMessage): [string, any] => {
  const mtype = msg.message ? Object.keys(msg.message)[0] : ''
  return [mtype, (msg.message as any)?.[mtype] ?? {}]
}

export const textOfMessage = (msg: WAMessage): string => {
  const [, content] = bodyOf(msg)
  return content.text || content.caption || msg.message?.conversation || ''
}

export function serializeMessage(sock: WASocket, msg: WAMessage): SerializedMessage {
  const chat = msg.key?.remoteJid ?? ''
  const sender = msg.key?.participant || chat
  const [mtype, content] = bodyOf(msg)
  const text = textOfMessage(msg)


  const download = () => downloadMediaMessage(msg, 'buffer', {}) as unknown as Promise<Buffer>

  const s: SerializedMessage = {
    chat,
    sender,
    isGroup: chat.endsWith('@g.us'),
    fromMe: !!msg.key?.fromMe,
    mtype,
    text,
    download,
  }

  const ctxt = content.contextInfo
  const q = ctxt?.quotedMessage
  if (q) {
    const qtype = Object.keys(q)[0]
    const qc = (q as any)?.[qtype] ?? {}
    s.quoted = {
      mtype: qtype,
      chat: ctxt.remoteJid ?? chat,
      sender: ctxt.participant ?? '',
      fromMe: ctxt.participant === sock.user?.id,
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