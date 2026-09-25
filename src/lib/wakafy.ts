import { UA, fetchBuffer } from './http.ts'

// the direct+meta contract every media endpoint speaks: one JSON shape for
// singles, carousels, and story trays — per-item CDN links, never buffers
export interface WakafyItem {
  index: number
  kind: string
  status: string
  cdn_url?: string
  reason?: string
}

export interface WakafyMeta {
  title?: string
  kind?: string
  items?: WakafyItem[]
  error?: string
}

export type WakafyMedia = { type: 'video' | 'image' | 'audio'; buf: Buffer }

// tiny SDK for our own API — auth, errors, and titles handled once here,
// callers just pick json (metadata), file (bytes), or media (link → files)
export const wakafy = {
  // point at local dev server with WAKAFY_BASE=http://localhost:8080
  base: process.env.WAKAFY_BASE || 'https://api.wakafy.store',

  // public free key by design (unlimited tier, no signup) — set
  // WAKAFY_API_KEY only when you own a personal key
  get key(): string {
    return process.env.WAKAFY_API_KEY || '@waka:alpha'
  },

  url(path: string, params: Record<string, string | undefined> = {}): string {
    const q = Object.entries(params)
      .filter((e): e is [string, string] => e[1] !== undefined)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    return `${this.base}${path}${q ? `?${q}` : ''}`
  },

  headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.key}`, 'User-Agent': UA }
  },

  error(status: number, snippet: string): Error {
    // server answers errors as {"error": "..."} — unwrap it so humans see the message, not raw JSON
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
        // 404/502 carry the server's message (gone post, private, throttled)
        return new Error(msg ? `wakafy: ${msg}` : `download http ${status}`)
    }
  },

  async json<T>(path: string, params: Record<string, string | undefined> = {}, opts: { timeout?: number } = {}): Promise<T> {
    const res = await fetch(this.url(path, params), {
      headers: this.headers(),
      signal: AbortSignal.timeout(opts.timeout ?? 60_000),
    })
    if (!res.ok) {
      const snippet = await res.text().then((t) => t.slice(0, 500)).catch(() => '')
      throw this.error(res.status, snippet)
    }
    return res.json() as Promise<T>
  },

  async file(
    path: string,
    params: Record<string, string | undefined> = {},
    opts: { strip?: RegExp; timeout?: number; maxBytes?: number } = {},
  ): Promise<{ buf: Buffer; title: string }> {
    // title starts as the source url, upgraded from response headers when present
    let title = params.url ?? ''
    try {
      const buf = await fetchBuffer(this.url(path, params), {
        headers: this.headers(),
        timeout: opts.timeout,
        maxBytes: opts.maxBytes,
        onHeaders: (h) => {
          const name = h.get('x-media-title') ?? h.get('content-disposition')?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1]
          if (name) {
            try {
              title = decodeURIComponent(name)
            } catch {
              title = name
            }
            // filenames arrive as "Title.mp4" — strip the ext so it reads as a caption
            if (opts.strip) title = title.replace(opts.strip, '')
          }
        },
      })
      return { buf, title }
    } catch (err) {
      // fetchBuffer throws raw "download http N" — translate via the friendly mapping above
      const m = (err as Error)?.message?.match(/^download http (\d+)(?:: ([\s\S]*))?$/)
      throw m ? this.error(Number(m[1]), m[2] ?? '') : err
    }
  },

  // the easy one: link in → files out. resolves via direct+meta (CDN links,
  // no bytes proxied through our server), then pulls each item straight
  // from the edge. one failed item never kills the rest; earlier items win
  // the total-bytes budget.
  async media(
    path: string,
    rawUrl: string,
    opts: { label?: string; timeout?: number; concurrency?: number; maxTotalMB?: number } = {},
  ): Promise<{ title: string; media: WakafyMedia[] }> {
    const label = opts.label ?? 'media'
    const meta = await this.json<WakafyMeta>(path, { url: rawUrl, direct: '1', meta: '1' }, { timeout: opts.timeout })
    // unavailable entries (private items etc.) carry a reason, not a link
    const items = meta.items?.filter((it) => it.status === 'ok' && it.cdn_url) ?? []
    if (!items.length) throw new Error(`${label}: ${meta.items?.[0]?.reason ?? meta.error ?? 'no media in response'}`)
    const title = (meta.title || rawUrl).slice(0, 500)
    const concurrency = opts.concurrency ?? 4
    const maxTotal = (opts.maxTotalMB ?? 40) * 1024 * 1024
    const media: WakafyMedia[] = []
    let total = 0
    for (let i = 0; i < items.length; i += concurrency) {
      const batch = await Promise.allSettled(
        items.slice(i, i + concurrency).map(async (it) => ({
          type: (it.kind === 'audio' ? 'audio' : it.kind === 'video' ? 'video' : 'image') as WakafyMedia['type'],
          // CDN links need no auth — no server hop (! is safe: filtered for cdn_url above)
          buf: await fetchBuffer(it.cdn_url!, { headers: { 'User-Agent': UA } }),
        })),
      )
      for (const r of batch) {
        if (r.status !== 'fulfilled') continue
        total += r.value.buf.length
        if (total > maxTotal) continue
        media.push(r.value)
      }
    }
    if (!media.length) throw new Error(`${label}: download failed`)
    return { title, media }
  },

  // no-auth liveness check — first thing to run when switching bases
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/healthz`, { signal: AbortSignal.timeout(10_000) })
      return res.ok
    } catch {
      return false
    }
  },
}

// connectivity + key check in one command:
//   WAKAFY_SELFTEST=1 node src/lib/wakafy.ts
if (process.env.WAKAFY_SELFTEST) {
  const custom = !!process.env.WAKAFY_API_KEY
  const ok = await wakafy.ping()
  console.log(`wakafy base=${wakafy.base} key=${custom ? 'custom WAKAFY_API_KEY' : 'built-in @waka:alpha (public free key)'} reachable=${ok}`)
  if (!ok) throw new Error('wakafy: API unreachable')
  // prove the key itself is accepted, not just the server alive
  const me = await wakafy.json<{ display_name?: string; plan?: string }>('/v1/auth/me')
  console.log(`wakafy login as=${me.display_name ?? '?'} plan=${me.plan ?? '?'} (forest = unlimited free key)`)
  // let sockets drain first — instant exit trips a libuv teardown race on Windows
  await new Promise((r) => setTimeout(r, 200))
  process.exit(0)
}
