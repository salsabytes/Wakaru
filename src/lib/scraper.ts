const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const YTMP3_HOME = 'https://id.ytmp3.mobi/'
const YTMP3_HOST = 'a.ymcdn.org'
const TIKTIK_API = 'https://tiktokdownloaderr.id/api/downloader.php'

// ytmp3 session cookies are stable for a while — reuse them instead of hitting the home page per download
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

const getJson = async (url: string, headers: Record<string, string>): Promise<any> => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
  try {
    return await res.json()
  } catch {
    throw new Error(`ytmp3: non-json response (http ${res.status})`)
  }
}

async function ytmp3Mobi(rawUrl: string, format: 'mp3' | 'mp4'): Promise<Resolved> {
  const vid = videoIdOf(rawUrl)
  if (!vid) throw new Error('ytmp3: not a YouTube link')
  let cookies = await ytmp3Jar()
  const h: Record<string, string> = { 'User-Agent': UA, Referer: YTMP3_HOME }
  if (cookies) h.Cookie = cookies
  let init = await getJson(`https://${YTMP3_HOST}/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`, h)
  if (init.error > 0 && cookies) {
    // cached cookie jar went stale — refresh once and retry before giving up
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
  const dl = await fetch(j.video_nowm, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300_000) })
  if (!dl.ok) throw new Error(`tiktok download http ${dl.status}`)
  return { buf: Buffer.from(await dl.arrayBuffer()), title: j.title || rawUrl }
}

const shortcodeOf = (rawUrl: string): string | undefined =>
  rawUrl.match(/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/)?.[1]

// IG serves this API only to browser-like requests
const IG_HEADERS = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
}

let igSessionCached: { cookies: string; csrf: string } | null = null

async function igSession(force = false): Promise<{ cookies: string; csrf: string }> {
  if (!force && igSessionCached) return igSessionCached
  const res = await fetch('https://www.instagram.com/', { headers: IG_HEADERS, signal: AbortSignal.timeout(30_000) })
  const cookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  const csrf = cookies.match(/csrftoken=([^;]+)/)?.[1]
  if (!csrf) throw new Error('instagram: no session')
  igSessionCached = { cookies, csrf }
  return igSessionCached
}

async function igMediaItem(shortcode: string, session: { cookies: string; csrf: string }) {
  const variables = JSON.stringify({
    shortcode,
    __relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider: false,
  })
  const res = await fetch(
    `https://www.instagram.com/graphql/query/?doc_id=27128499623469141&variables=${encodeURIComponent(variables)}`,
    {
      headers: { ...IG_HEADERS, Cookie: session.cookies, 'x-ig-app-id': '936619743392459', 'x-csrftoken': session.csrf },
      signal: AbortSignal.timeout(60_000),
    },
  )
  const j: any = await res.json().catch(() => null)
  return { item: j?.data?.xdt_api__v1__media__shortcode__web_info?.items?.[0], message: j?.message }
}

// media_type: 1 = photo, 2 = video; carousels list items in carousel_media
const igBestOf = (m: any): { type: 'video' | 'image'; url: string } | undefined => {
  const url = m.media_type === 2
    ? m.video_versions?.sort((a: any, b: any) => b.width - a.width)[0]?.url
    : m.image_versions2?.candidates?.sort((a: any, b: any) => b.width - a.width)[0]?.url
  return url ? { type: m.media_type === 2 ? 'video' : 'image', url } : undefined
}

async function igDownload(refs: { type: 'video' | 'image'; url: string }[], title: string) {
  const results = await Promise.allSettled(
    refs.map(async ({ type, url }) => {
      const dl = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300_000) })
      if (!dl.ok) throw new Error(`instagram download http ${dl.status}`)
      return { type, buf: Buffer.from(await dl.arrayBuffer()) }
    }),
  )
  const media = (
    results.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{ type: 'video' | 'image'; buf: Buffer }>[]
  ).map((r) => r.value)
  if (!media.length) throw new Error('instagram: download failed')
  return { title, media }
}

const SNAPSAVE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/'

let snapsaveCookies = ''
async function snapsaveHome(force = false): Promise<string> {
  if (!force && snapsaveCookies) return snapsaveCookies
  const res = await fetch('https://snapsave.app/', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`snapsave: homepage http ${res.status}`)
  snapsaveCookies = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  return snapsaveCookies
}

