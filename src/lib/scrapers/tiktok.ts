import { UA, fetchBuffer } from './http.ts'

const TIKTIK_API = 'https://tiktokdownloaderr.id/api/downloader.php'

export async function downloadTikTok(rawUrl: string) {
  if (!/tiktok\.com\//i.test(rawUrl)) throw new Error('tiktok: not a TikTok link')
  const form = new FormData()
  form.append('url', rawUrl)
  const res = await fetch(TIKTIK_API, {
    method: 'POST',
    headers: { 'User-Agent': UA, Referer: 'https://tiktokdownloaderr.id/' },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
  const j: any = await res.json().catch(() => null)
  if (!j?.success || !j.video_nowm) throw new Error(`tiktok: ${j?.message ?? 'request failed'}`)
  const buf = await fetchBuffer(j.video_nowm, { headers: { 'User-Agent': UA } })
  return { buf, title: j.title || rawUrl }
}
