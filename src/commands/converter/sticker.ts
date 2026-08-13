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

const isImageOrVideo = (t?: string) => t === 'imageMessage' || t === 'videoMessage'

export default {
  name: 'sticker',
  desc: 'make a sticker from a quoted photo or video',
  aliases: ['st'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {

    const media = isImageOrVideo(ctx.mtype)
      ? { mtype: ctx.mtype, download: ctx.download }
      : isImageOrVideo(ctx.quoted?.mtype)
        ? ctx.quoted
        : undefined
    if (!media) return ctx.reply(t('stickerUsage'))
    if (!existsSync(BIN)) return ctx.reply(t('notBuilt'))

    const dir = await mkdtemp(join(tmpdir(), 'wakaru-sticker-'))
    try {
      const input = join(dir, 'input.bin')
      const output = join(dir, 'sticker.webp')
      const buf = await media.download()
      await writeFile(input, buf)
      await exec(BIN, [input, output], { timeout: 30_000 })
      await ctx.sendSticker(await readFile(output))
    } catch (err) {
      logger.error('sticker error:', err)
      await ctx.reply(t('stickerFailed'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
}