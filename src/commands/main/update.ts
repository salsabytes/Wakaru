import { runUpdate, relaunch } from '../../lib/updater.ts'
import { t } from '../../lib/lang.ts'

export default {
  name: 'update',
  desc: 'check & apply updates, then restart (owner only)',
  ownerOnly: true,
  run: async (ctx: CommandContext) => {
    await ctx.reply(t('updateStart'))
    const res = runUpdate()
    if (res.status === 'updated') {
      await ctx.reply(t('updateDone', { head: res.head ?? '' }))
      if (!relaunch()) await ctx.reply(t('updateRestartFail'))
      setTimeout(() => process.exit(0), 500)
      return
    }
    const msg =
      res.status === 'none'
        ? t('updateNone')
        : res.status === 'conflict'
          ? t('updateConflict')
          : t('updateFailed', { msg: res.msg ?? '' })
    await ctx.reply(msg)
  },
} satisfies Command
