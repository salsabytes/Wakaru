import { constants, publicEncrypt } from 'node:crypto'
import { UA, curl, fetchBuffer } from './http.ts'

const FDOWN = 'https://fdown.net/'

async function viaFdown(rawUrl: string) {
  const html = (await curl(['-sL', '--max-time', '30', '-A', UA, '-e', FDOWN, '--data-urlencode', `URLz=${rawUrl}`, `${FDOWN}download.php`])).toString()
  if (html.includes('Just a moment')) throw new Error('facebook: fdown blocked the request — try again later')
  const href = html.match(/id="hdlink"[^>]*href="([^"]+)"/)?.[1] ?? html.match(/id="sdlink"[^>]*href="([^"]+)"/)?.[1]
  if (!href) throw new Error('facebook: no download link — video may be private or deleted')
  const title = (html.match(/download="([^"]+)"/)?.[1] ?? '').replace(/-fdown\.net\.mp4$/, '').trim()
  const cleanTitle = title && title !== 'No video description...' ? title : undefined
  const buf = await fetchBuffer(href.replaceAll('&amp;', '&'), { headers: { 'User-Agent': UA } })
  return { media: [{ type: 'video' as const, buf }], title: cleanTitle }
}

type FbMedia = { type: 'image' | 'video'; buf: Buffer }

// Replicates fvidgo's frontend flow server-side: their API signs every request with
// X-Secure-Message = RSA-1024 PKCS#1 encrypt of the ms timestamp (public key from their
// JS bundle). Returns fbBos[] with direct FB CDN urls for photos and videos — no session
// needed, works from flagged IPs because fvidgo's server does the FB fetching.
const FVIDGO_HOST = 'https://api.hitube.io'
const FVIDGO_PUB =
  '-----BEGIN PUBLIC KEY-----\n' +
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDCAdf/EyIbLBxjGqmh7qLU6/CPCzru+75+82OSPZ+nf4BFvg88drpZ6KigNW0J8TNgxe6Yms1irCZNVDyu+RXsl4y/7c2KOHc4OGTzHB5fUMiMasFUvcEs2P70e6yA/sKHZfBLG1XPhlb84Ibs3nhD3W5e2SuC+4EuVkaqzN08LQIDAQAB'.match(/.{1,64}/g)!.join('\n') +
  '\n-----END PUBLIC KEY-----'

