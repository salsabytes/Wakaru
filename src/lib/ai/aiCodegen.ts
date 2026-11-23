import type { ChatMsg } from './llm.ts'
import type { FileTools } from './agentFiles.ts'

const CONTEXT_MAX = 5000
const BLOCKS_MAX = 8
const OUT_MAX = 1500

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) + '\n[...]' : s)

const CONTEXT_FILES = [
  'AGENTS.md',
  'package.json',
  'src/commands/index.ts',
  'src/commands/main/setlang.ts',
  'src/commands/main/menu.ts',
]

const collectRepoContext = async (tools: FileTools): Promise<string> => {
  const parts: string[] = []
  for (const rel of CONTEXT_FILES) {
    try {
      const body = await tools.read(rel)
      parts.push(`--- ${rel} ---\n${clip(body, CONTEXT_MAX)}`)
    } catch {}
  }
  try {
    const tree = await tools.list('src/commands', true)
    parts.push(`--- structure: src/commands ---\n${clip(tree, 2500)}`)
  } catch {}
  return parts.join('\n\n')
}

const OPEN = /^```[a-zA-Z0-9+#_-]*\s*(?:path|file)\s*[=:]\s*("[^"]+"|'[^']+'|\S+)\s*$/i
const OPEN_ANY = /^```([a-zA-Z0-9+#_-]*)\s*(.*)$/
const CLOSE = /^```\s*$/
const PATH_HINT = /(?:^|\s)(?:path|file)\s*[=:]\s*("[^"]+"|'[^']+'|[^\s`]+)|(?:^|\s)((?:src|test|README(?:\.[a-z]{2})?|AGENTS|CONTRIBUTING|flowchart)\S*\.(?:ts|tsx|js|mjs|cjs|md|json|ya?ml|toml|rs|sh))\s*$/i

