import type { GroupParticipant } from 'baileys'
import { isOwner } from './config.ts'
import { tx } from './lang.ts'

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

export const isAdmin = async (ctx: CommandContext, met?: Meta): Promise<boolean> => {
  const m = met ?? (await ctx.sock.groupMetadata(ctx.chat).catch(() => undefined))
  if (!m) return false
  return !!participantMaps(m).byPart.get(ctx.sender.split(/[@:]/)[0])?.admin
}

export const isBotAdmin = async (ctx: CommandContext, met?: Meta): Promise<boolean> => {
  const m = met ?? (await ctx.sock.groupMetadata(ctx.chat).catch(() => undefined))
  if (!m) return false
  const botNum = ctx.sock.user?.id?.split(':')[0].split('@')[0]
  if (!botNum) return false
  return !!participantMaps(m).byPart.get(botNum)?.admin
}

export const groupGuards = async (ctx: CommandContext): Promise<{ met: Meta } | undefined> => {
  const met = await ctx.sock.groupMetadata(ctx.chat).catch(() => undefined)
  if (!met) {
    await ctx.reply(await tx('kickFailed', { msg: 'groupMetadata' }))
    return undefined
  }
  if (!isOwner(ctx.sender) && !ctx.isAdmin && !(await isAdmin(ctx, met))) {
    await ctx.reply(await tx('kickAdminOnly'))
    return undefined
  }
  if (!ctx.isBotAdmin && !(await isBotAdmin(ctx, met))) {
    await ctx.reply(await tx('kickBotNotAdmin'))
    return undefined
  }
  return { met }
}
