import { botMaxDownloadMB } from '../config.ts'
import { fetchBuffer } from './http.ts'
import { wakafyUrl, wakafyHeaders, wakafyError } from './wakafy.ts'

const BASE = 'https://api.wakafy.store'
// API returns relative paths ("/v1/media/dl/ig_xxx.mp4") — make them absolute
const abs = (p: string): string => (p.startsWith('http') ? p : `${BASE}${p}`)

interface IgItem {
  index: number
  kind: string
  status: string
  format?: string
  size_bytes?: number
  download_url?: string
  reason?: string
}

interface IgMeta {
  title?: string
  author?: string
  kind?: string
  items?: IgItem[]
  error?: string
}

// server sends "Title.mp4" style filenames — strip the ext so it reads as a caption, not a file
const cleanTitle = (name: string): string => {
  try {
    name = decodeURIComponent(name)
  } catch {}
  return name.replace(/\.(mp4|jpg|jpeg|png|webp)$/i, '')
}

// title lives in the X-Media-Title header; content-disposition is the backup, raw url the last resort
const titleOf = (h: Headers, fallback: string): string => {
  const name = h.get('x-media-title') ?? h.get('content-disposition')?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1]
  return name ? cleanTitle(name) : fallback
}

// cap TOTAL carousel bytes too; earlier items win
const CONCURRENCY = 4
const CAROUSEL_MAX_TOTAL = 40 * 1024 * 1024

// map the API's kind/format to what WhatsApp can send (video = mp4, anything else = photo)
const kindOf = (kind: string | undefined, format: string | undefined): 'video' | 'image' =>
  kind === 'video' || format === 'mp4' ? 'video' : 'image'

export async function downloadInstagram(rawUrl: string) {
  // cold posts take minutes server-side (resolve + convert), so be patient
  const res = await fetch(wakafyUrl('/v1/media/igdl', { url: rawUrl }), {
    headers: wakafyHeaders(),
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok) {
    const snippet = await res.text().then((t) => t.slice(0, 500)).catch(() => '')
    throw wakafyError(res.status, snippet)
  }
  const ct = res.headers.get('content-type') ?? ''
  // the server decides the shape: single posts come back as file bytes,
  // carousels / story trays always come back as JSON with per-item links
  if (ct.includes('application/json')) {
    const j = (await res.json().catch(() => null)) as IgMeta | null
    // unavailable items (private photo entries etc.) carry a reason instead of a link — skip them
    const items = j?.items?.filter((it) => it.status === 'ok' && it.download_url) ?? []
    if (!items.length) throw new Error(`instagram: ${j?.items?.[0]?.reason ?? j?.error ?? 'no media in response'}`)
    const title = (j?.title || rawUrl).slice(0, 500)
    const media: { type: 'video' | 'image'; buf: Buffer }[] = []
    let total = 0
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      // one failed item shouldn't kill the whole carousel — keep whatever downloaded
      const batch = await Promise.allSettled(
        items.slice(i, i + CONCURRENCY).map(async (it) => ({
          type: kindOf(it.kind, it.format),
          buf: await fetchBuffer(abs(it.download_url!), { headers: wakafyHeaders() }),
        })),
      )
      for (const r of batch) {
        if (r.status !== 'fulfilled') continue
        total += r.value.buf.length
        if (total > CAROUSEL_MAX_TOTAL) continue
        media.push(r.value)
      }
    }
    if (!media.length) throw new Error('instagram: download failed')
    return { title, media }
  }
  // single post → bytes straight away, one request
  const maxBytes = botMaxDownloadMB() * 1024 * 1024
  // bail early on huge files before buffering anything into RAM
  const len = Number(res.headers.get('content-length'))
  if (Number.isFinite(len) && len > maxBytes) {
    await res.body?.cancel().catch(() => {})
    throw new Error(`file too large (${Math.round(len / 1e6)}MB > ${maxBytes / 1e6}MB max)`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > maxBytes) throw new Error(`file too large (${Math.round(buf.length / 1e6)}MB > ${maxBytes / 1e6}MB max)`)
  // sub-1KB payloads are error pages wearing a 200 status, not media
  if (buf.length < 1024) throw new Error('instagram: download failed')
  const type: 'video' | 'image' = ct.includes('image') ? 'image' : 'video'
  return { title: titleOf(res.headers, rawUrl).slice(0, 500), media: [{ type, buf }] }
}
