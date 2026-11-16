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
const LIST_MAX = 400 // recursive @ls entry cap

// Off limits: secrets, runtime state, dependencies, build output.
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

// Writes are limited to code, tests, and docs. No deps, config, or runtime state.
const WRITE_DIRS = ['src/', 'test/']
const WRITE_FILES = new Set(['README.md', 'README.id.md', 'README.ja.md', 'AGENTS.md', 'CONTRIBUTING.md', 'flowchart.md'])

const canWrite = (rel: string): boolean => WRITE_DIRS.some((d) => rel.startsWith(d)) || WRITE_FILES.has(rel)

// Text files worth grepping. Binaries are skipped instead of flooding output.
const TEXT_EXT = new Set(['.ts', '.js', '.mjs', '.cjs', '.json', '.md', '.yml', '.yaml', '.sh', '.rs', '.toml', '.html', '.css', '.txt'])

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

/** Repo-relative form of a user/tool path; throws on escapes and blocked paths. */
export const resolveRepoRel = (root: string, input: string): string => normalizeRel(root, input)

/** Secrets and runtime state that must never be read, written or sent. */
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
  remove(rel: string): Promise<string>
  gitStatus(): Promise<string>
  typecheck(): Promise<{ ok: boolean; text: string }>
  test(pattern?: string): Promise<{ ok: boolean; text: string }>
  written(): string[]
  rollback(): Promise<string[]>
  dispose(): Promise<void>
}

export const createFileTools = async (repoRoot = REPO_ROOT): Promise<FileTools> => {
  const root = await realpath(repoRoot).catch(() => resolve(repoRoot))
  const backupDir = await mkdtemp(join(tmpdir(), 'wakaru-agent-'))
  const backups = new Map<string, string | null>() // rel -> saved copy, null = new file

  const absOf = (rel: string): string => (rel ? join(root, rel) : root)

  // recursive @ls: one call for the whole subtree, so folder counts are exact
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
        // folders first, then alphabetical. Same order the tree renders.
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
    const abs = absOf(safe)
    await assertInside(root, abs)
    const st = await stat(abs)
    if (!st.isFile()) throw new AgentPathError(`not a file: ${safe}`)
    if (st.size > 2_000_000) throw new AgentPathError(`file too large: ${safe} (${st.size} bytes)`)
    const buf = await readFile(abs)
    if (buf.subarray(0, 8000).includes(0)) throw new AgentPathError(`binary file: ${safe}`)
    const text = buf.toString('utf8')
    // A partial read must never be treated as the whole file when writing.
    return text.length > READ_MAX
      ? text.slice(0, READ_MAX) + '\n[... TRUNCATED: never write this file from a partial read - grep the exact lines instead]'
      : text
  }

  const grep = async (pattern: string): Promise<string> => {
    const src = String(pattern ?? '').trim()
    if (!src) throw new AgentPathError('empty grep pattern')
    if (src.length > 200) throw new AgentPathError('grep pattern too long')
    let re: RegExp
    try {
      re = new RegExp(src)
    } catch {
      throw new AgentPathError('invalid regex')
    }
    const out: string[] = []
    let scanned = 0
    const walk = async (dir: string): Promise<void> => {
      if (out.length >= GREP_MATCH_MAX || scanned >= GREP_FILES_MAX) return
      const ents = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const e of ents) {
        if (out.length >= GREP_MATCH_MAX || scanned >= GREP_FILES_MAX) return
        const abs = join(dir, e.name)
        const rel = relOf(root, abs)
        // hidden dirs are local tooling/state, never source
        if (e.name.startsWith('.') || isDenied(rel)) continue
        if (e.isDirectory()) {
          await walk(abs)
          continue
        }
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
    if (!canWrite(safe)) throw new AgentPathError(`write not allowed: ${safe} (only src/, test/, docs)`)
    if (typeof content !== 'string') throw new AgentPathError('missing content')
    if (!content.trim()) throw new AgentPathError(`refusing to write an empty file: ${safe} (use @rm to delete)`)
    const bytes = Buffer.byteLength(content)
    if (bytes > WRITE_MAX) throw new AgentPathError(`content too large: ${bytes} bytes (max ${WRITE_MAX})`)
    if (!backups.has(safe) && backups.size >= MAX_FILES_WRITTEN) {
      throw new AgentPathError(`write limit reached (${MAX_FILES_WRITTEN} files)`)
    }
    const abs = absOf(safe)
    await assertInside(root, abs)
    if (!backups.has(safe)) {
      const exists = await stat(abs).then((s) => s.isFile()).catch(() => false)
      if (exists) {
        const copy = join(backupDir, safe.replace(/[\\/]/g, '__'))
        await cp(abs, copy)
        backups.set(safe, copy)
      } else {
        backups.set(safe, null)
      }
    }
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
    return `wrote ${safe} (${bytes} bytes)`
  }

  const remove = async (rel: string): Promise<string> => {
    const safe = normalizeRel(root, rel)
    if (!safe) throw new AgentPathError('empty path')
    if (!canWrite(safe)) throw new AgentPathError(`delete not allowed: ${safe} (only src/, test/, docs)`)
    if (!backups.has(safe) && backups.size >= MAX_FILES_WRITTEN) {
      throw new AgentPathError(`file limit reached (${MAX_FILES_WRITTEN} files)`)
    }
    const abs = absOf(safe)
    await assertInside(root, abs)
    const st = await stat(abs).catch(() => null)
    if (!st) throw new AgentPathError(`not found: ${safe}`)
    if (!st.isFile()) throw new AgentPathError(`not a file: ${safe} (delete files only)`)
    if (!backups.has(safe)) {
      // Keep a copy so a failed verification can bring the file back.
      const copy = join(backupDir, safe.replace(/[\\/]/g, '__'))
      await cp(abs, copy)
      backups.set(safe, copy)
    }
    await rm(abs, { force: true })
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
    return restored
  }

  const dispose = async (): Promise<void> => {
    await rm(backupDir, { recursive: true, force: true }).catch(() => {})
  }

  return { root, list, read, grep, write, remove, gitStatus, typecheck, test, written, rollback, dispose }
}

