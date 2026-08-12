import { UA, getJson } from './http.ts'

const YTMP3_HOME = 'https://id.ytmp3.mobi/'
const YTMP3_HOST = 'a.ymcdn.org'
const YTMP3_COOKIE_TTL = 5 * 60 * 1000

let ytmp3Cookies: { jar: string; at: number } | null = null

interface Resolved {
  url: string
  title: string
}

const initUrl = () => `https://${YTMP3_HOST}/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`

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

async function sessionHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = { 'User-Agent': UA, Referer: YTMP3_HOME }
  const cookies = await ytmp3Jar()
  if (cookies) h.Cookie = cookies
  return h
}

async function initSession(h: Record<string, string>): Promise<string> {
  let init = await getJson(initUrl(), h)
  if (init.error > 0 && h.Cookie) {
    ytmp3Cookies = null
    const fresh = await ytmp3Jar()
    if (fresh) h.Cookie = fresh
    init = await getJson(initUrl(), h)
  }
  if (init.error > 0 || !init.convertURL) throw new Error('ytmp3: init failed')
  return init.convertURL
}

type ConvertStep = { redirect: true; url: string } | { redirect: false; progressURL: string; downloadURL: string }

async function convertOnce(
  h: Record<string, string>,
  convertURL: string,
  vid: string,
  format: 'mp3' | 'mp4',
): Promise<ConvertStep> {
  const sep = convertURL.includes('?') ? '&' : '?'
  const conv = await getJson(`${convertURL}${sep}v=${vid}&f=${format}&_=${Math.random()}`, h)
  if (conv.error > 0) throw new Error('ytmp3: convert failed')
  if (conv.redirect > 0 && conv.redirectURL) return { redirect: true, url: conv.redirectURL }
  const { progressURL, downloadURL } = conv
  if (!progressURL || !downloadURL) throw new Error('ytmp3: no download link yet')
  return { redirect: false, progressURL, downloadURL }
}

async function pollProgress(
  h: Record<string, string>,
  progressURL: string,
  downloadURL: string,
  fallbackTitle: string,
): Promise<Resolved> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000))
    const p = await getJson(progressURL, h)
    if (p.error > 0) throw new Error('ytmp3: conversion failed')
    if (p.progress >= 3) return { url: downloadURL, title: p.title || fallbackTitle }
  }
  throw new Error('ytmp3: conversion timed out')
}

async function ytmp3Mobi(rawUrl: string, format: 'mp3' | 'mp4'): Promise<Resolved> {
  const vid = videoIdOf(rawUrl)
  if (!vid) throw new Error('ytmp3: not a YouTube link')
  const h = await sessionHeaders()
  let convertURL = await initSession(h)
  for (let hop = 0; hop < 3; hop++) {
    const step = await convertOnce(h, convertURL, vid, format)
    if (step.redirect) {
      convertURL = step.url
      continue
    }
    return pollProgress(h, step.progressURL, step.downloadURL, rawUrl)
  }
  throw new Error('ytmp3: too many redirects')
}

export async function download(url: string, mode: 'audio' | 'video') {
  const got = await ytmp3Mobi(url, mode === 'audio' ? 'mp3' : 'mp4')
  const res = await fetch(got.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300_000) })
  if (!res.ok) throw new Error(`download http ${res.status}`)
  return { buf: Buffer.from(await res.arrayBuffer()), title: got.title } as const
}
