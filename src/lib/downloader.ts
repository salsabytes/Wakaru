import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = (args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile('yt-dlp', args, { timeout: 300_000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    ),
  )

export async function download(url: string, mode: 'audio' | 'video') {
  const dir = await mkdtemp(join(tmpdir(), 'wakaru-dl-'))
  try {
    const outtmpl = join(dir, 'out.%(ext)s')

    const title = await run(['--no-playlist', '--no-warnings', '--simulate', '--print', '%(title)s', url])
      .then((s) => s.trim().split('\n').pop() || url)
      .catch(() => url)

    const args =
      mode === 'audio'
        ? ['-x', '--audio-format', 'mp3', '-f', 'bestaudio[filesize<=?50M]/bestaudio/best', '-o', outtmpl, url]
        : ['-f', 'best[ext=mp4][filesize<=?50M]/best', '--merge-output-format', 'mp4', '-o', outtmpl, url]
    await run(args)

    const files = (await readdir(dir)).filter((f) => !f.endsWith('.part') && !f.endsWith('.ytdl'))
    if (!files.length) throw new Error('yt-dlp produced no file')
    const path = join(dir, files[0])
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