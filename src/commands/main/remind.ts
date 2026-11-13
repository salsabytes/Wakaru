import { addReminder, getDueReminders, listReminders, removeReminder } from '../../lib/reminders.ts'
import { parseDuration, formatDuration } from '../../lib/time.ts'
import { isOwner } from '../../lib/config.ts'

export default {
  name: 'remind',
  desc: 'set a reminder: .remind 10m minum obat | .remind 09:00 bangun | .remind list | .remind cancel <id>',
  aliases: ['reminder'],
  cooldown: 2,
  run: async (ctx: CommandContext) => {
    const args = ctx.args
    if (!args.length) {
      return ctx.reply('Penggunaan: .remind <waktu> <pesan>\nContoh: .remind 10m minum obat\nAtau: .remind 09:00 bangun\nLihat: .remind list\nBatal: .remind cancel <id>')
    }
    const sub = args[0].toLowerCase()
    if (sub === 'list') {
      const list = listReminders({ chat: ctx.chat })
      if (!list.length) return ctx.reply('Nggak ada pengingat aktif di chat ini.')
      const lines = list.map((r) => `#${r.id} • ${new Date(r.dueAt).toLocaleString('id-ID')} • ${r.text}`)
      return ctx.reply(lines.join('\n'))
    }
    if (sub === 'cancel' || sub === 'hapus' || sub === 'del') {
      const id = Number(args[1])
      if (!id) return ctx.reply('Kasih ID-nya. Contoh: .remind cancel 3')
      const ok = removeReminder(id, isOwner(ctx.sender) ? undefined : { chat: ctx.chat, sender: ctx.sender })
      return ctx.reply(ok ? `Pengingat #${id} dibatalkan.` : 'Nggak nemu pengingat itu.')
    }
    const when = args[0]
    const msg = args.slice(1).join(' ').trim()
    if (!msg) return ctx.reply('Kasih pesannya juga ya. Contoh: .remind 10m minum obat')
    const ms = parseDuration(when)
    if (ms === undefined) return ctx.reply('Format waktu nggak valid. Gunakan 10m, 1h30m, 2d, atau 09:00')
    const dueAt = Date.now() + ms
    const r = addReminder({ chat: ctx.chat, sender: ctx.sender, text: msg, dueAt })
    return ctx.reply(`Oke, aku bakal ingetin kamu dalam ${formatDuration(ms)} (ID: #${r.id})`)
  },
} satisfies Command
