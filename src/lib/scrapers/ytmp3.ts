import { UA, getJson } from './http.ts'

const YTMP3_HOME = 'https://id.ytmp3.mobi/'
const YTMP3_HOST = 'a.ymcdn.org'
const YTMP3_COOKIE_TTL = 5 * 60 * 1000

let ytmp3Cookies: { jar: string; at: number } | null = null

interface Resolved {
  url: string
  title: string
}

const ytmp3Jar = async (): Promise<string> => {
  const cached = ytmp3Cookies && Date.now() - ytmp3Cookies.at < YTMP3_COOKIE_TTL
  if (cached) return ytmp3Cookies!.jar
  const home = await fetch(YTMP3_HOME, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) })
  const jar = (home.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  ytmp3Cookies = { jar, at: Date.now() }
  return jar
}

const videoIdOf = (rawUrl: string): string | undefined => {
  const m = rawUrl.match(/youtu\.be\/([A-Za-z0-9_-]{11})|shorts\/([A-Za-z0-9_-]{11})|(?:embed|live)\/([A-Za-z0-9_-]{11})|[?&]v=([A-Za-z0-9_-]{11})/)
  return (m && (m[1] ?? m[2] ?? m[3] ?? m[4])) || undefined
}

async function ytmp3Mobi(rawUrl: string, format: 'mp3' | 'mp4'): Promise<Resolved> {
  const vid = videoIdOf(rawUrl)
  if (!vid) throw new Error('ytmp3: not a YouTube link')
  let cookies = await ytmp3Jar()
  const h: Record<string, string> = { 'User-Agent': UA, Referer: YTMP3_HOME }
  if (cookies) h.Cookie = cookies
  let init = await getJson(`https://${YTMP3_HOST}/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`, h)
  if (init.error > 0 && cookies) {
    ytmp3Cookies = null
    cookies = await ytmp3Jar()
    if (cookies) h.Cookie = cookies
    init = await getJson(`https://${YTMP3_HOST}/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`, h)
  }
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
  return { buf: Buffer.from(await res.arrayBuffer()), title: got.title } as const
}
