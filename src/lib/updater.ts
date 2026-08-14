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

const isBun = (): boolean =>
  (process.execPath.split(/[\\/]/).pop() ?? '').toLowerCase().startsWith('bun') || hasBin('bun')

const installDeps = (bun: boolean): void => {
  sh(bun ? 'bun' : 'npm', ['install'], 300_000)
}
const typecheck = (bun: boolean): void => {
  if (bun) sh('bun', ['run', 'typecheck'], 120_000)
  else sh('npx', ['tsc', '--noEmit'], 180_000)
}
// sticker build failure only warns — bot works without it (matches install.sh); fatal only on fresh installs where bin/ is empty
const buildSticker = (bun: boolean): void => {
  try {
    if (bun) sh('bun', ['run', 'build:sticker'], 600_000)
    else sh('npm', ['run', 'build:sticker'], 600_000)
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
  const bun = isBun()
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
        installDeps(bun)
        buildSticker(bun)
        typecheck(bun)
      } catch (err) {
        sh('git', ['checkout', oldHead])
        installDeps(bun)
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
    sh('git', ['pull', '--ff-only'])
    try {
      installDeps(bun)
      buildSticker(bun)
      typecheck(bun)
    } catch (err) {
      sh('git', ['reset', '--hard', oldHead])
      installDeps(bun)
      restore()
      return { status: 'failed', msg: (err as Error).message }
    }
    return { status: 'updated', head: sh('git', ['rev-parse', '--short', 'HEAD']) }
  } catch (err) {
    restore()
    return { status: 'failed', msg: (err as Error).message }
  }
}

// detach a fresh copy of this process so the current one can exit; returns false if spawn fails
export const relaunch = (): boolean => {
  try {
    const child = spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'ignore' })
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
