// Build the audio sidecar if bin/audio is missing. Runs before `npm start`.
// Node, not bash: npm scripts on Windows go through cmd.exe, where bash may not
// exist at all. The sidecar is only the last-resort mp3 path (extract the AAC
// track from an MP4), so every failure here is a warning — never a blocked start.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BIN = join(ROOT, 'bin')
const win = process.platform === 'win32'
const exe = win ? 'audio.exe' : 'audio'
const built = win ? 'wakaru-audio.exe' : 'wakaru-audio'

const warn = (msg) => console.log(`! ${msg}: mp3 MP4-extract fallback disabled`)

const main = () => {
  if (existsSync(join(BIN, exe))) return

  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
  if (cargo.error || cargo.status !== 0) {
    warn('bin/audio missing and cargo not found')
    return
  }

  console.log('building audio sidecar (bin/audio missing)...')
  const out = spawnSync('cargo', ['build', '--release'], {
    cwd: join(ROOT, 'native', 'audio'),
    encoding: 'utf8',
  })
  try {
    mkdirSync(BIN, { recursive: true })
    writeFileSync(join(BIN, 'audio-build.log'), `${out.stdout ?? ''}${out.stderr ?? ''}`)
  } catch {
    // log is a convenience only
  }
  const artifact = join(ROOT, 'native', 'audio', 'target', 'release', built)
  if (out.error || out.status !== 0 || !existsSync(artifact)) {
    warn('audio sidecar build failed (see bin/audio-build.log)')
    return
  }
  copyFileSync(artifact, join(BIN, exe))
  if (!win) spawnSync('chmod', ['+x', join(BIN, exe)])
  console.log('audio sidecar ready')
}

main()
process.exit(0)