// port of snapsave's eval-packer — decodes without executing remote code
function snapsaveUnpack(code: string): string {
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

async function snapsaveAction(rawUrl: string, forceCookies = false): Promise<{ ok: boolean; status: number; text: string }> {
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

async function downloadInstagramStoryViaSnapsave(username: string, rawUrl: string) {
  let got = await snapsaveAction(rawUrl)
  // CF rotates cookies — retry once on a fresh jar
  if (!got.ok || !got.text.includes('(function(')) got = await snapsaveAction(rawUrl, true)
  if (!got.ok || !got.text.includes('(function(')) throw new Error(`snapsave: action ${got.ok ? 'blocked' : `http ${got.status}`}`)
  const payload = snapsaveUnpack(got.text)
  const links = [...payload.matchAll(/https:\/\/d\.rapidcdn\.app\/v2\?token=[A-Za-z0-9._-]+/g)].map((x) => x[0])
  if (!links.length) throw new Error('snapsave: no media found — story may be expired or the link is invalid')
  const refs = links.map((link) => {
    let type: 'video' | 'image' = 'video'
    try {
      const jwt: any = JSON.parse(Buffer.from(link.split('token=')[1].split('.')[1], 'base64url').toString())
      const file = jwt.filename || jwt.url || ''
      if (/\.(jpe?g|png)$/i.test(file)) type = 'image'
    } catch {}
    return { type, url: link }
  })
  return igDownload(refs, `@${username} · story`)
}

async function downloadInstagramStory(username: string, storyId: string) {
  const sessionid = process.env.IG_SESSIONID
  if (!sessionid) throw new Error("instagram: stories need IG_SESSIONID (a logged-in IG session) — see README")
  const session = await igSession()
  const prof = await fetch(
    `https://www.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
    {
      headers: { ...IG_HEADERS, Cookie: session.cookies, 'x-ig-app-id': '936619743392459', 'x-csrftoken': session.csrf, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    },
  )
  const pj: any = await prof.json().catch(() => null)
  const userId = pj?.data?.user?.id
  if (!userId) throw new Error('instagram: user not found')
  // sessionid starts with the user id — IG expects ds_user_id alongside it
  const dsUserId = sessionid.split('%3A')[0] || sessionid.split(':')[0]
  const rm = await fetch(`https://i.instagram.com/api/v1/feed/reels_media/?reel_ids=${userId}`, {
    headers: {
      ...IG_HEADERS,
      Cookie: `${session.cookies} sessionid=${sessionid}; ds_user_id=${dsUserId}`,
      'x-ig-app-id': '936619743392459',
      'x-csrftoken': session.csrf,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(60_000),
  })
  const j: any = await rm.json().catch(() => null)
  const items: any[] = j?.reels?.[userId]?.items ?? []
  const item = items.find((it: any) => String(it.pk) === String(storyId))
  if (!item) throw new Error('instagram: story not found or expired')
  const refs = [igBestOf(item)].filter((m): m is { type: 'video' | 'image'; url: string } => !!m)
  if (!refs.length) throw new Error('instagram: no media in response')
  return igDownload(refs, `@${username} · story`)
}

export async function downloadInstagram(rawUrl: string) {
  const story = rawUrl.match(/stories\/([A-Za-z0-9._]{1,30})\/(\d{10,})/)
  if (story) {
    try {
      return await downloadInstagramStoryViaSnapsave(story[1], rawUrl)
    } catch (err) {
      if (process.env.IG_SESSIONID) return downloadInstagramStory(story[1], story[2])
      throw err
    }
  }
  const shortcode = shortcodeOf(rawUrl)
  if (!shortcode) throw new Error('instagram: not an Instagram link')
  let { item, message } = await igMediaItem(shortcode, await igSession())
  if (!item) ({ item, message } = await igMediaItem(shortcode, await igSession(true)))
  if (!item) throw new Error(`instagram: ${message === 'invalid request' ? 'blocked by Instagram — try again later' : (message ?? 'request failed')}`)
  const entries: any[] = Array.isArray(item.carousel_media) ? item.carousel_media : [item]
  const refs = entries
    .map((m: any) => igBestOf(m))
    .filter((m: any): m is { type: 'video' | 'image'; url: string } => !!m)
  if (!refs.length) throw new Error('instagram: no media in response')
  const title = (item.caption?.text || `@${item.user?.username || shortcode}`).slice(0, 500)
  return igDownload(refs, title)
}
