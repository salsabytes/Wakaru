import { UA, fetchBuffer } from './http.ts'

const PINTEREST = 'https://www.pinterest.com/'

let pinSession: { cookies: string; csrf: string } | null = null
async function pinterestSession(force = false) {
  if (!force && pinSession) return pinSession
  const home = await fetch(PINTEREST, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(30_000),
  })
  const cookies = (home.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const csrf = cookies.match(/csrftoken=([^;]+)/)?.[1]
  if (!csrf) throw new Error('pinterest: no session')
  pinSession = { cookies, csrf }
  return pinSession
}

async function pinterestResource(endpoint: string, sourceUrl: string, options: any, s: { cookies: string; csrf: string }) {
  const body = new URLSearchParams({ source_url: sourceUrl, data: JSON.stringify({ options, context: {} }) })
  const res = await fetch(`https://www.pinterest.com/resource/${endpoint}/`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      Cookie: s.cookies,
      'X-CSRFToken': s.csrf,
      'X-Requested-With': 'XMLHttpRequest',
      Referer: `https://www.pinterest.com${sourceUrl}`,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body,
    signal: AbortSignal.timeout(30_000),
  })
  const j: any = await res.json().catch(() => null)
  if (!j?.resource_response) throw new Error(`pinterest: request failed (http ${res.status})`)
  return j
}

const pinterestImage = async (url: string): Promise<{ buf: Buffer }> => ({
  buf: await fetchBuffer(url, { headers: { 'User-Agent': UA }, timeout: 120_000 }),
})

export type PinOut = { type: 'image' | 'video'; buf: Buffer; title?: string }

const bestPinVideo = (videos: any): string | undefined => {
  const list: Record<string, any> = videos?.video_list ?? {}
  const mp4s = Object.entries(list)
    .filter(([, v]: any) => /\.mp4($|\?)/i.test(v?.url ?? ''))
    .sort(([a], [b]) => Number(b.match(/\d+/)?.[0] ?? 0) - Number(a.match(/\d+/)?.[0] ?? 0))
  const capped = mp4s.find(([k]) => Number(k.match(/\d+/)?.[0] ?? 0) <= 720)
  return (capped ?? mp4s[0])?.[1]?.url
}

const pinImageUrl = (p: any): string | undefined => p?.images?.orig?.url ?? p?.images?.originals?.url

export async function downloadPinterest(input: string): Promise<PinOut[]> {
  if (/pin\.it\//i.test(input)) {
    const r = await fetch(input, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
    input = r.url
  }
  const pin = input.match(/\/pin\/(\d+)/)?.[1]
  if (/pinterest\./i.test(input) && !pin) throw new Error('pinterest: not a pin link — use a /pin/ link or a search query')
  const s = await pinterestSession()
  const tryOnce = async (session: { cookies: string; csrf: string }): Promise<PinOut[]> => {
    if (pin) {
      const j: any = await pinterestResource('PinResource/get', `/pin/${pin}/`, { id: pin, field_set_key: 'detailed' }, session)
      const d = j?.resource_response?.data
      const vurl = bestPinVideo(d?.videos)
      const url = vurl ?? pinImageUrl(d)
      return url ? [{ type: vurl ? 'video' : 'image', buf: (await pinterestImage(url)).buf, title: d?.title }] : []
    }
    const j: any = await pinterestResource(
      'SearchResource/get',
      `/search/pins/?q=${encodeURIComponent(input)}`,
      { query: input, scope: 'pins' },
      session,
    )
    const d = j?.resource_response?.data
    const pins: any[] = (Array.isArray(d) ? d : (d?.results ?? [])).slice(0, 5)
    const out: PinOut[] = []
    for (const p of pins) {
      try {
        let vurl = bestPinVideo(p?.videos)
        if (p?.videos?.video_list && !vurl && p?.id) {
          const pj: any = await pinterestResource('PinResource/get', `/pin/${p.id}/`, { id: String(p.id), field_set_key: 'detailed' }, session)
          vurl = bestPinVideo(pj?.resource_response?.data?.videos)
        }
        const url = vurl ?? pinImageUrl(p)
        if (!url) continue
        out.push({ type: vurl ? 'video' : 'image', buf: (await pinterestImage(url)).buf })
      } catch {}
    }
    return out
  }
  let media = await tryOnce(s)
  if (!media.length) media = await tryOnce(await pinterestSession(true))
  if (!media.length) throw new Error(pin ? 'pinterest: pin not found' : 'pinterest: no results')
  return media
}