export const fvidgoSig = (ts: number): string =>
  publicEncrypt({ key: FVIDGO_PUB, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(String(ts))).toString('base64')

export const fvidgoSessionId = (ts: number): string =>
  `common_${Array.from({ length: 10 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join('')}_${ts}`

// fbBos item → direct CDN url; falls back to the JWT via fvidgo's token proxy
const fvidgoMediaUrl = (b: any): string => {
  const u = b.originalUrl || b.url || ''
  return /^https?:\/\//.test(u) ? u : `${FVIDGO_HOST}/st-tik/token/${u}`
}

// video wins over photos; otherwise every photo in the post (fvidgo returns them all)
export function fvidgoRefs(json: any): { type: 'image' | 'video'; url: string }[] {
  const bos: any[] = json?.result?.fbBos ?? []
  const videos = bos.filter((b) => /^mp4$/i.test(b.type)).map(fvidgoMediaUrl).filter(Boolean)
  if (videos.length) return [...new Set(videos)].map((url) => ({ type: 'video' as const, url }))
  const images = bos.filter((b) => /^jpe?g|png|gif|webp$/i.test(b.type)).map(fvidgoMediaUrl).filter(Boolean)
  return [...new Set(images)].map((url) => ({ type: 'image' as const, url }))
}

async function viaFvidgo(rawUrl: string) {
  const ts = Date.now()
  const res = await fetch(
    `${FVIDGO_HOST}/st-tik-video/fb/dl2?url=${encodeURIComponent(rawUrl)}&sessionid=${fvidgoSessionId(ts)}`,
    {
      headers: {
        'User-Agent': UA,
        Referer: 'https://www.fvidgo.com/',
        Origin: 'https://www.fvidgo.com',
        Accept: 'application/json, text/plain, */*',
        'X-Secure-Message': fvidgoSig(ts),
      },
      signal: AbortSignal.timeout(60_000),
    },
  )
  if (!res.ok) throw new Error(`facebook: fvidgo http ${res.status}`)
  const json: any = await res.json().catch(() => null)
  if (!json || json.msg !== 'OK') throw new Error('facebook: no media found — link may be private or deleted')
  const refs = fvidgoRefs(json)
  if (!refs.length) throw new Error('facebook: no media found — link may be private or deleted')
  const headers: Record<string, string> = { 'User-Agent': UA, Referer: 'https://www.facebook.com/' } // CDN needs the referer
  const got = await Promise.allSettled(
    refs.map(async ({ type, url }) => ({ type, buf: await fetchBuffer(url, { headers }) })),
  )
  const media = got
    .filter((r): r is PromiseFulfilledResult<{ type: 'image' | 'video'; buf: Buffer }> => r.status === 'fulfilled')
    .map((r) => r.value)
  if (!media.length) throw new Error('facebook: download failed')
  const desc = json.result.fbBos.find((b: any) => b.desc)?.desc
  return { media, title: typeof desc === 'string' && desc ? desc.slice(0, 200) : undefined }
}

// fvdownloader.net — clean JSON, ~3s, handles reels. Last resort for videos fdown/fvidgo miss.
export function parseFvdownloader(body: string): string {
  let json: any
  try {
    json = JSON.parse(body)
  } catch {
    throw new Error('facebook: fvdownloader bad response')
  }
  if (json.error || typeof json.downloadUrl !== 'string') throw new Error('facebook: no download link — video may be private or deleted')
  return json.downloadUrl
}

async function viaFvdownloader(rawUrl: string) {
  const home = (await curl(['-sL', '--max-time', '15', '-A', UA, 'https://fvdownloader.net/'])).toString()
  const token = home.match(/value="([a-f0-9]{32})"/)?.[1]
  if (!token) throw new Error('facebook: fvdownloader setup failed')
  const body = (
    await curl([
      '-sL', '--max-time', '30', '-A', UA,
      '-e', 'https://fvdownloader.net/',
      '-H', 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
      '-H', 'X-Requested-With: XMLHttpRequest',
      '--data-urlencode', `query=${rawUrl}`,
      '--data-urlencode', `token=${token}`,
      '--data-urlencode', 'downloader=video',
      'https://fvdownloader.net/req',
    ])
  ).toString()
  const url = parseFvdownloader(body)
  const buf = await fetchBuffer(url, { headers: { 'User-Agent': UA, Referer: 'https://www.facebook.com/' } })
  return { media: [{ type: 'video' as const, buf }], title: undefined }
}

export async function downloadFacebook(rawUrl: string): Promise<{ media: FbMedia[]; title: string | undefined }> {
  if (!/facebook\.com\/|fb\.watch\//i.test(rawUrl)) throw new Error('facebook: not a Facebook link')
  try {
    return await viaFdown(rawUrl) // fastest, HD for plain video posts
  } catch {}
  try {
    return await viaFvidgo(rawUrl) // photos (all of them) + videos, no session needed
  } catch {}
  return await viaFvdownloader(rawUrl) // last resort for videos
}

if (process.env.FB_SELFTEST) {
  const videoJson = {
    msg: 'OK',
    result: {
      fbBos: [
        { type: 'mp4', originalUrl: 'https://video.fbcdn.net/a.mp4', desc: 'a reel' },
        { type: 'jpg', originalUrl: 'https://scontent.fbcdn.net/poster.jpg' },
      ],
    },
  }
  const photoJson = {
    msg: 'OK',
    result: {
      fbBos: [
        { type: 'jpg', originalUrl: 'https://scontent.fbcdn.net/1.jpg' },
        { type: 'jpg', url: 'eyJhbGciOiJIUzUxMiJ9.xxx' },
      ],
    },
  }
  const v = fvidgoRefs(videoJson)
  if (v.length !== 1 || v[0].type !== 'video' || !v[0].url.endsWith('.mp4')) throw new Error('fvidgoRefs video fail')
  const p = fvidgoRefs(photoJson)
  if (p.length !== 2 || p[0].type !== 'image') throw new Error('fvidgoRefs photo fail')
  if (!p[1].url.startsWith('https://api.hitube.io/st-tik/token/')) throw new Error('fvidgoRefs token fallback fail')
  if (fvidgoRefs({ msg: 'OK', result: { fbBos: [] } }).length) throw new Error('fvidgoRefs empty fail')
  if (!/^common_[A-Za-z0-9]{10}_\d+$/.test(fvidgoSessionId(1786000000000))) throw new Error('fvidgoSessionId fail')
  const sig = fvidgoSig(1786000000000)
  if (sig.length < 150 || !/^[A-Za-z0-9+/=]+$/.test(sig)) throw new Error('fvidgoSig fail')
  if (parseFvdownloader('{"error":false,"downloadUrl":"https://video.example/x.mp4"}') !== 'https://video.example/x.mp4') {
    throw new Error('parseFvdownloader ok fail')
  }
  try {
    parseFvdownloader('{"error":true,"downloadUrl":null}')
    throw new Error('parseFvdownloader error fail')
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes('private')) throw new Error('parseFvdownloader error message fail')
  }
  console.log('facebook self-check ok')
  process.exit(0)
}
