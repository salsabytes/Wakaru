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

export function serializeMessage(sock: WASocket, msg: WAMessage): SerializedMessage {
  const chat = msg.key?.remoteJid ?? ''
  const sender = msg.key?.participant || chat
  const mtype = msg.message ? Object.keys(msg.message)[0] : ''
  const content = (msg.message as any)?.[mtype] ?? {}
  const text = content.text || content.caption || msg.message?.conversation || ''


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