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
