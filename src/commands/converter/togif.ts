import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../../lib/logger.ts'
import { tx } from '../../lib/lang.ts'
import { isExpiredMedia } from '../../lib/media.ts'

const exec = promisify(execFile)

const BIN = join(
  import.meta.dirname, '..', '..', '..', 'bin',
  process.platform === 'win32' ? 'sticker.exe' : 'sticker',
)

const isSticker = (t?: string) => t === 'stickerMessage'

export default {
  name: 'togif',
  desc: 'convert an animated sticker back into a gif',
  aliases: ['tovideo', 'togifs'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const media = isSticker(ctx.mtype)
      ? { download: ctx.download }
      : isSticker(ctx.quoted?.mtype)
        ? ctx.quoted
        : undefined
    if (!media) return ctx.reply(await tx('togifUsage'))
    if (!existsSync(BIN)) return ctx.reply(await tx('notBuilt'))

    const dir = await mkdtemp(join(tmpdir(), 'wakaru-togif-'))
    try {
      const input = join(dir, 'sticker.webp')
      const output = join(dir, 'out.gif')
      await writeFile(input, await media.download())
      await exec(BIN, ['togif', input, output], { timeout: 60_000 })
      await ctx.sendGif(await readFile(output))
    } catch (err) {
      logger.error('togif error:', err)
      if (isExpiredMedia(err)) return ctx.reply(await tx('mediaExpired'))
      await ctx.reply(await tx('togifFailed'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
}
