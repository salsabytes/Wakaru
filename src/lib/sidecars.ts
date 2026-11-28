// Build a native sidecar (sticker / audio) when bin/<name> is missing OR older
// than its source, at boot.
//
// It lives here instead of a pre-`npm start` script because the bot is not
// always started through npm: under pm2 / systemd / a bare `node src/index.ts`
// a pre-step never runs, and `bin/` is gitignored — so a `git pull` brings new
// native/*/src while the old binary keeps serving. That is how a `sticker`
// built before the `--max-ms` flag rejected every video `.ss` with its usage
// block on a deployed box while the same commit worked on a fresh machine.
//
// A failure is only a warning: the bot runs without the sidecars, the affected
// commands just answer "engine belum dibuild".
import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { logger } from './logger.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const BIN = join(ROOT, 'bin')
const win = process.platform === 'win32'

// crate → [what cargo produces, what the bot expects in bin/]
const SIDECARS = [
  { crate: 'sticker', built: 'wakaru-sticker', out: 'sticker' },
  { crate: 'audio', built: 'wakaru-audio', out: 'audio' },
]

const exe = (n: string): string => (win ? `${n}.exe` : n)

const newest = (dir: string): number => {
  let m = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    const t = e.isDirectory() ? newest(p) : statSync(p).mtimeMs
    if (t > m) m = t
  }
  return m
}

/** True when the binary predates its crate's source (or the source is gone). */
export const isStale = (bin: string, srcDir: string): boolean => {
  try {
    if (!existsSync(bin)) return true
    if (!existsSync(srcDir)) return false
    return statSync(bin).mtimeMs < newest(srcDir)
  } catch {
    return false
  }
}

// sticker.exe links libstdc++ dynamically: copied to a box without
// msys64/Git-mingw in PATH it dies with STATUS_DLL_NOT_FOUND, so ship the DLLs.
const copyDlls = (): void => {
  if (!win || existsSync(join(BIN, 'libstdc++-6.dll'))) return
  for (const d of [
    'C:/msys64/mingw64/bin',
    'C:/Program Files/Git/mingw64/bin',
    join(process.env.USERPROFILE ?? '', '.rustup', 'toolchains'),
  ]) {
    if (!existsSync(join(d, 'libstdc++-6.dll'))) continue
    for (const n of ['libstdc++-6.dll', 'libgcc_s_seh-1.dll', 'libwinpthread-1.dll']) {
      try {
        copyFileSync(join(d, n), join(BIN, n))
      } catch {
        // one missing DLL only costs the sticker sidecar
      }
    }
    return
  }
}

let done = false

/** Rebuild every sidecar that is missing or older than its source. Runs once. */
export const ensureSidecars = (): void => {
  if (done) return
  done = true

  const todo = SIDECARS.filter((s) => isStale(join(BIN, exe(s.out)), join(ROOT, 'native', s.crate, 'src')))
  if (!todo.length) return

  const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    // a stale binary still runs (old code); only a missing one kills the feature
    for (const s of todo) {
      const missing = !existsSync(join(BIN, exe(s.out)))
      logger.warn(
        missing
          ? `bin/${s.out} missing and cargo not found — .${s.out} unavailable`
          : `bin/${s.out} is older than native/${s.crate}/src and cargo is missing — using the stale build`,
      )
    }
    return
  }

  for (const s of todo) {
    const target = join(BIN, exe(s.out))
    const missing = !existsSync(target)
    logger.info(`${missing ? 'building' : 'rebuilding'} ${s.crate} sidecar — this can take a few minutes...`)
    const out = spawnSync('cargo', ['build', '--release'], { cwd: join(ROOT, 'native', s.crate), encoding: 'utf8' })
    const artifact = join(ROOT, 'native', s.crate, 'target', 'release', exe(s.built))
    if (out.error || out.status !== 0 || !existsSync(artifact)) {
      logger.warn(`${s.crate} sidecar build failed, continuing without it: ${(out.stderr ?? '').split('\n').slice(-6).join(' ')}`)
      continue
    }
    try {
      copyFileSync(artifact, target)
      if (!win) spawnSync('chmod', ['+x', target])
      if (s.crate === 'sticker') copyDlls()
      logger.info(`${s.crate} sidecar ready`)
    } catch (err) {
      logger.warn(`${s.crate} sidecar install failed:`, (err as Error).message)
    }
  }
}
