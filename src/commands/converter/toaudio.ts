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
  process.platform === 'win32' ? 'audio.exe' : 'audio',
)

const isVideo = (t?: string) => t === 'videoMessage'

export default {
  name: 'toaudio',
  desc: 'convert a video into m4a audio',
  aliases: ['tomp3', 'tomp4a', 'toaud'],
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const media = isVideo(ctx.mtype)
      ? { download: ctx.download }
      : isVideo(ctx.quoted?.mtype)
        ? ctx.quoted
        : undefined
    if (!media) return ctx.reply(await tx('toaudioUsage'))
    if (!existsSync(BIN)) return ctx.reply(await tx('notBuilt'))

    const dir = await mkdtemp(join(tmpdir(), 'wakaru-toaudio-'))
    try {
      const input = join(dir, 'video.mp4')
      const output = join(dir, 'audio.m4a')
      await writeFile(input, await media.download())
      await exec(BIN, ['extract', input, output], { timeout: 60_000 })
      await ctx.sendAudio(await readFile(output))
    } catch (err) {
      logger.error('toaudio error:', err)
      if (isExpiredMedia(err)) return ctx.reply(await tx('mediaExpired'))
      await ctx.reply(await tx('toaudioFailed'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
}
