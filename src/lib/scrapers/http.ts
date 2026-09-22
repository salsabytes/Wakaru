import { execFile } from 'node:child_process'
import { botMaxDownloadMB } from '../config.ts'

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// fdown CF-challenges Node's OpenSSL fingerprint but not Windows' Schannel curl — shell out to curl
export const curl = (args: string[], timeout = 60_000): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 2 * 1024 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(`fdown: curl ${(stderr || err.message).trim()}`))
      else resolve(Buffer.from(stdout))
    })
  })

// WA caps media around ~64MB; peak RAM while downloading ≈2-3× file size
export const fetchBuffer = async (
  url: string,
  opts: { headers?: Record<string, string>; maxBytes?: number; timeout?: number; onHeaders?: (h: Headers) => void } = {},
): Promise<Buffer> => {
  const maxBytes = opts.maxBytes ?? botMaxDownloadMB() * 1024 * 1024
  const res = await fetch(url, { headers: opts.headers, signal: AbortSignal.timeout(opts.timeout ?? 300_000) })
  if (!res.ok) {
    const snippet = await res.text().then((t) => t.slice(0, 200)).catch(() => '')
    throw new Error(`download http ${res.status}${snippet ? `: ${snippet}` : ''}`)
  }
  opts.onHeaders?.(res.headers)
  const len = Number(res.headers.get('content-length'))
  if (Number.isFinite(len) && len > maxBytes) throw new Error(`file too large (${Math.round(len / 1e6)}MB > ${maxBytes / 1e6}MB max)`)
  if (!res.body) return Buffer.from(await res.arrayBuffer())
  // streaming read
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`file too large (>${maxBytes / 1e6}MB max)`)
    }
    chunks.push(value)
  }
  const buf = Buffer.concat(chunks)
  if (Number.isFinite(len) && len > 0 && buf.length < len) throw new Error(`download truncated (${buf.length}/${len} bytes)`)
  return buf
}
