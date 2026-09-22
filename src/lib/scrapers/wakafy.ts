import { UA, fetchBuffer } from './http.ts'

const BASE = 'https://api.wakafy.store'

const wakafyKey = (): string => process.env.WAKAFY_API_KEY || '@waka:alpha'

export const wakafyUrl = (path: string, params: Record<string, string | undefined> = {}): string => {
  const q = Object.entries(params)
    .filter((e): e is [string, string] => e[1] !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
  return `${BASE}${path}${q ? `?${q}` : ''}`
}

export const wakafyHeaders = (): Record<string, string> => ({ Authorization: `Bearer ${wakafyKey()}`, 'User-Agent': UA })

const cleanTitle = (name: string, strip?: RegExp): string => {
  try {
    name = decodeURIComponent(name)
  } catch {}
  return strip ? name.replace(strip, '') : name
}

export const wakafyError = (status: number, snippet: string): Error => {
  const msg = snippet.match(/"error"\s*:\s*"([^"]+)"/)?.[1] ?? snippet
  switch (status) {
    case 400:
      return new Error(msg || 'bad url')
    case 401:
      return new Error('wakafy: unauthorized (cek WAKAFY_API_KEY)')
    case 413:
      return new Error(msg || 'video too long/large')
    case 429:
      return new Error('wakafy: daily quota exceeded, resets 00:00 UTC')
    default:
      return new Error(msg ? `wakafy: ${msg}` : `download http ${status}`)
  }
}

const remapFetchError = (err: unknown): unknown => {
  const m = (err as Error)?.message?.match(/^download http (\d+)(?:: ([\s\S]*))?$/)
  return m ? wakafyError(Number(m[1]), m[2] ?? '') : err
}

export const wakafyDownload = async (
  path: string,
  url: string,
  opts: { params?: Record<string, string | undefined>; strip?: RegExp; timeout?: number; maxBytes?: number } = {},
): Promise<{ buf: Buffer; title: string }> => {
  let title = url
  try {
    const buf = await fetchBuffer(wakafyUrl(path, { url, ...opts.params }), {
      headers: wakafyHeaders(),
      timeout: opts.timeout,
      maxBytes: opts.maxBytes,
      onHeaders: (h) => {
        const name = h.get('x-media-title') ?? h.get('content-disposition')?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1]
        if (name) title = cleanTitle(name, opts.strip)
      },
    })
    return { buf, title }
  } catch (err) {
    throw remapFetchError(err)
  }
}

export const wakafyJson = async <T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> => {
  const res = await fetch(wakafyUrl(path, params), { headers: wakafyHeaders(), signal: AbortSignal.timeout(30_000) })
  if (!res.ok) {
    const snippet = await res.text().then((t) => t.slice(0, 500)).catch(() => '')
    throw wakafyError(res.status, snippet)
  }
  return res.json() as Promise<T>
}
