import { UA, curl, fetchBuffer } from './http.ts'

const FDOWN = 'https://fdown.net/'

export async function downloadFacebook(rawUrl: string) {
  if (!/facebook\.com\/|fb\.watch\//i.test(rawUrl)) throw new Error('facebook: not a Facebook link')
  const html = (await curl(['-sL', '--max-time', '30', '-A', UA, '-e', FDOWN, '--data-urlencode', `URLz=${rawUrl}`, `${FDOWN}download.php`])).toString()
  if (html.includes('Just a moment')) throw new Error('facebook: fdown blocked the request — try again later')
  const href = html.match(/id="hdlink"[^>]*href="([^"]+)"/)?.[1] ?? html.match(/id="sdlink"[^>]*href="([^"]+)"/)?.[1]
  if (!href) throw new Error('facebook: no download link — video may be private or deleted')
  const title = (html.match(/download="([^"]+)"/)?.[1] ?? '').replace(/-fdown\.net\.mp4$/, '').trim()
  const cleanTitle = title && title !== 'No video description...' ? title : undefined
  const buf = await fetchBuffer(href.replaceAll('&amp;', '&'), { headers: { 'User-Agent': UA } })
  return { buf, title: cleanTitle }
}
