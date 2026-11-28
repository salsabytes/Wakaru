// Build a native sidecar (sticker / audio) when bin/<name> is missing OR older
// than its source. Runs before `npm start`.
//
// Node, not bash: npm scripts on Windows go through cmd.exe, where bash may not
// exist at all. A failure here is only a warning — never a blocked start.
//
// The staleness check is the point: `bin/` is gitignored, so a `git pull` on a
// server brings new native/*/src while the old binary keeps running. Nothing
// else rebuilds it (install.sh skips a crate whose binary exists), so that
// deployed bot silently used pre-fix code: a `sticker` built before the
// `--max-ms` flag rejected every video `.ss` with its usage block, and an
// `audio` built before `soundsticker` sent a silent sticker.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const BIN = join(ROOT, 'bin')
const win = process.platform === 'win32'

// crate → [what cargo produces, what the bot expects in bin/]
const SIDECARS = [
  { crate: 'sticker', built: 'wakaru-sticker', out: 'sticker' },
  { crate: 'audio', built: 'wakaru-audio', out: 'audio' },
]

const exe = (n) => (win ? `${n}.exe` : n)

const newest = (dir) => {
  let m = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    const t = e.isDirectory() ? newest(p) : statSync(p).mtimeMs
    if (t > m) m = t
  }
  return m
}

const stale = (target, src) => existsSync(src) && statSync(target).mtimeMs < newest(src)

// sticker.exe links libstdc++ dynamically: copied to a machine without
// msys64/Git-mingw in PATH it dies with STATUS_DLL_NOT_FOUND, so ship the DLLs.
const copyDlls = () => {
  if (!win || existsSync(join(BIN, 'libstdc++-6.dll'))) return
  const dirs = [
    'C:/msys64/mingw64/bin',
    'C:/Program Files/Git/mingw64/bin',
    join(process.env.USERPROFILE ?? '', '.rustup', 'toolchains'),
  ]
  for (const d of dirs) {
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

const build = (s, haveCargo) => {
  const target = join(BIN, exe(s.out))
  const missing = !existsSync(target)

  // missing binary is fatal for the feature; a stale one still runs (old code)
  if (!haveCargo) {
    if (missing) console.log(`! bin/${s.out} missing and cargo not found: .${s.out} unavailable`)
    else console.log(`! bin/${s.out} is older than native/${s.crate}/src and cargo is missing: using the stale build`)
    return
  }

  console.log(missing ? `building ${s.crate} sidecar (bin/${s.out} missing)...` : `rebuilding ${s.crate} sidecar (source is newer)...`)
  const out = spawnSync('cargo', ['build', '--release'], { cwd: join(ROOT, 'native', s.crate), encoding: 'utf8' })
  if (s.crate === 'audio') {
    try {
      mkdirSync(BIN, { recursive: true })
      writeFileSync(join(BIN, 'audio-build.log'), `${out.stdout ?? ''}${out.stderr ?? ''}`)
    } catch {
      // log is a convenience only
    }
  }
  const artifact = join(ROOT, 'native', s.crate, 'target', 'release', exe(s.built))
  if (out.error || out.status !== 0 || !existsSync(artifact)) {
    console.log(`! ${s.crate} sidecar build failed`)
    return
  }
  copyFileSync(artifact, target)
  if (!win) spawnSync('chmod', ['+x', target])
  if (s.crate === 'sticker') copyDlls()
  console.log(`${s.crate} sidecar ready`)
}

const main = () => {
  const todo = SIDECARS.filter((s) => {
    const target = join(BIN, exe(s.out))
    return !existsSync(target) || stale(target, join(ROOT, 'native', s.crate, 'src'))
  })
  if (!todo.length) return

  const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
  const haveCargo = !probe.error && probe.status === 0
  for (const s of todo) build(s, haveCargo)
}

main()
process.exit(0)
