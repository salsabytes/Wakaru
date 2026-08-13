import { execFile } from 'node:child_process'

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export const getJson = async (url: string, headers: Record<string, string>): Promise<any> => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
  try {
    return await res.json()
  } catch {
    throw new Error(`ytmp3: non-json response (http ${res.status})`)
  }
}

// fdown CF-challenges node/bun's OpenSSL fingerprint but not Windows' Schannel curl — shell out to curl
export const curl = (args: string[], timeout = 60_000): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 64 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(`fdown: curl ${(stderr || err.message).trim()}`))
      else resolve(Buffer.from(stdout))
    })
  })

// WA video upload limit ~64MB — cap 30MB biar HP low-end gak kebanjiran RAM:
// peak per download ≈ 2-3× file size (buffer + base64 upload), × 2 slot heavy.
// 30MB masih nutup semua lagu + kebanyakan video pendek; naikin kalau butuh video panjang.
const DEFAULT_MAX_BYTES = 30 * 1024 * 1024

export const fetchBuffer = async (
  url: string,
  opts: { headers?: Record<string, string>; maxBytes?: number; timeout?: number } = {},
): Promise<Buffer> => {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const res = await fetch(url, { headers: opts.headers, signal: AbortSignal.timeout(opts.timeout ?? 300_000) })
  if (!res.ok) throw new Error(`download http ${res.status}`)
  const len = Number(res.headers.get('content-length'))
  if (Number.isFinite(len) && len > maxBytes) throw new Error(`file too large (${Math.round(len / 1e6)}MB > ${maxBytes / 1e6}MB max)`)
  if (!res.body) return Buffer.from(await res.arrayBuffer())
  // streaming read — cap tetap berlaku walau server gak ngasih content-length
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
  return Buffer.concat(chunks)
}
