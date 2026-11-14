import { DEFAULT_WELCOME, setWelcome, toggleWelcome, welcomeConfig } from '../../lib/groupSettings.ts'
import { tx } from '../../lib/lang.ts'

export default {
  name: 'welcome',
  desc: 'set pesan welcome grup (kirim pp + teks). placeholder: `pp` `mention` `name` `desc` `gcname`',
  groupOnly: true,
  adminOnly: true,
  run: async (ctx: CommandContext) => {
    const raw = ctx.text.trim()
    const sub = raw.toLowerCase()

    if (!sub) {
      const c = welcomeConfig(ctx.chat)
      const status = c.on ? 'ON' : 'OFF'
      return ctx.reply(
        [
          `welcome: ${status}`,
          `template: ${c.msg}`,
          '',
          `pakai: ${ctx.prefix}welcome <teks>`,
          `matikan: ${ctx.prefix}welcome off  |  nyalakan: ${ctx.prefix}welcome on`,
          '',
          'placeholder:',
          '`pp` kirim foto profil',
          '`mention` tag member baru',
          '`name` nama/pushname member',
          '`desc` deskripsi grup',
          '`gcname` nama grup',
          'contoh: .welcome `pp` halo `mention`, selamat datang di `gcname`!',
        ].join('\n'),
      )
    }

    if (sub === 'off' || sub === 'disable' || sub === '0') {
      toggleWelcome(ctx.chat, false)
      return ctx.reply('welcome: OFF')
    }
    if (sub === 'on' || sub === 'enable' || sub === '1') {
      toggleWelcome(ctx.chat, true)
      return ctx.reply('welcome: ON')
    }
    if (sub === 'reset') {
      setWelcome(ctx.chat, DEFAULT_WELCOME)
      return ctx.reply('welcome direset ke default')
    }

    // set custom template and enable
    setWelcome(ctx.chat, raw)
    return ctx.reply('welcome disimpan & ON')
  },
} satisfies Command
