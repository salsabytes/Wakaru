import { proto, generateWAMessageFromContent, isJidGroup, type WASocket, type BinaryNode } from 'baileys'

export interface Button {
  id: string
  text: string
}

export interface ButtonsContent {
  text: string
  footer?: string
  buttons: Button[]
}

export interface ListRow {
  header?: string
  title: string
  description?: string
  id: string
}

export interface ListSection {
  title?: string
  rows: ListRow[]
}

export interface ListContent {
  text: string
  title?: string
  footer?: string
  sections: ListSection[]
}

// biz attrs must match the battle-tested shape — empty attrs render buttons but some clients never wire taps
async function relayInteractive(sock: WASocket, jid: string, interactiveMessage: proto.Message.IInteractiveMessage) {
  const msg = generateWAMessageFromContent(jid, { interactiveMessage }, { userJid: sock.user!.id })
  const additionalNodes: BinaryNode[] = [
    {
      tag: 'biz',
      attrs: {
        actual_actors: '2',
        host_storage: '2',
        privacy_mode_ts: String(Math.floor(Date.now() / 1000)),
      },
      content: [
        {
          tag: 'interactive',
          attrs: { type: 'native_flow', v: '1' },
          content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }],
        },
        { tag: 'quality_control', attrs: { source_type: 'third_party' } },
      ],
    },
  ]

  if (!isJidGroup(jid)) additionalNodes.push({ tag: 'bot', attrs: { biz_bot: '1' } })
  await sock.relayMessage(jid, msg.message!, { messageId: msg.key.id!, additionalNodes })
  return msg
}

export async function sendButtons(sock: WASocket, jid: string, c: ButtonsContent) {
  const interactiveMessage = proto.Message.InteractiveMessage.create({
    body: { text: c.text },
    ...(c.footer ? { footer: { text: c.footer } } : {}),
    nativeFlowMessage: {
      buttons: c.buttons.map((b) => ({
        name: 'quick_reply',
        buttonParamsJson: JSON.stringify({ display_text: b.text, id: b.id }),
      })),
    },
  })
  return relayInteractive(sock, jid, interactiveMessage)
}

export async function sendList(sock: WASocket, jid: string, o: ListContent) {
  const interactiveMessage = proto.Message.InteractiveMessage.create({
    body: { text: o.text },
    ...(o.footer ? { footer: { text: o.footer } } : {}),
    nativeFlowMessage: {
      buttons: [
        {
          name: 'single_select',
          buttonParamsJson: JSON.stringify({
            title: o.title ?? 'Pilih',
            sections: o.sections.map((s) => ({
              ...(s.title ? { title: s.title } : {}),
              rows: s.rows.map((r) => ({
                ...(r.header ? { header: r.header } : {}),
                title: r.title,
                ...(r.description ? { description: r.description } : {}),
                id: r.id,
              })),
            })),
          }),
        },
      ],
    },
  })
  return relayInteractive(sock, jid, interactiveMessage)
}