export const AGENT_RULES = `REPO ACCESS - ENABLED in this chat. The user is the bot owner.
How it works: you write raw marker lines; the bot executes them and sends the
real output back in the next message. You are not calling an API yourself.
This is the same mechanism as @run. Never say access is unavailable.
Emit bare marker lines yourself - never wrap them in backticks/bullets and
never tell the user to type them. You run the tools, the user just sees results.

Tools - one per line, at the start of a line, no markdown around them:
@read <path>       read a text file
@ls <path>         list one directory (empty = repo root)
@ls -r <path>      list a whole subtree in ONE call (use it for repo structure)
@grep <regex>      search text files
@write <path>      the next fenced block is the FULL new file content
@rm <path>         delete one file (never empty a file to "remove" it)
@send <path>       send a file into this chat; a folder is zipped and sent
@typecheck         run tsc --noEmit and see the real errors
@test [pattern]    run node:test (default: all tests)
@done <summary>    finish; this summary is sent to the user

Rules:
- For any code change, your FIRST line must be a tool call (usually @read or @ls).
  Do not reply with a plan or "let me check" before reading the files.
- Read before you write. Keep edits small and match the existing style.
- Writable/deletable: src/, test/, docs. Never touch config.json, sessions/, data/, .git, or deps.
- To remove a feature, delete its file with @rm. Never replace it with an empty file.
- No new dependencies. No shell commands other than typecheck/test.
- After writing, run @typecheck and fix real errors. Then run @test when behaviour changed.
- Command files end with \`} satisfies Command\`; without it tsc fails (TS7006).
- If @typecheck or @test says FAILED, fix it first. Never call @done while it fails.
- One tool call per line. Never guess file contents - @read or @grep first.
- If the user only asks a question, answer normally (no repo tools needed).
- The user does NOT see raw tool output — only your final text. When the answer
  IS the tool output (a folder listing, file contents, errors), paste the real
  lines/paths into your reply. A summary like "sudah diperiksa" without the
  paths is a failure: the user asked to see them.
- For directory listings, copy paths verbatim from @ls output; never invent or merge subdirs; format as a tree.
- For "struktur repo / semua folder", run @ls -r . once instead of @ls per subfolder;
  its output is complete, so file counts per folder are exact.
- That is only for requests to SEE the structure. When the user asks HOW or WHY
  something works ("jelasin", "kenapa", "kok bisa"), @read the files that do it
  and explain in prose - never answer an explanation question with a tree.
- EXPLAINING THIS REPO IS A TOOL TASK: before explaining how the agent, the
  routing, a handler, a command or a config works, @read the real files that
  implement it (@grep first if you do not know the path) and name the actual
  files/functions you saw. Never explain from assumptions, from this rule or
  from a folder listing; if the code does not show it, say what you could not
  find instead of inventing a mechanism.
- "If the user only asks a question, answer normally" covers general chat.
  Questions about THIS repo still start with @read / @grep.
- When the user asks to GET a file or folder ("kirim", "kirimin filenya", "minta
  file X", "send me the folder"), run @send <path>: a file arrives as a document,
  a folder arrives as a .zip. Send only what was asked - config.json, .env,
  sessions/ and data/ are blocked and must never be sent.

Example reply:
@read src/commands/index.ts
@ls src/commands/main
@write src/commands/main/hello.ts
\`\`\`ts
export default {
  name: 'hello',
  run: async (ctx) => { await ctx.reply('hi') },
} satisfies Command
\`\`\`
@typecheck
@done added the hello command`

