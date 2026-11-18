import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..')

const READ_MAX = 24_000
const GREP_MAX = 8_000
const OUT_MAX = 12_000
const WRITE_MAX = 200_000
const MAX_FILES_WRITTEN = 16
const GREP_FILES_MAX = 3000
const GREP_MATCH_MAX = 120
const LIST_MAX = 400

const DENY_DIRS = ['.git', 'node_modules', 'sessions', 'data', 'bin', 'native/sticker/target', 'native/audio/target']
const DENY_FILES = new Set(['config.json', 'package-lock.json'])

const clean = (p: string): string => p.replace(/\\/g, '/')

const isDenied = (rel: string): boolean => {
  const r = clean(rel)
  const base = r.split('/').pop() ?? ''
  if (base === '.env' || base.startsWith('.env.')) return true
  if (DENY_FILES.has(r) || DENY_FILES.has(base)) return true
  return DENY_DIRS.some((d) => r === d || r.startsWith(d + '/'))
}

const WRITE_DIRS = ['src/', 'test/']
const WRITE_FILES = new Set(['README.md', 'README.id.md', 'README.ja.md', 'AGENTS.md', 'CONTRIBUTING.md', 'flowchart.md'])
const canWritePath = (rel: string): boolean => WRITE_DIRS.some((d) => rel.startsWith(d)) || WRITE_FILES.has(rel)

