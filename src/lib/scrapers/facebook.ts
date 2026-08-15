import { UA, curl, fetchBuffer } from './http.ts'
import { snapsaveAction, snapsaveUnpack } from './snapsave.ts'

const FDOWN = 'https://fdown.net/'

async function viaFdown(rawUrl: string) {
  const html = (await curl(['-sL', '--max-time', '30', '-A', UA, '-e', FDOWN, '--data-urlencode', `URLz=${rawUrl}`, `${FDOWN}download.php`])).toString()
  if (html.includes('Just a moment')) throw new Error('facebook: fdown blocked the request — try again later')
  const href = html.match(/id="hdlink"[^>]*href="([^"]+)"/)?.[1] ?? html.match(/id="sdlink"[^>]*href="([^"]+)"/)?.[1]
  if (!href) throw new Error('facebook: no download link — video may be private or deleted')
  const title = (html.match(/download="([^"]+)"/)?.[1] ?? '').replace(/-fdown\.net\.mp4$/, '').trim()
  const cleanTitle = title && title !== 'No video description...' ? title : undefined
  const buf = await fetchBuffer(href.replaceAll('&amp;', '&'), { headers: { 'User-Agent': UA } })
  return { buf, title: cleanTitle }
}

async function viaSnapsave(rawUrl: string) {
  let got = await snapsaveAction(rawUrl)
  if (!got.ok || !got.text.includes('(function(')) got = await snapsaveAction(rawUrl, true)
  if (!got.ok || !got.text.includes('(function(')) throw new Error(`snapsave: action ${got.ok ? 'blocked' : `http ${got.status}`}`)
  const payload = snapsaveUnpack(got.text)
  const href = [...payload.matchAll(/https:\/\/d\.rapidcdn\.app\/v2\?token=[A-Za-z0-9._-]+/g)].map((x) => x[0])[0]
  if (!href) throw new Error('facebook: no download link — video may be private or deleted')
  const buf = await fetchBuffer(href, { headers: { 'User-Agent': UA } })
  return { buf, title: undefined }
}

export async function downloadFacebook(rawUrl: string) {
  if (!/facebook\.com\/|fb\.watch\//i.test(rawUrl)) throw new Error('facebook: not a Facebook link')
  try {
    return await viaFdown(rawUrl)
  } catch {
    return await viaSnapsave(rawUrl)
  }
}
