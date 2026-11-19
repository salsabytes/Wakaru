import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Tiny best-effort code sandbox (stdlib only).
 *
 * - Syntax-checks JS and inline <script> blocks from HTML (`node --check`).
 * - Can actually execute a JS snippet with a hard timeout and capped output.
 *
 * Runs in a throwaway temp dir. This is NOT a security boundary: AI-generated
 * code runs with the bot's own user, so keep the timeout and output caps small.
 */

export interface SandboxResult {
  ok: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  timedOut?: boolean
}

const OUT_MAX = 8000
const CHECK_TIMEOUT_MS = 10_000
const RUN_TIMEOUT_MS = 5_000

const clip = (s: string): string =>
  s.length > OUT_MAX ? s.slice(0, OUT_MAX) + `\n…(${s.length - OUT_MAX} chars trimmed)` : s

const runNode = (args: string[], cwd: string, timeoutMs: number): Promise<SandboxResult> =>
  new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const child = spawn(process.execPath, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout.on('data', (d: Buffer) => {
      if (stdout.length < OUT_MAX * 2) stdout += d.toString()
    })
    child.stderr.on('data', (d: Buffer) => {
      if (stderr.length < OUT_MAX * 2) stderr += d.toString()
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, exitCode: null, stdout: clip(stdout), stderr: clip(String(err)) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const exitCode = code ?? null
      const err = timedOut ? (stderr ? stderr + '\n' : '') + `[timeout after ${timeoutMs}ms]` : stderr
      resolve({ ok: !timedOut && exitCode === 0, exitCode, stdout: clip(stdout), stderr: clip(err), ...(timedOut ? { timedOut } : {}) })
    })
  })

/** Inline <script> bodies of an HTML document (external `src=` scripts skipped). */
export const extractScripts = (html: string): string[] => {
  const out: string[] = []
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (/\bsrc\s*=/i.test(m[1] ?? '')) continue
    const body = String(m[2] ?? '').trim()
    if (body) out.push(body)
  }
  return out
}

/** Absolute http(s) URLs the page pulls in (iframes, scripts, styles, media). */
export const extractResources = (html: string, max = 12): string[] => {
  const out: string[] = []
  const re = /\b(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi
  for (let m = re.exec(html); m && out.length < max; m = re.exec(html)) {
    const url = m[1]
    if (!out.includes(url)) out.push(url)
  }
  return out
}

const isPrivateHost = (host: string): boolean => {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1' || h === '0.0.0.0' || h.endsWith('.local') || h.endsWith('.internal')) return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  return a === 0 || a === 127 || a === 10 || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
}

/** Probe a URL (status, final URL, content-type). Private/loopback hosts refused. */
export const probeUrl = async (raw: string, timeoutMs = 8_000): Promise<SandboxResult> => {
  const url = String(raw ?? '').trim().split(/\s+/)[0] ?? ''
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, exitCode: null, stdout: '', stderr: 'invalid URL' }
  }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, exitCode: null, stdout: '', stderr: 'only http(s) URLs are allowed' }
  if (isPrivateHost(parsed.hostname)) return { ok: false, exitCode: null, stdout: '', stderr: 'refused: private/loopback host' }
  try {
    const res = await fetch(parsed, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'Mozilla/5.0 (Wakaru check)' },
    })
    if (res.body) void res.body.cancel().catch(() => {})
    const lines = [`status: ${res.status} ${res.statusText}`.trim()]
    if (res.url && res.url !== url) lines.push(`final url: ${res.url}`)
    const type = res.headers.get('content-type')
    if (type) lines.push(`content-type: ${type}`)
    return { ok: res.ok, exitCode: res.status, stdout: lines.join('\n'), stderr: res.ok ? '' : `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, exitCode: null, stdout: '', stderr: String((err as Error)?.message ?? err) }
  }
}

export type CheckKind = 'js' | 'html'

/** Syntax-check JS code or every inline script of an HTML document. */
export const checkCode = async (kind: CheckKind, code: string): Promise<SandboxResult> => {
  const dir = await mkdtemp(join(tmpdir(), 'wakaru-check-'))
  try {
    const scripts = kind === 'html' ? extractScripts(code) : [code]
    const resources = kind === 'html' ? extractResources(code) : []
    const note = resources.length ? `\nresources:\n${resources.map((u) => `- ${u}`).join('\n')}` : ''
    if (!scripts.length) {
      return { ok: true, exitCode: 0, stdout: ('no inline <script> to check' + note).trim(), stderr: '' }
    }
    const results: SandboxResult[] = []
    for (let i = 0; i < scripts.length; i++) {
      const file = join(dir, `check-${i}.mjs`)
      await writeFile(file, scripts[i], 'utf8')
      const r = await runNode(['--check', file], dir, CHECK_TIMEOUT_MS)
      results.push(r)
      if (!r.ok) {
        const label = scripts.length > 1 ? `script #${i + 1}: ` : ''
        return { ...r, stdout: (r.stdout + note).trim(), stderr: label + r.stderr }
      }
    }
    const ok = (scripts.length > 1 ? `${scripts.length} scripts OK` : 'syntax OK') + note
    return { ok: true, exitCode: 0, stdout: ok.trim(), stderr: '' }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Execute a JS snippet (ESM) and capture stdout/stderr/exit code. */
export const runCode = async (code: string, timeoutMs = RUN_TIMEOUT_MS): Promise<SandboxResult> => {
  const dir = await mkdtemp(join(tmpdir(), 'wakaru-run-'))
  try {
    const file = join(dir, 'main.mjs')
    await writeFile(file, code, 'utf8')
    return await runNode([file], dir, timeoutMs)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
