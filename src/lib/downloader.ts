import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = (args: string[]): Promise<string> =>
  exec('yt-dlp', args, { timeout: 300_000 }).then((r) => r.stdout.toString())

// audio engine: converts the raw .m4a download to mp3 (pure Rust, no ffmpeg)
const BIN = join(
  import.meta.dirname, '..', '..', 'bin',
  process.platform === 'win32' ? 'audio2mp3.exe' : 'audio2mp3',
)

export async function download(url: string, mode: 'audio' | 'video') {
  const dir = await mkdtemp(join(tmpdir(), 'wakaru-dl-'))
  try {
    const outtmpl = join(dir, 'out.%(ext)s')

    const title = await run(['--no-playlist', '--no-warnings', '--simulate', '--print', '%(title)s', url])
      .then((s) => s.trim().split('\n').pop() || url)
      .catch(() => url)

    // audio: single m4a stream (decoded to mp3 by the Rust engine — no ffmpeg)
    // video: single mp4 stream, never needs merging
    const args =
      mode === 'audio'
        ? ['-f', 'bestaudio[ext=m4a][filesize<=?50M]/bestaudio[ext=m4a]', '-o', outtmpl, url]
        : ['-f', 'best[ext=mp4][filesize<=?50M]/best[ext=mp4]', '-o', outtmpl, url]
    await run(args)

    const files = (await readdir(dir)).filter((f) => !f.endsWith('.part') && !f.endsWith('.ytdl'))
    if (!files.length) throw new Error('yt-dlp produced no file')
    const src = join(dir, files[0])
    let path = src
    if (mode === 'audio') {
      if (!existsSync(BIN)) throw new Error('audio engine not built — run: bun run build:audio 🔧')
      path = join(dir, 'out.mp3')
      await exec(BIN, [src, path], { timeout: 120_000 })
    }
    const buf = await readFile(path)
    return { dir, path, buf, title, media: mode } as const
  } catch (err) {
    await cleanup(dir)
    throw err
  }
}

export async function cleanup(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {})
}