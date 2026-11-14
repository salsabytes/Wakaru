import { checkCode, probeUrl, runCode, type SandboxResult } from '../../../lib/agentSandbox.ts'

/**
 * Agentic verification blocks the AI can put in its reply:
 *
 *   ```check-js      syntax-check a JS snippet
 *   ```check-html    syntax-check every inline <script> of an HTML page
 *   ```check-url     probe a URL (HTTP status, final URL, content-type)
 *   ```run-js        actually execute a JS snippet (5s, output capped)
 *
 * They are stripped before the reply reaches the user; the results go back to
 * the model so it can fix problems and re-check in the same conversation.
 */

export type CheckKind = 'js' | 'html' | 'url' | 'run'
export interface Check {
  kind: CheckKind
  code: string
}

const LANGS: Record<string, CheckKind> = {
  'check-js': 'js',
  'check-html': 'html',
  'check-url': 'url',
  'run-js': 'run',
}

const OPEN = /^\s*`{3,}\s*(check-js|check-html|check-url|run-js)\s*$/i
const CLOSE = /^\s*`{3,}\s*$/

/** Split a reply into check blocks (removed) and the remaining text (kept). */
export const extractChecks = (text: string): { checks: Check[]; clean: string } => {
  const lines = String(text ?? '').split(/\r?\n/)
  const checks: Check[] = []
  const keep: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i])
    if (!open) {
      keep.push(lines[i])
      continue
    }
    const body: string[] = []
    let j = i + 1
    while (j < lines.length && !CLOSE.test(lines[j])) body.push(lines[j++])
    const code = body.join('\n').replace(/^\n+|\n+$/g, '')
    const kind = LANGS[open[1].toLowerCase()]
    if (kind && code.trim()) checks.push({ kind, code })
    i = j
  }
  const clean = keep.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { checks, clean }
}

const describe = (kind: CheckKind, r: SandboxResult): string => {
  const tag = kind === 'run' ? 'run-js' : `check-${kind}`
  const lines = [`[${tag}] exit=${r.exitCode ?? 'killed'}${r.ok ? ' (ok)' : ' (FAILED)'}`]
  if (r.stdout.trim()) lines.push(`stdout:\n${r.stdout.trim()}`)
  if (r.stderr.trim()) lines.push(`stderr:\n${r.stderr.trim()}`)
  return lines.join('\n')
}

export interface CheckResult {
  kind: CheckKind
  ok: boolean
  text: string
}

export const runChecks = async (checks: Check[]): Promise<CheckResult[]> => {
  const out: CheckResult[] = []
  for (const c of checks) {
    const r =
      c.kind === 'run'
        ? await runCode(c.code)
        : c.kind === 'url'
          ? await probeUrl(c.code)
          : await checkCode(c.kind, c.code)
    out.push({ kind: c.kind, ok: r.ok, text: describe(c.kind, r) })
  }
  return out
}

export const checkLabel = (kind: CheckKind): string =>
  kind === 'run' ? 'run-js' : kind === 'url' ? 'link' : kind

const AUTO_LANG: Record<string, 'js' | 'html'> = {
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  javascript: 'js',
  html: 'html',
  htm: 'html',
}

/**
 * Fallback for models that don't emit check blocks: syntax-check the JS/HTML
 * fences already present in the reply. Never strips anything — the code the
 * user sees stays byte-for-byte the same.
 */
export const autoChecks = (text: string, max = 3): Check[] => {
  const lines = String(text ?? '').split(/\r?\n/)
  const out: Check[] = []
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const open = /^\s*`{3,}\s*([a-z0-9+#_-]+)\s*$/i.exec(lines[i] ?? '')
    const kind = open ? AUTO_LANG[open[1].toLowerCase()] : undefined
    if (!kind) continue
    const body: string[] = []
    let j = i + 1
    while (j < lines.length && !/^\s*`{3,}\s*$/.test(lines[j] ?? '')) body.push(lines[j++] ?? '')
    i = j
    const code = body.join('\n').trim()
    if (code.length > 20) out.push({ kind, code })
  }
  return out
}
