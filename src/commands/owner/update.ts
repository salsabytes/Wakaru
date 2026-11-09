import { runUpdate, relaunch } from '../../lib/updater.ts'
import { tx } from '../../lib/lang.ts'

export default {
  name: 'update',
  desc: 'check & apply updates, then restart (owner only)',
  ownerOnly: true,
  run: async (ctx: CommandContext) => {
    await ctx.reply(await tx('updateStart'))
    const res = runUpdate()
    if (res.status === 'updated') {
      await ctx.reply(await tx('updateDone', { head: res.head ?? '' }))
      if (!relaunch()) {
        await ctx.reply(await tx('updateRestartFail'))
        return
      }
      setTimeout(() => process.exit(0), 500)
      return
    }
    const msg =
      res.status === 'none'
        ? await tx('updateNone')
        : res.status === 'conflict'
          ? await tx('updateConflict')
          : await tx('updateFailed', { msg: res.msg ?? '' })
    await ctx.reply(msg)
  },
} satisfies Command
