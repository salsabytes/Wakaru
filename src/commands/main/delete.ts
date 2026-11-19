import type { WAMessageKey } from 'baileys'
import { messageStore, recentByChat } from '../../lib/wa/store.ts'

// Only the bot's own messages can be deleted.
export const isOwn = (m: { key?: WAMessageKey }): boolean => !!m.key?.fromMe

// Last `n` bot messages from a recent-chat window (newest kept).
export const pickOwn = <T extends { key?: WAMessageKey }>(recent: T[], n: number): T[] =>
  recent.filter(isOwn).slice(-n)

const MAX = 50

export default {
  name: 'delete',
  desc: 'hapus pesan bot sendiri di chat ini (.delete [jumlah|all], atau reply pesannya)',
  aliases: ['del', 'hapus'],
  run: async (ctx: CommandContext) => {
    const qid = ctx.quoted?.id
    if (qid) {
      const target = messageStore.get(String(qid))
      if (!target || !isOwn(target)) return ctx.reply('cuma bisa hapus pesan bot sendiri')
      try {
        await ctx.sock.sendMessage(ctx.chat, { delete: target.key })
      } catch (err) {
        return ctx.reply(`gagal hapus: ${(err as Error)?.message ?? err}`)
      }
      return ctx.reply('pesan dihapus')
    }

    const arg = (ctx.args[0] ?? '').toLowerCase()
    const all = arg === 'all' || arg === 'semua'
    const n = all ? MAX : Math.max(1, Math.min(MAX, Number(arg) || 1))
    const targets = pickOwn(recentByChat(ctx.chat, MAX), n)
    if (!targets.length) return ctx.reply('tidak ada pesan bot untuk dihapus')

    let ok = 0
    for (const m of targets) {
      try {
        await ctx.sock.sendMessage(ctx.chat, { delete: m.key! })
        ok++
      } catch {
        // already gone / too old to revoke
      }
    }
    return ctx.reply(ok ? `${ok} pesan bot dihapus` : 'gagal hapus pesan')
  },
} satisfies Command
