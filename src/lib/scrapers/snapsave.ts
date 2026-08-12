import { UA } from './http.ts'

const SNAPSAVE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/'

let snapsaveCookies = ''
export async function snapsaveHome(force = false): Promise<string> {
  if (!force && snapsaveCookies) return snapsaveCookies
  const res = await fetch('https://snapsave.app/', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`snapsave: homepage http ${res.status}`)
  snapsaveCookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  return snapsaveCookies
}

// port of snapsave's eval-packer — decodes without executing remote code
export function snapsaveUnpack(code: string): string {
  const m = code.match(
    /\(function\([^)]*\)\{[\s\S]*?\}\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,]+)\)\)\s*;?\s*$/,
  )
  if (!m) throw new Error('snapsave: unexpected response')
  const enc = m[1].slice(1, -1)
  const n = m[3].slice(1, -1)
  const e = Number(m[5])
  const t = Number(m[4])
  const sep = n[e]
  if (!sep) throw new Error('snapsave: bad packer args')
  const unpackNum = (d: string, base: number): string => {
    const digits = SNAPSAVE_ALPHABET.slice(0, base)
    const outDigits = SNAPSAVE_ALPHABET.slice(0, 10)
    let v = d.split('').reverse().reduce((a, ch, c) => {
      const idx = digits.indexOf(ch)
      return idx === -1 ? a : a + idx * Math.pow(base, c)
    }, 0)
    let k = ''
    while (v > 0) {
      k = outDigits[v % 10] + k
      v = Math.floor(v / 10)
    }
    return k || '0'
  }
  let r = ''
  for (let i = 0; i < enc.length; ) {
    let s = ''
    while (i < enc.length && enc[i] !== sep) {
      s += enc[i]
      i++
    }
    for (let j = 0; j < n.length; j++) s = s.replace(new RegExp(n[j], 'g'), String(j))
    r += String.fromCharCode(Number(unpackNum(s, e)) - t)
    i++
  }
  return decodeURIComponent((globalThis as any).escape(r))
}

export async function snapsaveAction(rawUrl: string, forceCookies = false): Promise<{ ok: boolean; status: number; text: string }> {
  const cookies = await snapsaveHome(forceCookies)
  const res = await fetch('https://snapsave.app/action.php?lang=en', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Referer: 'https://snapsave.app/',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: `url=${encodeURIComponent(rawUrl)}`,
    signal: AbortSignal.timeout(60_000),
  })
  return { ok: res.ok, status: res.status, text: res.ok ? await res.text() : '' }
}
