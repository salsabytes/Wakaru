const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const YTMP3_HOME = 'https://id.ytmp3.mobi/'
const YTMP3_HOST = 'a.ymcdn.org'
const TIKTIK_API = 'https://tiktokdownloaderr.id/api/downloader.php'

interface Resolved {
  url: string
  title: string
}

const videoIdOf = (rawUrl: string): string | undefined => {
  const m = rawUrl.match(/youtu\.be\/([A-Za-z0-9_-]{11})|shorts\/([A-Za-z0-9_-]{11})|(?:embed|live)\/([A-Za-z0-9_-]{11})|[?&]v=([A-Za-z0-9_-]{11})/)
  return (m && (m[1] ?? m[2] ?? m[3] ?? m[4])) || undefined
}

// the site rate-limits and may serve block pages — keep errors clear
const getJson = async (url: string, headers: Record<string, string>): Promise<any> => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
  try {
    return await res.json()
  } catch {
    throw new Error(`ytmp3: non-json response (http ${res.status})`)
  }
}

// the sig token and API endpoints live in the site's JS and can change — re-extract them if conversions break
async function ytmp3Mobi(rawUrl: string, format: 'mp3' | 'mp4'): Promise<Resolved> {
  const vid = videoIdOf(rawUrl)
  if (!vid) throw new Error('ytmp3: not a YouTube link')
  const home = await fetch(YTMP3_HOME, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) })
  const cookies = (home.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const h: Record<string, string> = { 'User-Agent': UA, Referer: YTMP3_HOME }
  if (cookies) h.Cookie = cookies
  const init = await getJson(`https://${YTMP3_HOST}/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`, h)
  if (init.error > 0 || !init.convertURL) throw new Error('ytmp3: init failed')
  let convertURL: string = init.convertURL
  for (let hop = 0; hop < 3; hop++) {
    const sep = convertURL.includes('?') ? '&' : '?'
    const conv = await getJson(`${convertURL}${sep}v=${vid}&f=${format}&_=${Math.random()}`, h)
    if (conv.error > 0) throw new Error('ytmp3: convert failed')
    if (conv.redirect > 0 && conv.redirectURL) {
      convertURL = conv.redirectURL
      continue
    }
    const { progressURL, downloadURL } = conv
    if (!progressURL || !downloadURL) throw new Error('ytmp3: no download link yet')
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const p = await getJson(progressURL, h)
      if (p.error > 0) throw new Error('ytmp3: conversion failed')
      if (p.progress >= 3) return { url: downloadURL, title: p.title || rawUrl }
    }
    throw new Error('ytmp3: conversion timed out')
  }
  throw new Error('ytmp3: too many redirects')
}

export async function download(url: string, mode: 'audio' | 'video') {
  const got = await ytmp3Mobi(url, mode === 'audio' ? 'mp3' : 'mp4')
  const res = await fetch(got.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300_000) })
  if (!res.ok) throw new Error(`download http ${res.status}`)
  // whole file stays in RAM because sendMessage needs the buffer — no size cap
  return { buf: Buffer.from(await res.arrayBuffer()), title: got.title } as const
}

export async function downloadTikTok(rawUrl: string) {
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
  const dl = await fetch(j.video_nowm, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300_000) })
  if (!dl.ok) throw new Error(`tiktok download http ${dl.status}`)
  // whole file stays in RAM because sendMessage needs the buffer — no size cap
  return { buf: Buffer.from(await dl.arrayBuffer()), title: j.title || rawUrl }
}