const TEXT_EXT = new Set(['.ts', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.sh', '.rs', '.toml', '.html', '.css', '.txt'])

const SH_TIMEOUT = 60_000
const SH_DENY = [
  /\b(?:sudo|doas)\b/i,
  /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|remove-item[^|;]*\s-(?:recurse|r)[^|;]*\s-(?:force|fo)\b/i,
  /\b(?:mkfs|fdisk|shutdown|reboot|halt|poweroff)\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdel\s+\/[sfq]/i,
  /\b(?:npm|pnpm|yarn)\s+(?:install|add|i)\b/i,
  /\b(?:pip|pip3|apt|apt-get|pkg|brew|choco|winget)\s+install\b/i,
  /\bgit\s+(?:push|reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--|restore\s+\.)/i,
  /config\.json|\.env|sessions\/|(?:^|[\s'"=])data\//i,
  /\/etc\/|\/root\/|\\Windows\\|(?:^|[\s'"=])~\/|\$HOME/i,
  /\b(?:curl|wget)\b[^|]*\|\s*(?:sh|bash)\b/i,
]

const clip = (s: string, max = OUT_MAX): string =>
  s.length > max ? s.slice(0, max) + `\n[... ${s.length - max} chars trimmed]` : s

const relOf = (root: string, abs: string): string => clean(relative(root, abs))

export class AgentPathError extends Error {}

const normalizeRel = (root: string, input: string): string => {
  const raw = String(input ?? '').trim().replace(/^["'`]+|["'`]+$/g, '')
  if (!raw) throw new AgentPathError('empty path')
  if (isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) throw new AgentPathError('absolute paths are not allowed')
  const abs = resolve(root, raw)
  const rel = relOf(root, abs)
  if (!rel || rel === '.') return ''
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new AgentPathError('path escapes the repo')
  if (isDenied(rel)) throw new AgentPathError(`blocked path: ${rel}`)
  return rel
}

export const resolveRepoRel = (root: string, input: string): string => normalizeRel(root, input)
export const isDeniedPath = (rel: string): boolean => isDenied(rel)

const assertInside = async (root: string, abs: string): Promise<void> => {
  const real = await realpath(abs).catch(() => null)
  const rel = real ? relOf(root, real) : relOf(root, abs)
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new AgentPathError('path escapes the repo')
}

const runCmd = async (
  cwd: string,
  file: string,
  args: string[],
  timeout: number,
): Promise<{ ok: boolean; text: string }> => {
  try {
    const { stdout, stderr } = await exec(file, args, { cwd, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
    const text = `${stdout}${stderr}`.trim()
    return { ok: true, text: clip(text || 'ok') }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    const text = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message || 'failed'
    return { ok: false, text: clip(text) }
  }
}

export interface FileTools {
  root: string
  list(rel?: string, recursive?: boolean): Promise<string>
  read(rel: string): Promise<string>
  grep(pattern: string): Promise<string>
  write(rel: string, content: string): Promise<string>
  edit(rel: string, search: string, replace: string): Promise<string>
  remove(rel: string): Promise<string>
  gitStatus(): Promise<string>
  typecheck(): Promise<{ ok: boolean; text: string }>
  test(pattern?: string): Promise<{ ok: boolean; text: string }>
  sh(command: string): Promise<{ ok: boolean; text: string }>
  written(): string[]
  rollback(): Promise<string[]>
  dispose(): Promise<void>
}

export const createFileTools = async (repoRoot = REPO_ROOT): Promise<FileTools> => {
  const root = await realpath(repoRoot).catch(() => resolve(repoRoot))
  const backupDir = await mkdtemp(join(tmpdir(), 'wakaru-agent-'))
  const backups = new Map<string, string | null>()
  const readCache = new Map<string, string>()

  const absOf = (rel: string): string => (rel ? join(root, rel) : root)

  const backupIfNeeded = async (safe: string): Promise<void> => {
    if (backups.has(safe)) return
    if (backups.size >= MAX_FILES_WRITTEN) throw new AgentPathError(`file limit reached (${MAX_FILES_WRITTEN} files)`)
    const abs = absOf(safe)
    const exists = await stat(abs).then((s) => s.isFile()).catch(() => false)
    if (exists) {
      const copy = join(backupDir, safe.replace(/[\\/]/g, '__'))
      await cp(abs, copy)
      backups.set(safe, copy)
    } else {
      backups.set(safe, null)
    }
  }

  const list = async (rel = '', recursive = false): Promise<string> => {
    const safe = String(rel ?? '').trim() ? normalizeRel(root, rel) : ''
    const abs = absOf(safe)
    await assertInside(root, abs)
    const rows: string[] = []
    const visible = (dir: string, name: string): boolean =>
      !name.startsWith('.') && !isDenied(relOf(root, join(dir, name)))
    const one = async (dir: string): Promise<string[]> =>
      (await readdir(dir, { withFileTypes: true }))
        .filter((e) => visible(dir, e.name))
        .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
        .map((e) => `${e.isDirectory() ? 'd' : 'f'} ${relOf(root, join(dir, e.name))}`)
    if (!recursive) {
      rows.push(...(await one(abs)).slice(0, 200))
    } else {
      const walk = async (dir: string): Promise<void> => {
        for (const row of await one(dir)) {
          if (rows.length >= LIST_MAX) return
          rows.push(row)
          if (row.startsWith('d ')) await walk(join(root, row.slice(2)))
        }
      }
      await walk(abs)
      if (rows.length >= LIST_MAX) rows.push(`[... stopped at ${LIST_MAX} entries, list a subfolder]`)
    }
    return rows.length ? rows.join('\n') : '(empty)'
  }

  const read = async (rel: string): Promise<string> => {
    const safe = normalizeRel(root, rel)
    if (!safe) throw new AgentPathError('empty path')
    const cached = readCache.get(safe)
    if (cached !== undefined) return cached
    const abs = absOf(safe)
    await assertInside(root, abs)
    const st = await stat(abs)
    if (!st.isFile()) throw new AgentPathError(`not a file: ${safe}`)
    if (st.size > 2_000_000) throw new AgentPathError(`file too large: ${safe} (${st.size} bytes)`)
    const buf = await readFile(abs)
    if (buf.subarray(0, 8000).includes(0)) throw new AgentPathError(`binary file: ${safe}`)
    const text = buf.toString('utf8')
    const out = text.length > READ_MAX
      ? text.slice(0, READ_MAX) + '\n[... TRUNCATED: never write/edit this file from a partial read - grep the exact lines instead]'
      : text
    readCache.set(safe, out)
    return out
  }

  const grep = async (pattern: string): Promise<string> => {
    const src = String(pattern ?? '').trim()
    if (!src) throw new AgentPathError('empty grep pattern')
    if (src.length > 200) throw new AgentPathError('grep pattern too long')
    let re: RegExp
    try { re = new RegExp(src) } catch { throw new AgentPathError('invalid regex') }
    const out: string[] = []
    let scanned = 0
    const walk = async (dir: string): Promise<void> => {
      if (out.length >= GREP_MATCH_MAX || scanned >= GREP_FILES_MAX) return
      const ents = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of ents) {
        if (out.length >= GREP_MATCH_MAX || scanned >= GREP_FILES_MAX) return
        const abs = join(dir, e.name)
        const rel = relOf(root, abs)
        if (e.name.startsWith('.') || isDenied(rel)) continue
        if (e.isDirectory()) { await walk(abs); continue }
        if (!e.isFile() || !TEXT_EXT.has(extname(e.name).toLowerCase())) continue
        const st = await stat(abs).catch(() => null)
        if (!st || st.size > 300_000) continue
        scanned++
        const text = await readFile(abs, 'utf8').catch(() => '')
        const lines = text.split(/\r?\n/)
        for (let i = 0; i < lines.length && out.length < GREP_MATCH_MAX; i++) {
          if (re.test(lines[i])) out.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
        }
      }
    }
    await walk(root)
    return clip(out.length ? out.join('\n') : 'no matches', GREP_MAX)
  }

  const write = async (rel: string, content: string): Promise<string> => {
    const safe = normalizeRel(root, rel)
    if (!safe) throw new AgentPathError('empty path')
    if (!canWritePath(safe)) throw new AgentPathError(`write not allowed: ${safe} (only src/, test/, docs)`)
    if (typeof content !== 'string') throw new AgentPathError('missing content')
    if (!content.trim()) throw new AgentPathError(`refusing to write an empty file: ${safe} (use @rm to delete)`)
    const bytes = Buffer.byteLength(content)
    if (bytes > WRITE_MAX) throw new AgentPathError(`content too large: ${bytes} bytes (max ${WRITE_MAX})`)
    const abs = absOf(safe)
    await assertInside(root, abs)
    await backupIfNeeded(safe)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
    readCache.delete(safe)
    return `wrote ${safe} (${bytes} bytes)`
  }

  const edit = async (rel: string, search: string, replace: string): Promise<string> => {
    const safe = normalizeRel(root, rel)
    if (!safe) throw new AgentPathError('empty path')
    if (!canWritePath(safe)) throw new AgentPathError(`write not allowed: ${safe} (only src/, test/, docs)`)
    if (!search) throw new AgentPathError('edit needs a SEARCH block')
    const abs = absOf(safe)
    await assertInside(root, abs)
    const st = await stat(abs).catch(() => null)
    if (!st || !st.isFile()) throw new AgentPathError(`not found: ${safe}`)
    const text = await readFile(abs, 'utf8')
    const idx = text.indexOf(search)
    if (idx === -1) throw new AgentPathError('SEARCH block not found (copy exact text from @read/@grep, including whitespace)')
    if (text.indexOf(search, idx + search.length) !== -1) throw new AgentPathError('SEARCH block not unique (include more surrounding context)')
    const next = text.slice(0, idx) + replace + text.slice(idx + search.length)
    if (!next.trim()) throw new AgentPathError(`edit would empty file: ${safe} (use @rm to delete)`)
    const bytes = Buffer.byteLength(next)
    if (bytes > WRITE_MAX) throw new AgentPathError(`result too large: ${bytes} bytes (max ${WRITE_MAX})`)
    await backupIfNeeded(safe)
    await writeFile(abs, next, 'utf8')
    readCache.delete(safe)
    return `edited ${safe} (${bytes} bytes)`
  }

  const remove = async (rel: string): Promise<string> => {
    const safe = normalizeRel(root, rel)
    if (!safe) throw new AgentPathError('empty path')
    if (!canWritePath(safe)) throw new AgentPathError(`delete not allowed: ${safe} (only src/, test/, docs)`)
    const abs = absOf(safe)
    await assertInside(root, abs)
    const st = await stat(abs).catch(() => null)
    if (!st) throw new AgentPathError(`not found: ${safe}`)
    if (!st.isFile()) throw new AgentPathError(`not a file: ${safe} (delete files only)`)
    await backupIfNeeded(safe)
    await rm(abs, { force: true })
    readCache.delete(safe)
    return `deleted ${safe}`
  }

  const gitStatus = async (): Promise<string> => {
    const status = await runCmd(root, 'git', ['status', '--short', '--branch'], 15_000)
    const diff = await runCmd(root, 'git', ['diff', '--stat'], 15_000)
    return clip([status.text, diff.text].filter(Boolean).join('\n'), 4000)
  }

  const typecheck = async (): Promise<{ ok: boolean; text: string }> => {
    const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
    const exists = await stat(tsc).catch(() => null)
    if (!exists) return { ok: false, text: 'typescript is not installed (run npm install)' }
    return runCmd(root, process.execPath, [tsc, '--noEmit'], 120_000)
  }

  const test = async (pattern?: string): Promise<{ ok: boolean; text: string }> => {
    const target = String(pattern ?? '').trim() || 'test/**/*.test.ts'
    return runCmd(root, process.execPath, ['--test', target], 180_000)
  }

  const sh = async (command: string): Promise<{ ok: boolean; text: string }> => {
    const line = String(command ?? '').trim()
    if (!line) throw new AgentPathError('empty command')
    if (line.length > 2000) throw new AgentPathError('command too long (max 2000 chars)')
    const hit = SH_DENY.find((re) => re.test(line))
    if (hit) throw new AgentPathError(`command blocked for safety: ${line.slice(0, 120)}`)
    const win = process.platform === 'win32'
    return win
      ? runCmd(root, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', line], SH_TIMEOUT)
      : runCmd(root, '/bin/sh', ['-lc', line], SH_TIMEOUT)
  }

  const written = (): string[] => [...backups.keys()]

  const rollback = async (): Promise<string[]> => {
    const restored: string[] = []
    for (const [rel, copy] of backups) {
      const abs = absOf(rel)
      if (copy) await cp(copy, abs).catch(() => {})
      else await rm(abs, { force: true }).catch(() => {})
      restored.push(rel)
    }
    backups.clear()
    readCache.clear()
    return restored
  }

  const dispose = async (): Promise<void> => {
    await rm(backupDir, { recursive: true, force: true }).catch(() => {})
  }

  return { root, list, read, grep, write, edit, remove, gitStatus, typecheck, test, sh, written, rollback, dispose }
}

export const AGENT_RULES = `REPO/WORKSPACE TOOLS - enabled for this session (owner). This is the real Wakaru repo.
How it works: you emit raw marker lines; the bot executes them and sends real output back. You are not calling an API yourself. Never say access is unavailable. Emit bare marker lines (never wrap in backticks/bullets, never tell the user to type them).

Tools - one per line, at start of line, no markdown around them:
@read <path>       read a text file
@ls <path>         list one directory (empty = repo root)
@ls -r <path>      list a whole subtree in ONE call
@grep <regex>      search text files
@status            git status + diff stat (repo state)
@search <query>    web search (only when NOT found in repo; cite URLs you use)
@fetch <url>       fetch a web page/docs as text
@edit <path>       surgical edit: next fenced block must contain <<<<<<< SEARCH / exact old text / ======= / new text / >>>>>>> REPLACE
@write <path>      next fenced block is the FULL new file content
@rm <path>         delete one file (removing a feature/command means deleting its file - never rewrite it to export {} or an empty stub)
@send <path>       send a file/folder (zipped) into this chat
@typecheck         run tsc --noEmit (real errors)
@test [pattern]    run node:test (default: all)
@sh <command>      real terminal in the repo root (60s timeout, dangerous commands blocked)
@done <summary>    finish; summary is sent to the user

Rules:
- No progress chatter ("sebentar", "aku cek dulu", "aku lanjutkan"). Bot shows steps; either send tool lines or @done when finished.
- Plan briefly if needed, then ACT. You may emit several independent read-only tools in one reply (@read/@ls/@grep/@status/@search/@fetch) to work faster.
- Read before you write/edit. Prefer @edit for small targeted changes; @write for new files or large rewrites. Keep edits small, match existing style (ESM .ts imports, no semicolons, no comments unless asked).
- Writable/deletable: src/, test/, docs only. Never touch config.json, sessions/, data/, .git, node_modules, deps. No new dependencies.
- Terminal: @sh gives a real shell in the repo root (git, npm scripts, grep, node -e, etc.). It is blocked for install/network/destructive commands. On Windows it is PowerShell (use ";" not "&&"). Prefer @typecheck/@test/@status when they fit.
- After writing, run @typecheck and fix real errors. Run @test when behaviour changed. If FAILED, fix first - never @done while failing. Rollback is automatic on verification failure.
- Command files: default export \`{ name, desc?, aliases?, run(ctx) } satisfies Command\` in src/commands/<category>/, auto-registered.
- Never guess file contents - @read/@grep first. When answer IS tool output (listing/contents/errors), include the real lines/paths in your reply.
- Explaining this repo = tool task: @read/@grep real files and name files/functions you saw. "Daftar/struktur" -> copy paths from @ls; "gimana/kenapa/cara kerja" -> explain from code, not a tree.
- Research: if missing in repo, @search/@fetch docs (cite URLs) and tell user you researched; base implementation on findings.
- Questions about THIS repo start with @read/@grep; general chat questions answer normally.`

const REPO_STALL =
  /(akses|access|tidak bisa|nggak bisa|tidak tersedia|ga tersedia|nggak tersedia|tak tersedia|belum (?:bisa|tersedia)|let me|aku cek|saya cek|akan (?:aku|saya) cek|i'?ll (?:check|look)|i will (?:check|look))/i
const REPO_CLAIM =
  /(sudah|udah|telah)\s+(?:aku\s+)?(?:hapus|bikin|buat|tambah|ubah|ganti|benerin|perbaiki|delete|remove|inventaris|listing|daftar|tampilkan|tunjukkan|periksa|cek|beres)|\b(?:dihapus|dibuat|ditambah|diubah|diperbaiki|diperiksa|deleted|removed|fixed|patched|beres|inventaris|listing|daftar|struktur|periksa|ditemukan|dikelilingi|terdalam|tersisa)\b/i
const REPO_LISTING = /(inventaris|listing|daftar|struktur|folder|direktori|directory|tree)/i

export type RepoNudge = 'stall' | 'listing' | 'claim' | 'continue'

export const repoNudge = (reply: string, toolsRun: number, unfinishedChange = false): RepoNudge | null => {
  if (unfinishedChange) return toolsRun === 0 ? 'stall' : 'continue'
  if (toolsRun > 0) return null
  if (REPO_CLAIM.test(reply)) return REPO_LISTING.test(reply) ? 'listing' : 'claim'
  if (REPO_STALL.test(reply)) return 'stall'
  return null
}

const REPO_CHANGE =
  /\b(?:bikin(?:in|kan)?|buat(?:in|kan)?|tambah(?:in|kan)?|hapus|delete|remove|buang|ubah|ganti|rename|pindah(?:in|kan)?|move|refactor|perbaiki|benerin|fix|implement(?:asikan)?|update|tulis(?:in)?|write|patch|edit)\b/i

export const wantsCodeChange = (text: string): boolean => {
  const t = String(text ?? '')
  return !asksForListing(t) && REPO_CHANGE.test(t)
}

const LISTING_ASK =
  /\b(?:tunjuk(?:in|kan)?|tampil(?:in|kan)?|lihat(?:in|kan)?|liat|show|kasih|kasi|kirim|send|cetak|print|gambarin|gambarkan)\b[^\n]{0,25}\b(?:(?:folder|direktori|directory)(?:nya|mu|ku)?|struktur|structure|tree|repo(?:nya)?|isi\s+repo)\b|\b(?:struktur|structure)\b[^\n]{0,15}\b(?:(?:folder|direktori|directory)(?:nya|mu|ku)?|repo(?:nya)?|project|proyek|kode|code)\b|\b(?:daftar|list)\s+(?:file|(?:folder|direktori)(?:nya|mu|ku)?|directory)\b|\bisi\s+(?:repo|(?:folder|direktori)(?:nya|mu|ku)?|project|proyek)\b|\b(?:repo|project|proyek)\s+(?:ini\s+)?(?:isinya|struktur|apa\s+saja)\b|\btree\b|(?:cek|check|periksa)\s+(?:(?:folder|direktori|directory)(?:nya|mu|ku)?|struktur|tree)\b/i

const LISTING_EXPLAIN =
  /(jelas(?:in|kan)|explain|kenapa|mengapa|kok\s+bisa|gimana|bagaimana|why\b|how\s+(?:do|does|to)|maksudnya|artinya|fungsinya|kegunaan|cara\s+kerja)/i

export const asksForListing = (text: string): boolean => {
  const t = String(text ?? '')
  return !LISTING_EXPLAIN.test(t) && LISTING_ASK.test(t)
}

interface TreeDir { dirs: Map<string, TreeDir>; files: Set<string> }
const newDir = (): TreeDir => ({ dirs: new Map(), files: new Set() })

export const renderTree = (entries: Array<{ path: string; dir: boolean }>): string => {
  const root = newDir()
  for (const e of entries) {
    const parts = String(e.path).split('/').filter(Boolean)
    if (!parts.length) continue
    let cur = root
    for (const name of parts.slice(0, -1)) {
      let next = cur.dirs.get(name)
      if (!next) { next = newDir(); cur.dirs.set(name, next) }
      cur = next
    }
    const leaf = parts[parts.length - 1]
    if (e.dir) { if (!cur.dirs.has(leaf)) cur.dirs.set(leaf, newDir()) }
    else cur.files.add(leaf)
  }
  const countFiles = (node: TreeDir): number => {
    let n = node.files.size
    for (const child of node.dirs.values()) n += countFiles(child)
    return n
  }
  const rows: string[] = []
  const walk = (node: TreeDir, prefix: string): void => {
    const names = [
      ...[...node.dirs.keys()].map((n): [string, boolean] => [n, true]),
      ...[...node.files].map((n): [string, boolean] => [n, false]),
    ].sort((a, b) => (a[1] === b[1] ? a[0].localeCompare(b[0]) : a[1] ? -1 : 1))
    names.forEach(([name, isDir], i) => {
      const last = i === names.length - 1
      const label = isDir ? ` (${countFiles(node.dirs.get(name)!)} file)` : ''
      rows.push(`${prefix}${last ? '└── ' : '├── '}${name}${isDir ? '/' : ''}${label}`)
      if (isDir) walk(node.dirs.get(name)!, prefix + (last ? '    ' : '│   '))
    })
  }
  walk(root, '')
  return rows.join('\n')
}

const lsEntries = (outputs: string[]): Array<{ path: string; dir: boolean }> => {
  const seen = new Map<string, { path: string; dir: boolean }>()
  for (const block of outputs) {
    for (const line of String(block ?? '').split('\n')) {
      const m = /^([df])\s+(\S.*)$/.exec(line.trim())
      if (!m) continue
      const key = `${m[1]} ${m[2]}`
      if (!seen.has(key)) seen.set(key, { path: m[2], dir: m[1] === 'd' })
    }
  }
  return [...seen.values()]
}

export const ensureListingShown = (text: string, outputs: string[]): string => {
  const entries = lsEntries(outputs)
  const tree = renderTree(entries)
  if (!tree) return text
  if (entries.filter((e) => text.includes(e.path)).length >= Math.ceil(entries.length * 0.6)) return text
  return `${text.trim()}\n\n*struktur folder (dari @ls):*\n\`\`\`txt\n${clip(tree, 6000)}\n\`\`\``.trim()
}

export type AgentAction =
  | { tool: 'read' | 'ls' | 'grep' | 'test' | 'search' | 'fetch' | 'sh'; arg: string }
  | { tool: 'status' | 'typecheck'; arg: '' }
  | { tool: 'write'; arg: string; content: string }
  | { tool: 'edit'; arg: string; search: string; replace: string }
  | { tool: 'rm' | 'send' | 'done'; arg: string }

const WEB_MAX = 12_000
const WEB_TIMEOUT = 20_000

const stripHtml = (html: string): string =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

const webFetch = async (url: string): Promise<string> => {
  const u = String(url ?? '').trim()
  if (!/^https?:\/\//i.test(u)) throw new AgentPathError('url must start with http(s)://')
  const res = await fetch(u, {
    signal: AbortSignal.timeout(WEB_TIMEOUT),
    headers: { 'User-Agent': 'WakaruBot/1.0 (+repo-agent)', Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.8' },
  })
  if (!res.ok) throw new Error(`http ${res.status}`)
  const ct = String(res.headers.get('content-type') || '')
  const raw = await res.text()
  const text = /json/i.test(ct) ? raw : /html/i.test(ct) || /<\w/i.test(raw.slice(0, 200)) ? stripHtml(raw) : raw
  return clip(text, WEB_MAX)
}

const webSearch = async (q: string): Promise<string> => {
  const query = String(q ?? '').trim()
  if (!query) throw new AgentPathError('empty search query')
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(WEB_TIMEOUT), headers: { 'User-Agent': 'WakaruBot/1.0 (+repo-agent)', Accept: 'text/html' } })
  if (!res.ok) throw new Error(`http ${res.status}`)
  const html = await res.text()
  const out: string[] = []
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < 6) {
    let link = m[1] || ''
    const ud = /uddg=([^&]+)/.exec(link)
    if (ud) try { link = decodeURIComponent(ud[1]) } catch {}
    const title = stripHtml(m[2] || '').replace(/\s+/g, ' ').trim()
    const snippet = stripHtml(m[3] || m[4] || '').replace(/\s+/g, ' ').trim()
    if (!title && !link) continue
    out.push(`- ${title}\n  ${link}${snippet ? `\n  ${snippet.slice(0, 220)}` : ''}`)
  }
  return out.length ? out.join('\n') : 'no results (try @fetch a direct docs URL, e.g. https://baileys.wiki or https://github.com/WhiskeySockets/Baileys)'
}

export const runAgentAction = async (tools: FileTools, a: AgentAction): Promise<string> => {
  try {
    if (a.tool === 'read') return `[read ${a.arg}]\n${await tools.read(a.arg)}`
    if (a.tool === 'ls') {
      const rec = /^(?:-r|--recursive)\s*(.*)$/i.exec(a.arg)
      const path = rec ? rec[1].trim() : a.arg
      return `[ls ${rec ? '-r ' : ''}${path || '.'}]\n${await tools.list(path, !!rec)}`
    }
    if (a.tool === 'grep') return `[grep ${a.arg}]\n${await tools.grep(a.arg)}`
    if (a.tool === 'search') return `[search ${a.arg}]\n${await webSearch(a.arg)}`
    if (a.tool === 'fetch') return `[fetch ${a.arg}]\n${await webFetch(a.arg)}`
    if (a.tool === 'status') return `[status]\n${await tools.gitStatus()}`
    if (a.tool === 'write') return `[write] ${await tools.write(a.arg, a.content)}`
    if (a.tool === 'edit') return `[edit] ${await tools.edit(a.arg, a.search, a.replace)}`
    if (a.tool === 'rm') {
      try {
        return `[rm] ${await tools.remove(a.arg)}`
      } catch (err) {
        const msg = (err as Error).message
        if (!/not found/i.test(msg)) throw err
        const base = a.arg.split('/').pop() ?? a.arg
        const near: string[] = []
        for (const dir of ['src', 'test']) {
          const text = await tools.list(dir, true).catch(() => '')
          for (const line of text.split('\n')) {
            const p = /^f\s+(.+)$/.exec(line.trim())?.[1]?.trim()
            if (!p || p.split('/').pop() !== base || near.includes(p)) continue
            near.push(p)
          }
        }
        throw new AgentPathError(`${msg}${near.length ? ` - existing: ${near.slice(0, 5).join(', ')} (use the exact path)` : ''}`)
      }
    }
    if (a.tool === 'send') return `[send] error: no chat session`
    if (a.tool === 'typecheck') { const r = await tools.typecheck(); return `[typecheck] ${r.ok ? 'ok' : 'FAILED'}\n${r.text}` }
    if (a.tool === 'test') { const r = await tools.test(a.arg); return `[test] ${r.ok ? 'ok' : 'FAILED'}\n${r.text}` }
    if (a.tool === 'sh') { const r = await tools.sh(a.arg); return `[sh] ${r.ok ? 'ok' : 'FAILED'} $ ${a.arg}\n${r.text}` }
    return `[done] ${a.arg}`
  } catch (err) {
    return `[${a.tool}] error: ${(err as Error).message}`
  }
}

const CMD =
  /^\s*(?:[-*+>]\s+|\d+[.)]\s+)?[`*_~]*@(read|ls|grep|search|fetch|status|write|edit|rm|delete|send|test|typecheck|done|sh|bash|shell)\b[`*_~]*\s*(.*)$/i
const FENCE = /^\s*`{3,}\s*[a-z0-9+#_-]*\s*$/i

const cleanArg = (tool: string, raw: string): string => {
  let s = String(raw ?? '').trim().replace(/^[`*_~]+|[`*_~]+$/g, '').trim()
  if (tool === 'sh' || tool === 'bash' || tool === 'shell') return s
  s = s.replace(/\s+[—–]{1,2}\s+.*$/, '').replace(/\s+--\s+.*$/, '').replace(/\s+#\s+.*$/, '').trim()
  s = s.replace(/\s+\([^)]*\)\s*$/, '').trim()
  if (/^(?:read|write|edit|rm|send)$/.test(tool)) {
    const first = s.split(/\s+/)[0] ?? ''
    if (first && first !== s) s = first
  } else if (tool === 'ls' && s !== '-r') {
    const m = /^-r\s+(\S+)/.exec(s)
    if (m) s = `-r ${m[1]}`
    else {
      const first = s.split(/\s+/)[0] ?? ''
      if (first && first !== s) s = first
    }
  }
  return s
}

const parseEditBlock = (body: string): { search: string; replace: string } | null => {
  const s = String(body ?? '')
  const sep = /\n?^={7}\s*$/m.exec(s)
  if (!sep) return null
  let search = s.slice(0, sep.index)
  let replace = s.slice(sep.index + sep[0].length).replace(/^\n/, '')
  search = search.replace(/^\s*<{7}[^\n]*\n?/, '').replace(/\n$/, '')
  replace = replace.replace(/\n?\s*>{7}[^\n]*\s*$/, '')
  return { search, replace }
}

export const parseAgentActions = (text: string): { actions: AgentAction[]; prose: string; errors: string[] } => {
  const lines = String(text ?? '').split(/\r?\n/)
  const actions: AgentAction[] = []
  const prose: string[] = []
  const errors: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = CMD.exec(lines[i])
    if (!m) { prose.push(lines[i]); continue }
    const tool = m[1].toLowerCase()
    const arg = cleanArg(tool, m[2] ?? '')
    if (tool === 'write' || tool === 'edit') {
      let fence = -1
      for (let k = i + 1; k < lines.length && k - i <= 6; k++) {
        if (FENCE.test(lines[k])) { fence = k; break }
        if (CMD.test(lines[k])) break
      }
      if (fence < 0) {
        for (let k = i + 1; k < Math.min(i + 7, lines.length); k++) {
          if (CMD.test(lines[k])) break
          if (lines[k].trim()) prose.push(lines[k])
        }
        const body = tool === 'write' ? 'full file content' : '<<<<<<< SEARCH / exact old text / ======= / new text / >>>>>>> REPLACE'
        errors.push(`@${tool} ${arg || '(no path)'}: missing fenced code block, so nothing was executed. Use exactly:\n@${tool} ${arg || '<path>'}\n\`\`\`ts\n${body}\n\`\`\``)
        continue
      }
      const body: string[] = []
      let j = fence + 1
      while (j < lines.length && !FENCE.test(lines[j])) body.push(lines[j++])
      const content = body.join('\n')
      if (tool === 'write') {
        if (!content.trim()) errors.push(`@write ${arg}: empty code block, nothing written.`)
        else actions.push({ tool: 'write', arg, content })
      } else {
        const parts = parseEditBlock(content)
        if (parts) actions.push({ tool: 'edit', arg, search: parts.search, replace: parts.replace })
        else errors.push(`@edit ${arg}: invalid block. Nothing was changed. Use <<<<<<< SEARCH / exact old text / ======= / new text / >>>>>>> REPLACE.`)
      }
      i = j
      continue
    }
    if (tool === 'typecheck' || tool === 'status') actions.push({ tool: tool as 'typecheck' | 'status', arg: '' })
    else if (tool === 'delete') actions.push({ tool: 'rm', arg })
    else if (tool === 'bash' || tool === 'shell') actions.push({ tool: 'sh', arg })
    else actions.push({ tool: tool as any, arg })
  }
  return { actions, prose: prose.join('\n').replace(/\n{3,}/g, '\n\n').trim(), errors }
}
