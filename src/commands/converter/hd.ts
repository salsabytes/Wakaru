import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../../lib/logger.ts'
import { tx } from '../../lib/lang.ts'
import { upscaleImage } from '../../lib/scrapers/upscale.ts'

const exec = promisify(execFile)

const BIN = join(
  import.meta.dirname, '..', '..', '..', 'bin',
  process.platform === 'win32' ? 'sticker.exe' : 'sticker',
)

const isImage = (t?: string) => t === 'imageMessage'

export default {
  name: 'hd',
  desc: 'upscale a photo 2x with AI (iloveimg, Rust fallback)',
  aliases: ['remini', 'upscale'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const media = isImage(ctx.mtype)
      ? { download: ctx.download }
      : isImage(ctx.quoted?.mtype)
        ? ctx.quoted
        : undefined
    if (!media) return ctx.reply(await tx('hdUsage'))
    if (!existsSync(BIN)) return ctx.reply(await tx('notBuilt'))

    const dir = await mkdtemp(join(tmpdir(), 'wakaru-hd-'))
    try {
      const buf = await media.download()
      try {
        await ctx.sendImage(await upscaleImage(buf))
        return
      } catch (err) {
        logger.error('hd api failed, rust fallback:', (err as Error).message)
      }
      const input = join(dir, 'photo.bin')
      const output = join(dir, 'hd.png')
      await writeFile(input, buf)
      await exec(BIN, ['hd', input, output], { timeout: 60_000 })
      await ctx.sendImage(await readFile(output))
    } catch (err) {
      logger.error('hd error:', err)
      await ctx.reply(await tx('hdFailed'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
}
