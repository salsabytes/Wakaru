import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../../lib/logger.ts'
import { t } from '../../lib/lang.ts'

const BIN = join(
  import.meta.dirname, '..', '..', '..', 'bin',
  process.platform === 'win32' ? 'sticker.exe' : 'sticker',
)

const isSticker = (t?: string) => t === 'stickerMessage'

export default {
  name: 'toimg',
  desc: 'convert a sticker back into a png image',
  aliases: ['toimage'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const media = isSticker(ctx.mtype)
      ? { download: ctx.download }
      : isSticker(ctx.quoted?.mtype)
        ? ctx.quoted
        : undefined
    if (!media) return ctx.reply(t('toimgUsage'))
    if (!existsSync(BIN)) return ctx.reply(t('notBuilt'))

    const dir = await mkdtemp(join(tmpdir(), 'wakaru-toimg-'))
    try {
      const input = join(dir, 'sticker.webp')
      const output = join(dir, 'image.png')
      await writeFile(input, await media.download())
      await exec(BIN, ['timg', input, output], { timeout: 30_000 })
      await ctx.sendImage(await readFile(output))
    } catch (err) {
      logger.error('toimg error:', err)
      await ctx.reply(t('toimgFailed'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
}
