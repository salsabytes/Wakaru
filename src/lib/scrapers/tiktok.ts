import { UA, fetchBuffer, fetchWithTimeout, withRetry } from '../http.ts'
import { classifyError, ScraperError } from './errors.ts'
import { getCachedDownload, setCachedDownload } from './cache.ts'

const TIKTIK_API = 'https://tiktokdownloaderr.id/api/downloader.php'

export async function downloadTikTok(rawUrl: string) {
  if (!/tiktok\.com\//i.test(rawUrl)) throw new ScraperError('tiktok: not a TikTok link', { type: 'unsupported', platform: 'tiktok' })
  const cached = getCachedDownload(rawUrl)
  if (cached?.directUrl) {
    try {
      const buf = await fetchBuffer(cached.directUrl, { headers: { 'User-Agent': UA }, timeout: 60_000 })
      return { buf, title: cached.title || rawUrl }
    } catch {}
  }
  try {
    const form = new FormData()
    form.append('url', rawUrl)
    const res = await withRetry(async () => {
      const r = await fetchWithTimeout(TIKTIK_API, {
        method: 'POST',
        headers: { 'User-Agent': UA, Referer: 'https://tiktokdownloaderr.id/' },
        body: form,
        timeout: 60_000,
      })
      return r
    })
    const j: any = await res.json().catch(() => null)
    if (!j?.success || !j.video_nowm) throw new ScraperError(`tiktok: ${j?.message ?? 'request failed'}`, { type: 'unknown', platform: 'tiktok' })
    const buf = await fetchBuffer(j.video_nowm, { headers: { 'User-Agent': UA }, timeout: 60_000 })
    setCachedDownload(rawUrl, { directUrl: j.video_nowm, title: j.title, platform: 'tiktok' })
    return { buf, title: j.title || rawUrl }
  } catch (e) {
    throw classifyError(e, 'tiktok')
  }
}
