import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from './logger.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const BACKUP = join(ROOT, '.backup')

export const readUpdateChannel = (): 'master' | 'release' => {
  try {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8')) as { updateChannel?: unknown }
    return cfg.updateChannel === 'release' ? 'release' : 'master'
  } catch {
    return 'master'
  }
}

const sh = (cmd: string, args: string[], timeout = 120_000): string =>
  execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout }).trim()

const hasBin = (cmd: string): boolean => {
  try {
    sh(cmd, ['--version'], 10_000)
    return true
  } catch {
    return false
  }
}

const installDeps = (): void => {
  sh('npm', ['install'], 300_000)
}
const typecheck = (): void => {
  sh('npx', ['tsc', '--noEmit'], 180_000)
}
// sticker build failure only warns — bot works without it (matches install.sh); fatal only on fresh installs where bin/ is empty
// on Windows npm can't always resolve `bash` (Git/msys bash isn't on PATH), so call bash.exe via explicit path
const findBash = (): string | null => {
  if (process.platform !== 'win32') return 'bash'
  const candidates = [
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    'C:\\msys64\\usr\\bin\\bash.exe',
  ]
  for (const c of candidates) if (existsSync(c)) return c
  if (hasBin('bash')) return 'bash'
  return null
}
const buildSticker = (): void => {
  try {
    if (process.platform === 'win32') {
      const bash = findBash()
      if (!bash) {
        logger.warn('sticker build skipped: bash not found (install Git for Windows or msys2)')
        return
      }
      execFileSync(bash, [join(ROOT, 'native', 'build.sh')], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 600_000,
      })
      return
    }
    sh('npm', ['run', 'build:sticker'], 600_000)
  } catch (err) {
    logger.warn('sticker build failed, continuing:', (err as Error).message)
  }
}

const backup = (): void => {
  mkdirSync(BACKUP, { recursive: true })
  if (existsSync(join(ROOT, 'config.json'))) cpSync(join(ROOT, 'config.json'), join(BACKUP, 'config.json'))
  if (existsSync(join(ROOT, 'sessions'))) {
    cpSync(join(ROOT, 'sessions'), join(BACKUP, 'sessions'), { recursive: true, force: true })
  }
}
const restore = (): void => {
  if (existsSync(join(BACKUP, 'config.json'))) cpSync(join(BACKUP, 'config.json'), join(ROOT, 'config.json'))
  if (existsSync(join(BACKUP, 'sessions'))) {
    cpSync(join(BACKUP, 'sessions'), join(ROOT, 'sessions'), { recursive: true, force: true })
  }
}

const dirtyTree = (): boolean => sh('git', ['status', '--porcelain']).length > 0

export type UpdateResult = {
  status: 'updated' | 'none' | 'conflict' | 'failed'
  head?: string
  msg?: string
}

export const runUpdate = (): UpdateResult => {
  try {
    backup()
    const oldHead = sh('git', ['rev-parse', 'HEAD'])

    if (readUpdateChannel() === 'release') {
      sh('git', ['fetch', '--tags', 'origin'])
      const latest = sh('git', ['tag', '--sort=-v:refname'])
        .split('\n')
        .find((t) => /^v\d+\.\d+\.\d+$/.test(t))
      if (!latest) return { status: 'failed', msg: 'no release tags found' }
      let current = ''
      try {
        current = sh('git', ['describe', '--tags', '--exact-match', 'HEAD'])
      } catch {
        /* not on a tag — needs update */
      }
      if (current === latest) return { status: 'none' }
      if (dirtyTree()) return { status: 'conflict' }
      sh('git', ['checkout', latest])
      try {
        installDeps()
        buildSticker()
        typecheck()
      } catch (err) {
        sh('git', ['checkout', oldHead])
        installDeps()
        restore()
        return { status: 'failed', msg: (err as Error).message }
      }
      return { status: 'updated', head: latest }
    }

    // master channel
    sh('git', ['fetch', 'origin'])
    const behind = Number(sh('git', ['rev-list', '--count', 'HEAD..origin/master']))
    if (behind === 0) return { status: 'none' }
    if (dirtyTree()) return { status: 'conflict' }
    // tree is clean here, so reset handles diverged branches too (pull --ff-only aborts on those)
    sh('git', ['reset', '--hard', 'origin/master'])
    try {
      installDeps()
      buildSticker()
      typecheck()
    } catch (err) {
      sh('git', ['reset', '--hard', oldHead])
      installDeps()
      restore()
      return { status: 'failed', msg: (err as Error).message }
    }
    return { status: 'updated', head: sh('git', ['rev-parse', '--short', 'HEAD']) }
  } catch (err) {
    restore()
    return { status: 'failed', msg: (err as Error).message }
  }
}

// restart inside the SAME console: inherited stdio keeps the user's terminal,
// detached + ignored stdio pops a separate (hidden) window on Windows
export const relaunch = (): boolean => {
  try {
    const child = spawn(process.execPath, process.argv.slice(1), { cwd: ROOT, stdio: 'inherit' })
    child.unref()
    return true
  } catch {
    return false
  }
}

// fire-and-forget check on boot — logs when the master branch is ahead (release channel skips)
export const checkForUpdate = (): void => {
  if (readUpdateChannel() === 'release') return
  setTimeout(() => {
    try {
      sh('git', ['fetch', 'origin'], 20_000)
      const behind = Number(sh('git', ['rev-list', '--count', 'HEAD..origin/master'], 10_000))
      if (behind > 0) logger.info(`📦 ${behind} update tersedia — jalanin .update`)
    } catch {
      /* offline or no git — ignore */
    }
  }, 5_000)
}
