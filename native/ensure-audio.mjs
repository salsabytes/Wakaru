// Build the audio sidecar when bin/audio is missing OR older than its source.
// Runs before `npm start`.
// Node, not bash: npm scripts on Windows go through cmd.exe, where bash may not
// exist at all. A failure here is only a warning — never a blocked start.
//
// The staleness check is the point: `bin/` is gitignored, so a `git pull` on a
// server brings new native/audio source while the old binary keeps running.
// Nothing else rebuilds it (install.sh skips a crate whose binary exists), so
// that deployed bot silently used pre-fix code — e.g. `.ss` sending a silent
// sticker while the same commit works fine on a fresh machine.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BIN = join(ROOT, 'bin')
const SRC = join(ROOT, 'native', 'audio', 'src')
const win = process.platform === 'win32'
const exe = win ? 'audio.exe' : 'audio'
const built = win ? 'wakaru-audio.exe' : 'wakaru-audio'
const target = join(BIN, exe)

const warn = (msg) => console.log(`! ${msg}: soundsticker / mp3 fallback unavailable`)

const newest = (dir) => {
  let m = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    const t = e.isDirectory() ? newest(p) : statSync(p).mtimeMs
    if (t > m) m = t
  }
  return m
}

const stale = () => {
  if (!existsSync(SRC)) return false
  return statSync(target).mtimeMs < newest(SRC)
}

const main = () => {
  const missing = !existsSync(target)
  if (!missing && !stale()) return

  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
  if (cargo.error || cargo.status !== 0) {
    // missing binary is fatal for the feature; a stale one still runs (old code)
    if (missing) warn('bin/audio missing and cargo not found')
    else console.log('! bin/audio is older than native/audio/src and cargo is missing: using the stale build')
    return
  }

  console.log(missing ? 'building audio sidecar (bin/audio missing)...' : 'rebuilding audio sidecar (source is newer)...')
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
  copyFileSync(artifact, target)
  if (!win) spawnSync('chmod', ['+x', target])
  console.log('audio sidecar ready')
}

main()
process.exit(0)
