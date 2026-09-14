import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { logger } from '../../lib/logger.ts'
import { tx } from '../../lib/lang.ts'

const BIN = join(
  import.meta.dirname, '..', '..', '..', 'bin',
  process.platform === 'win32' ? 'sticker.exe' : 'sticker',
)

export default {
  name: 'brat',
  desc: 'brat-style meme sticker: white square, narrow black text',
  cooldown: 5,
  run: async (ctx: CommandContext) => {
    const text = ctx.text.trim()
    if (!text) return ctx.reply(await tx('bratUsage'))
    if (!existsSync(BIN)) return ctx.reply(await tx('notBuilt'))

    const dir = await mkdtemp(join(tmpdir(), 'wakaru-brat-'))
    try {
      const output = join(dir, 'brat.webp')
      await exec(BIN, ['brat', text.slice(0, 300), output], { timeout: 30_000 })
      await ctx.sendSticker(await readFile(output))
    } catch (err) {
      logger.error('brat error:', err)
      await ctx.reply(await tx('bratFailed'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
}