const normPath = (p: string): string => String(p || '').replace(/^["'`]+|["'`]+$/g, '').replace(/\\/g, '/').replace(/^\.\/+/, '').trim()

export const parseFileBlocks = (text: string): Array<{ path: string; content: string }> => {
  const lines = String(text ?? '').split(/\r?\n/)
  const out = new Map<string, string>()
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    let path = ''
    const m = OPEN.exec(trimmed)
    if (m) path = normPath(m[1])
    else {
      // Fallback: accept fences where the path is near the fence header.
      const any = OPEN_ANY.exec(trimmed)
      if (!any) continue
      const hint = PATH_HINT.exec(String(any[2] || '').trim())
      if (hint) path = normPath(hint[1] || hint[2] || '')
      if (!path) {
        for (let k = i - 1; k >= 0 && k >= i - 3; k--) {
          const prev = lines[k].trim()
          if (!prev) continue
          const pm = /(?:^|\s)(?:path|file)\s*[=:]\s*("[^"]+"|'[^']+'|\S+)/i.exec(prev) || /((?:src|test)\/\S+\.(?:ts|tsx|js|mjs|cjs|md))/.exec(prev)
          if (pm) path = normPath(pm[1])
          break
        }
      }
      if (!path) continue
    }
    const body: string[] = []
    let j = i + 1
    while (j < lines.length && !CLOSE.test(lines[j].trim())) body.push(lines[j++])
    const content = body.join('\n')
    if (path && content.trim()) out.set(path, content)
    i = j
  }
  return [...out.entries()].map(([path, content]) => ({ path, content }))
}

const DELETE_RE = /^\s*(?:[-*+]\s+)?(?:delete|hapus|remove)\s+(?:path\s*[=:]\s*)?("[^"]+"|'[^']+'|\S+)\s*$/i

export const resolveDeletePath = (files: Iterable<string>, want: string): string | null => {
  const set = files instanceof Set ? files : new Set(files)
  if (set.has(want)) return want
  const base = want.split('/').pop() ?? want
  const dir = want.slice(0, Math.max(0, want.length - base.length))
  const sameBase = [...set].filter((f) => f.split('/').pop() === base)
  if (sameBase.length === 1) return sameBase[0]
  if (sameBase.length > 1) {
    const sameDir = sameBase.filter((f) => f.startsWith(dir))
    if (sameDir.length === 1) return sameDir[0]
    return null
  }
  const stem = base.replace(/\.\w+$/, '')
  const byStem = [...set].filter((f) => (f.split('/').pop() ?? '').replace(/\.\w+$/, '') === stem)
  return byStem.length === 1 ? byStem[0] : null
}

const repoFiles = async (tools: FileTools): Promise<Set<string>> => {
  const out = new Set<string>()
  for (const dir of ['src', 'test']) {
    const text = await tools.list(dir, true).catch(() => '')
    for (const line of String(text).split('\n')) {
      const m = /^f\s+(.+)$/.exec(line.trim())
      if (m) out.add(m[1].trim())
    }
  }
  return out
}

export const parseDeletes = (text: string): string[] => {
  const out: string[] = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = DELETE_RE.exec(line)
    if (!m) continue
    const p = m[1].replace(/^["']|["']$/g, '').trim()
    if (!p.includes('/') && !/\.\w+$/.test(p)) continue
    if (!out.includes(p)) out.push(p)
  }
  return out
}

const SYSTEM = (context: string): string => `You generate code for the Wakaru repo (TypeScript, Node >= 23.6, Baileys bot).
You are NOT an interactive agent. There is no plugin manager, no skill system, no separate executor, and no login. Never refuse and never say you lack access: the harness writes your files, then runs typecheck and tests.

OUTPUT FORMAT (mandatory) - every file as one fenced block with path=, full content, no placeholders or "...":
\`\`\`ts path=src/commands/main/stats.ts
<complete file content>
\`\`\`
The path= attribute is required. A normal code block without path= will be ignored. Optional last line: SUMMARY: <one sentence>

DELETE (remove files) - one bare line per file, outside any fence:
DELETE path=src/commands/main/stats.ts
Removing a feature or command means deleting its file. NEVER replace a file with "export {}", an empty stub, or a TODO. Copy the path from the structure listing; a filename-only match is allowed, but a wrong folder is rejected.

RULES:
- Only write under src/ or test/ (or README.md / AGENTS.md).
- ESM TypeScript: imports need the .ts extension, no semicolons, 2-space indent, no comments.
- No new dependencies; node builtins are fine (import os from 'node:os').
- Commands live in src/commands/<category>/<name>.ts and are auto-registered: export default { name, desc?, aliases?, run(ctx) } satisfies Command. CommandContext is global (do not import it).
- ctx.reply(text) sends text to the chat. Keep the file self-contained and small.
- Server/device specs = node:os (cpus, totalmem, freemem, type, release, arch, hostname, uptime) + process (version, uptime, memoryUsage).
- Do not touch unrelated files. If the task needs no code change, output nothing.

REPO CONTEXT:
${context}`

const buildMessages = (context: string, task: string, errors: string): ChatMsg[] => [
  { role: 'system', content: SYSTEM(context) },
  {
    role: 'user',
    content: errors
      ? `Task: ${task}\n\nPrevious attempt failed. Fix it and output the affected files again (complete content):\n${errors}`
      : `Task: ${task}`,
  },
]

export interface CodegenResult {
  ok: boolean
  text: string
  files: string[]
}

export const codegenFiles = async (o: {
  task: string
  tools: FileTools
  ask: (msgs: ChatMsg[]) => Promise<string>
  maxRounds?: number
}): Promise<CodegenResult> => {
  const context = await collectRepoContext(o.tools)
  const maxRounds = o.maxRounds ?? 3
  let errors = ''
  for (let round = 0; round < maxRounds; round++) {
    let reply = ''
    try {
      reply = await o.ask(buildMessages(context, o.task, errors))
    } catch (err) {
      return { ok: false, text: `[!] model call failed: ${(err as Error).message}`, files: [] }
    }
    const blocks = parseFileBlocks(reply).slice(0, BLOCKS_MAX)
    const deletes = parseDeletes(reply).slice(0, BLOCKS_MAX)
    if (!blocks.length && !deletes.length) {
      errors =
        'No file blocks or DELETE lines found. Output at least one code block with a path, e.g. ```ts path=src/commands/<category>/<name>.ts\n<complete file>\n``` (path= is required). Or to remove: DELETE path=src/commands/<category>/<name>.ts'
      continue
    }
    const written = blocks.map((b) => b.path)
    const known = deletes.length ? await repoFiles(o.tools) : new Set<string>()
    const resolved: string[] = []
    const missing: string[] = []
    for (const p of deletes) {
      const hit = resolveDeletePath(known, p)
      if (hit) resolved.push(hit)
      else missing.push(p)
    }
    if (missing.length) {
      const near = [...known].filter((f) => missing.some((m) => f.split('/').pop() === m.split('/').pop())).slice(0, 6)
      errors = `File not found: ${missing.join(', ')}.${near.length ? ` Existing matches: ${near.join(', ')}.` : ''} Delete an existing path only (DELETE path=<exact path>).`
      continue
    }
    const all = [...resolved, ...written]
    try {
      for (const p of resolved) await o.tools.remove(p)
      for (const b of blocks) await o.tools.write(b.path, b.content)
    } catch (err) {
      errors = `change rejected: ${(err as Error).message}`
      await o.tools.rollback()
      continue
    }
    const check = await o.tools.typecheck()
    if (!check.ok) {
      errors = `typecheck FAILED - fix real errors:\n${clip(check.text, 2500)}`
      await o.tools.rollback()
      continue
    }
    const tests = await o.tools.test()
    if (!tests.ok) {
      errors = `tests FAILED - fix real failures:\n${clip(tests.text, 2500)}`
      continue
    }
    const cmd = written.map((p) => /^src\/commands\/(?:[^/]+\/)*([^/]+)\.ts$/.exec(p)?.[1]).find(Boolean)
    return {
      ok: true,
      text: `✅ ${all.map((p) => `\`${p}\`${resolved.includes(p) ? ' (deleted)' : ''}`).join(', ')}\ntypecheck ok · tests ok${cmd ? `\nCoba \`.${cmd}\`` : ''}`,
      files: all,
    }
  }
  await o.tools.rollback()
  return {
    ok: false,
    text: `[!] Aku sudah coba ${maxRounds}× generate + verifikasi, masih gagal (repo tidak diubah):\n${clip(errors || 'unknown error', OUT_MAX)}`,
    files: [],
  }
}
