import { isOwner } from '../../lib/config.ts'
import { t } from '../../lib/lang.ts'

export default {
  name: 'kick',
  desc: 'kick a member from the group (tag or reply)',
  aliases: ['tendang', 'keluarkan'],
  run: async (ctx: CommandContext) => {
    if (!ctx.isGroup) return ctx.reply(t('groupOnly'))

    const met = await ctx.sock.groupMetadata(ctx.chat).catch(() => undefined)
    if (!met) return ctx.reply(t('kickFailed', { msg: 'groupMetadata' }))

    // metadata may carry a participant as PN or LID (id / phoneNumber / lid),
    // and a mention may arrive as PN or as an unresolved LID — key every number
    const byNumber = new Map<string, string>()
    const byPart = new Map<string, (typeof met.participants)[number]>()
    for (const p of met.participants) {
      // send PN when known — groupParticipantsUpdate expects a phone jid, not @lid
      const sendJid = p.phoneNumber ?? p.id
      for (const num of [p.id, p.phoneNumber, p.lid]) {
        if (!num) continue
        const n = num.split('@')[0]
        byNumber.set(n, sendJid)
        byPart.set(n, p)
      }
    }

    // mentionedJid stays raw (PN or LID); quoted.sender is PN from the boundary
    const targets = [...ctx.mentionedJid, ...(ctx.quoted?.sender ? [ctx.quoted.sender] : [])]
    if (!targets.length) return ctx.reply(t('kickUsage', { prefix: ctx.prefix }))

    const resolved: string[] = []
    for (const tgt of targets) {
      const jid = byNumber.get(tgt.split('@')[0])
      if (jid && !resolved.includes(jid)) resolved.push(jid)
    }
    if (!resolved.length) return ctx.reply(t('kickNotFound'))

    // only owner or group admins may kick; the bot itself needs admin rights
    const senderNum = ctx.sender.split(/[@:]/)[0]
    const botNum = ctx.sock.user?.id?.split(':')[0].split('@')[0]
    const senderP = byPart.get(senderNum)
    const botP = botNum ? byPart.get(botNum) : undefined
    if (!isOwner(ctx.sender) && !senderP?.admin) return ctx.reply(t('kickAdminOnly'))
    if (!botP?.admin) return ctx.reply(t('kickBotNotAdmin'))

    try {
      const res = await ctx.sock.groupParticipantsUpdate(ctx.chat, resolved, 'remove')
      const ok = res.filter((r) => r.status === '200').length
      await ctx.reply(ok ? t('kickDone', { n: ok }) : t('kickFailed', { msg: 'status != 200' }))
    } catch (err) {
      await ctx.reply(t('kickFailed', { msg: String((err as Error)?.message ?? err).slice(0, 200) }))
    }
  },
} satisfies Command
