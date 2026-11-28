import { randomBytes } from 'node:crypto'
import { generateWAMessageFromContent, getContentType, prepareWAMessageMedia, proto, type WASocket } from 'baileys'

// WhatsApp publishes a group status as an ORDINARY group message wrapped in
// `groupStatusMessageV2` (proto field 103) whose inner content carries
// `contextInfo.isGroupStatus` (field 66). Stock Baileys rc14 has no sugar for
// it: `sendMessage(chat, { text, groupStatus: true })` silently sends a normal
// message (that key is a fork-only feature and gets dropped), and sendMessage()
// never forwards `additionalNodes`, which the `<meta>` below needs. So this goes
// through relayMessage(), same as src/lib/wa/buttons.ts does.
//
// ponytail: `3EB0` id prefix + the meta node are copied from the phone app and
// from WhiskeySockets/Baileys#2903 (verified there for admin revoke); the send
// path itself is not yet proven on a live socket.

export const GROUP_STATUS_ID_PREFIX = '3EB0'

export interface GroupStatusInput {
  text?: string
  image?: Buffer
  video?: Buffer
  gif?: boolean
  // only meaningful for text-only statuses
  backgroundColor?: string
  font?: number
}

/** Status message ids use their own 3EB0 + 16 random bytes convention. */
export const generateGroupStatusId = (): string =>
  `${GROUP_STATUS_ID_PREFIX}${randomBytes(16).toString('hex').toUpperCase()}`

// WA stores status text colours as 0xAARRGGBB fixed32, not a css string.
const argb = (hex: string): number => parseInt(`FF${hex.replace('#', '').padStart(6, '0')}`, 16)

/** Marks a built content as a group status and wraps it the way the app does. */
export const wrapGroupStatus = (inner: proto.IMessage): proto.IMessage => {
  const key = getContentType(inner)
  if (!key) throw new Error('groupStatus: empty message content')
  const body = inner[key] as { contextInfo?: proto.IContextInfo } & Record<string, unknown>
  body.contextInfo = { ...(body.contextInfo ?? {}), isGroupStatus: true }
  // written out explicitly instead of a dynamic key: the wrapper field has to
  // survive WAProto.create() and a `{ [k]: v }` would hide the typo risk
  return { groupStatusMessageV2: { message: inner } }
}

const buildInner = async (sock: WASocket, input: GroupStatusInput): Promise<proto.IMessage> => {
  if (input.video) {
    const media = { video: input.video, caption: input.text, gifPlayback: input.gif === true }
    return (await prepareWAMessageMedia(media, { upload: sock.waUploadToServer })) as proto.IMessage
  }
  if (input.image) {
    const media = { image: input.image, caption: input.text }
    return (await prepareWAMessageMedia(media, { upload: sock.waUploadToServer })) as proto.IMessage
  }
  const ext: proto.Message.IExtendedTextMessage = { text: input.text ?? '' }
  if (input.backgroundColor) ext.backgroundArgb = argb(input.backgroundColor)
  if (input.font !== undefined) ext.font = input.font as proto.Message.ExtendedTextMessage.FontType
  return { extendedTextMessage: ext }
}

/** Publishes a 24h status to a specific group. Throws on failure. */
export const sendGroupStatus = async (sock: WASocket, chat: string, input: GroupStatusInput): Promise<string> => {
  const content = wrapGroupStatus(await buildInner(sock, input))
  const msg = generateWAMessageFromContent(chat, content, {
    userJid: sock.user?.id ?? '',
    messageId: generateGroupStatusId(),
  })
  if (!msg.message || typeof msg.key.id !== 'string') throw new Error('groupStatus: gagal generate pesan')
  return sock.relayMessage(chat, msg.message, {
    messageId: msg.key.id,
    // server accepts the payload without this but nothing shows on members'
    // phones (Baileys#2903) — the same node is what makes an admin revoke work
    additionalNodes: [{ tag: 'meta', attrs: { is_group_status: 'true', origin: 'group_status' } }],
  })
}
