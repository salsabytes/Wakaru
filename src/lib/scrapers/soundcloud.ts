import { UA, fetchBuffer, fetchWithTimeout, withRetry } from '../http.ts'

// client_id is embedded in the page hydration JSON (apiClient.id) — scraped once, cached with a TTL
import { classifyError, ScraperError } from './errors.ts'
import { getCachedDownload, setCachedDownload } from './cache.ts'

let scClientId: { id: string; at: number } | null = null
const CLIENT_ID_TTL = 6 * 60 * 60 * 1000

const apiGet = async (path: string, clientId: string): Promise<any> => {
  const res = await withRetry(async () => {
    const r = await fetchWithTimeout(`https://api-v2.soundcloud.com/${path}&client_id=${clientId}`, {
      headers: { 'User-Agent': UA },
      timeout: 30_000,
    })
    return r
  })
  if (res.status === 401) throw new ScraperError('soundcloud: client_id rejected', { type: 'expired', platform: 'soundcloud' })
  if (!res.ok) throw new ScraperError(`soundcloud: api http ${res.status}`, { type: 'network', platform: 'soundcloud' })
  return res.json().catch(() => null)
}

async function clientId(): Promise<string> {
  const cached = scClientId && Date.now() - scClientId.at < CLIENT_ID_TTL
  if (cached) return scClientId!.id
  const res = await fetchWithTimeout('https://soundcloud.com/', { headers: { 'User-Agent': UA }, timeout: 30_000 })
  const html = await res.text()
  const id = html.match(/\{"hydratable":"apiClient","data":\{"id":"([A-Za-z0-9]+)"/)?.[1]
  if (!id) throw new ScraperError('soundcloud: no client_id on page', { type: 'unknown', platform: 'soundcloud' })
  scClientId = { id, at: Date.now() }
  return id
}

// pick the full-quality progressive stream; SNIP tracks only expose a 30s preview — still usable
function progressiveUrl(track: any): { url: string; snipped: boolean } | undefined {
  const t = (track?.media?.transcodings ?? []).find(
    (x: any) => x.format?.protocol === 'progressive' && /mpeg|opus/.test(x.format?.mime_type ?? ''),
  )
  return t ? { url: t.url, snipped: !!t.snipped } : undefined
}

export async function downloadSoundCloud(rawUrl: string): Promise<{ buf: Buffer; title: string }> {
  if (!/soundcloud\.com\//i.test(rawUrl)) throw new ScraperError('soundcloud: not a SoundCloud link', { type: 'unsupported', platform: 'soundcloud' })
  const cached = getCachedDownload(rawUrl)
  if (cached?.directUrl) {
    try {
      const buf = await fetchBuffer(cached.directUrl, { headers: { 'User-Agent': UA, Referer: 'https://soundcloud.com/' }, timeout: 60_000 })
      return { buf, title: cached.title || rawUrl }
    } catch {}
  }
  try {
    const cid = await clientId()
    const track = await apiGet(`resolve?url=${encodeURIComponent(rawUrl)}`, cid)
    if (!track || track.kind !== 'track') throw new ScraperError('soundcloud: not a track link (sets not supported yet)', { type: 'unsupported', platform: 'soundcloud' })
    if (track.policy === 'BLOCK') throw new ScraperError('soundcloud: track is blocked (geo-restricted or private)', { type: 'blocked', platform: 'soundcloud' })
    const prog = progressiveUrl(track)
    if (!prog) throw new ScraperError('soundcloud: no playable stream — track may be private or deleted', { type: 'notfound', platform: 'soundcloud' })
    // progressive url is already absolute — fetch directly with client_id appended
    const stepRes = await withRetry(async () => {
      const r = await fetchWithTimeout(`${prog.url}?client_id=${cid}`, {
        headers: { 'User-Agent': UA },
        timeout: 30_000,
      })
      return r
    })
    if (!stepRes.ok) throw new ScraperError(`soundcloud: stream http ${stepRes.status}`, { type: 'network', platform: 'soundcloud' })
    const step: any = await stepRes.json().catch(() => null)
    const cdn = step?.url
    if (!cdn) throw new ScraperError('soundcloud: stream link failed', { type: 'unknown', platform: 'soundcloud' })
    const buf = await fetchBuffer(cdn, { headers: { 'User-Agent': UA, Referer: 'https://soundcloud.com/' }, timeout: 60_000 })
    const artist = track.user?.username
    const title = [track.title, artist && artist !== track.title ? ` by ${artist}` : ''].join('')
    setCachedDownload(rawUrl, { directUrl: cdn, title, platform: 'soundcloud' })
    return { buf, title }
  } catch (e) {
    throw classifyError(e, 'soundcloud')
  }
}

if (process.env.SOUNDCLOUD_SELFTEST) {
  const track = {
    kind: 'track',
    title: 'What\'s Luv?',
    policy: 'ALLOW',
    user: { username: 'iskeymusic' },
    media: {
      transcodings: [
        { format: { protocol: 'hls', mime_type: 'audio/mp4; codecs="mp4a.40.2"' }, url: 'https://x/hls' },
        { format: { protocol: 'progressive', mime_type: 'audio/mpeg' }, url: 'https://x/prog', snipped: false },
      ],
    },
  }
  const p = progressiveUrl(track)!
  if (!p.url.endsWith('/prog') || p.snipped) throw new Error('progressiveUrl pick fail')
  const snipped = progressiveUrl({ media: { transcodings: [{ format: { protocol: 'progressive', mime_type: 'audio/mpeg' }, snipped: true }] } })!
  if (!snipped.snipped) throw new Error('progressiveUrl snipped fail')
  if (progressiveUrl({ media: { transcodings: [{ format: { protocol: 'hls', mime_type: 'audio/mpeg' } }] } })) {
    throw new Error('progressiveUrl hls-only fail')
  }
  console.log('soundcloud self-check ok')
  process.exit(0)
}
