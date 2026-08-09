import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../../lib/logger.ts'

const BIN = join(
  import.meta.dirname, '..', '..', '..', 'bin',
  process.platform === 'win32' ? 'sticker.exe' : 'sticker',
)

const isImageOrVideo = (t?: string) => t === 'imageMessage' || t === 'videoMessage'

export default {
  name: 'sticker',
  desc: 'make a sticker from a quoted photo or video',
  aliases: ['st'],
  run: async (ctx: CommandContext) => {

    const media = isImageOrVideo(ctx.mtype)
      ? { mtype: ctx.mtype, download: ctx.download }
      : isImageOrVideo(ctx.quoted?.mtype)
        ? ctx.quoted
        : undefined
    if (!media) return ctx.reply('reply to a photo/video, or send one directly with .sticker 🛸')
    if (!existsSync(BIN)) return ctx.reply('sticker engine not built — run: bun run build:sticker 🔧')

    const dir = await mkdtemp(join(tmpdir(), 'wakaru-sticker-'))
    try {
      const input = join(dir, 'input.bin')
      const output = join(dir, 'sticker.webp')
      const buf = await media.download()
      await writeFile(input, buf)
      await exec(BIN, [input, output], { timeout: 30_000 })
      await ctx.sendSticker(await readFile(output))
    } catch (err) {
      logger.error({ err }, 'sticker error:')
      await ctx.reply('sticker failed 😢')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
}