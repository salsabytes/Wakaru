import { logger } from './logger.ts'

const OWNER_JID = '6288218292156@s.whatsapp.net'

export type FeedbackKind = 'request' | 'report'

const TITLE: Record<FeedbackKind, string> = {
  request: '✨ Feature request',
  report: '🐞 Bug report',
}

export const feedbackTo = (): string => OWNER_JID

export const formatFeedback = (
  kind: FeedbackKind,
  text: string,
  meta: { sender: string; pushName?: string; isGroup: boolean; chat: string },
): string => {
  const num = meta.sender.split(/[@:]/)[0]
  const who = meta.pushName ? `${meta.pushName} (${num})` : num
  const where = meta.isGroup ? `group ${meta.chat}` : 'private chat'
  return `${TITLE[kind]}\n\n${text}\n\n— ${who} · ${where}`
}

// Sends a feature request or bug report straight to the owner.
export async function sendFeedback(ctx: CommandContext, kind: FeedbackKind, text: string): Promise<boolean> {
  const body = formatFeedback(kind, text, {
    sender: ctx.sender,
    pushName: ctx.pushName,
    isGroup: ctx.isGroup,
    chat: ctx.chat,
  })
  try {
    await ctx.sock.sendMessage(OWNER_JID, { text: body })
    return true
  } catch (err) {
    logger.warn('feedback send failed:', err)
    return false
  }
}