// No tool line in a repo reply only looks fishy before ANY tool ran.
// Read-only asks (list a folder, read a file) end as prose using words like
// "struktur" or "daftar". Once real output came back, those words are not a lie.
const REPO_STALL =
  /(akses|access|tidak bisa|nggak bisa|belum (?:bisa|tersedia)|let me|aku cek|saya cek|akan (?:aku|saya) cek|i'?ll (?:check|look)|i will (?:check|look))/i
const REPO_CLAIM =
  /(sudah|udah|telah)\s+(?:aku\s+)?(?:hapus|bikin|buat|tambah|ubah|ganti|benerin|perbaiki|delete|remove|inventaris|listing|daftar|tampilkan|tunjukkan|periksa|cek|beres)|\b(?:dihapus|dibuat|ditambah|diubah|diperbaiki|diperiksa|deleted|removed|fixed|patched|beres|inventaris|listing|daftar|struktur|periksa|ditemukan|dikelilingi|terdalam|tersisa)\b/i
const REPO_LISTING = /(inventaris|listing|daftar|struktur|folder|direktori|directory|tree)/i

export type RepoNudge = 'stall' | 'listing' | 'claim'

/** Why a repo-mode reply without tool lines should be pushed back, if at all. */
export const repoNudge = (reply: string, toolsRun: number): RepoNudge | null => {
  if (toolsRun > 0) return null
  // a claim beats the stall words: "sudah aku cek" is a lie, not a promise
  if (REPO_CLAIM.test(reply)) return REPO_LISTING.test(reply) ? 'listing' : 'claim'
  if (REPO_STALL.test(reply)) return 'stall'
  return null
}

// "show me the folders": the reply has to contain the real paths.
// Must NOT fire on "cek folder ... jelasin dong". That asks for an explanation,
// and appending a tree there buries the real answer.
const LISTING_ASK =
  /\b(?:tunjuk(?:in|kan)?|tampil(?:in|kan)?|lihat(?:in|kan)?|liat|show|kasih|kasi|kirim|send|cetak|print|gambarin|gambarkan)\b[^\n]{0,25}\b(?:(?:folder|direktori|directory)(?:nya|mu|ku)?|struktur|structure|tree|repo(?:nya)?|isi\s+repo)\b|\b(?:struktur|structure)\b[^\n]{0,15}\b(?:(?:folder|direktori|directory)(?:nya|mu|ku)?|repo(?:nya)?|project|proyek|kode|code)\b|\b(?:daftar|list)\s+(?:file|(?:folder|direktori)(?:nya|mu|ku)?|directory)\b|\bisi\s+(?:repo|(?:folder|direktori)(?:nya|mu|ku)?|project|proyek)\b|\b(?:repo|project|proyek)\s+(?:ini\s+)?(?:isinya|struktur|apa\s+saja)\b|\btree\b|(?:cek|check|periksa)\s+(?:(?:folder|direktori|directory)(?:nya|mu|ku)?|struktur|tree)\b/i

// "kenapa / gimana / jelasin / kok bisa" = an explanation, not a listing.
const LISTING_EXPLAIN =
  /(jelas(?:in|kan)|explain|kenapa|mengapa|kok\s+bisa|gimana|bagaimana|why\b|how\s+(?:do|does|to)|maksudnya|artinya|fungsinya|kegunaan|cara\s+kerja)/i

export const asksForListing = (text: string): boolean => {
  const t = String(text ?? '')
  return !LISTING_EXPLAIN.test(t) && LISTING_ASK.test(t)
}

interface TreeDir {
  dirs: Map<string, TreeDir>
  files: Set<string>
}

const newDir = (): TreeDir => ({ dirs: new Map(), files: new Set() })

/** Render repo-relative paths as a nested tree: `src/ (2 file)` `├── commands/ (1 file)` `└── index.ts`. */
export const renderTree = (entries: Array<{ path: string; dir: boolean }>): string => {
  const root = newDir()
  for (const e of entries) {
    const parts = String(e.path).split('/').filter(Boolean)
    if (!parts.length) continue
    let cur = root
    for (const name of parts.slice(0, -1)) {
      let next = cur.dirs.get(name)
      if (!next) {
        next = newDir()
        cur.dirs.set(name, next)
      }
      cur = next
    }
    const leaf = parts[parts.length - 1]
    if (e.dir) {
      if (!cur.dirs.has(leaf)) cur.dirs.set(leaf, newDir())
    } else {
      cur.files.add(leaf)
    }
  }

  // files anywhere under a folder, so "src/ (35 file)" means the whole subtree
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

/** Every path mentioned by a batch of @ls outputs (`[ls x]` + `d/f <path>` lines). */
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

/**
 * The model often answers a listing request with "all folders checked" and the
 * user never sees a single path. If its final text does not actually contain the
 * listed paths, append the real structure as a tree so it still arrives.
 */
export const ensureListingShown = (text: string, outputs: string[]): string => {
  const entries = lsEntries(outputs)
  const tree = renderTree(entries)
  if (!tree) return text
  // the reply already shows most of them: it answered properly, leave it alone
  if (entries.filter((e) => text.includes(e.path)).length >= Math.ceil(entries.length * 0.6)) return text
  return `${text.trim()}\n\n*struktur folder (dari @ls):*\n\`\`\`txt\n${clip(tree, 6000)}\n\`\`\``.trim()
}

export type AgentAction =
  | { tool: 'read' | 'ls' | 'grep' | 'test'; arg: string }
  | { tool: 'typecheck'; arg: '' }
  | { tool: 'write'; arg: string; content: string }
  | { tool: 'rm'; arg: string }
  | { tool: 'send'; arg: string }
  | { tool: 'done'; arg: string }

export const runAgentAction = async (tools: FileTools, a: AgentAction): Promise<string> => {
  try {
    if (a.tool === 'read') return `[read ${a.arg}]\n${await tools.read(a.arg)}`
    if (a.tool === 'ls') {
      const rec = /^(?:-r|--recursive)\s*(.*)$/i.exec(a.arg)
      const path = rec ? rec[1].trim() : a.arg
      return `[ls ${rec ? '-r ' : ''}${path || '.'}]\n${await tools.list(path, !!rec)}`
    }
    if (a.tool === 'grep') return `[grep ${a.arg}]\n${await tools.grep(a.arg)}`
    if (a.tool === 'write') return `[write] ${await tools.write(a.arg, a.content)}`
    if (a.tool === 'rm') return `[rm] ${await tools.remove(a.arg)}`
    // @send needs the live chat; the bot intercepts it before reaching here.
    if (a.tool === 'send') return `[send] error: no chat session`
    if (a.tool === 'typecheck') {
      const r = await tools.typecheck()
      return `[typecheck] ${r.ok ? 'ok' : 'FAILED'}\n${r.text}`
    }
    if (a.tool === 'test') {
      const r = await tools.test(a.arg)
      return `[test] ${r.ok ? 'ok' : 'FAILED'}\n${r.text}`
    }
    return `[done] ${a.arg}`
  } catch (err) {
    return `[${a.tool}] error: ${(err as Error).message}`
  }
}

// Tolerate models that decorate markers: bullets, numbering, bold/backticks.
const CMD =
  /^\s*(?:[-*+>]\s+|\d+[.)]\s+)?[`*_~]*@(read|ls|grep|write|rm|delete|send|test|typecheck|done)\b[`*_~]*\s*(.*)$/i
const FENCE = /^\s*`{3,}\s*[a-z0-9+#_-]*\s*$/i

/** Parse `@tool` lines. `@write` takes its body from the next fenced block. */
export const parseAgentActions = (text: string): { actions: AgentAction[]; prose: string } => {
  const lines = String(text ?? '').split(/\r?\n/)
  const actions: AgentAction[] = []
  const prose: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = CMD.exec(lines[i])
    if (!m) {
      prose.push(lines[i])
      continue
    }
    const tool = m[1].toLowerCase()
    const arg = (m[2] ?? '').trim().replace(/^[`*_~]+|[`*_~]+$/g, '').trim()
    if (tool === 'write') {
      let j = i + 1
      while (j < lines.length && !lines[j].trim() && j - i <= 2) j++
      if (!FENCE.test(lines[j] ?? '')) {
        prose.push(lines[i])
        continue
      }
      const body: string[] = []
      j++
      while (j < lines.length && !FENCE.test(lines[j])) body.push(lines[j++])
      actions.push({ tool: 'write', arg, content: body.join('\n') })
      i = j
      continue
    }
    if (tool === 'typecheck') actions.push({ tool: 'typecheck', arg: '' })
    else if (tool === 'delete') actions.push({ tool: 'rm', arg })
    else actions.push({ tool: tool as 'read' | 'ls' | 'grep' | 'rm' | 'send' | 'test' | 'done', arg })
  }
  return { actions, prose: prose.join('\n').replace(/\n{3,}/g, '\n\n').trim() }
}
