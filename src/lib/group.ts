import type { GroupParticipant } from 'baileys'
import { isOwner } from './config.ts'
import { t } from './lang.ts'

type Meta = { participants: GroupParticipant[] }

export const participantMaps = (met: Meta) => {
  const byNumber = new Map<string, string>()
  const byPart = new Map<string, GroupParticipant>()
  for (const p of met.participants) {
    const sendJid = p.phoneNumber ?? p.id
    for (const num of [p.id, p.phoneNumber, p.lid]) {
      if (!num) continue
      const n = num.split('@')[0]
      byNumber.set(n, sendJid)
      byPart.set(n, p)
    }
  }
  return { byNumber, byPart }
}

export const resolveTargets = (met: Meta, targets: string[]): string[] => {
  const { byNumber } = participantMaps(met)
  const out: string[] = []
  for (const tgt of targets) {
    const jid = byNumber.get(tgt.split('@')[0])
    if (jid && !out.includes(jid)) out.push(jid)
  }
  return out
}

export const groupGuards = async (ctx: CommandContext): Promise<{ met: Meta } | undefined> => {
  const met = await ctx.sock.groupMetadata(ctx.chat).catch(() => undefined)
  if (!met) {
    await ctx.reply(t('kickFailed', { msg: 'groupMetadata' }))
    return undefined
  }
  const { byPart } = participantMaps(met)
  const senderP = byPart.get(ctx.sender.split(/[@:]/)[0])
  const botNum = ctx.sock.user?.id?.split(':')[0].split('@')[0]
  const botP = botNum ? byPart.get(botNum) : undefined
  if (!isOwner(ctx.sender) && !senderP?.admin) {
    await ctx.reply(t('kickAdminOnly'))
    return undefined
  }
  if (!botP?.admin) {
    await ctx.reply(t('kickBotNotAdmin'))
    return undefined
  }
  return { met }
}
