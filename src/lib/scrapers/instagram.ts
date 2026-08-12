import { UA } from './http.ts'
import { snapsaveHome, snapsaveAction, snapsaveUnpack } from './snapsave.ts'

const shortcodeOf = (rawUrl: string): string | undefined =>
  rawUrl.match(/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/)?.[1]

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

async function downloadInstagramStoryViaSnapsave(username: string, rawUrl: string) {
  let got = await snapsaveAction(rawUrl)
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
