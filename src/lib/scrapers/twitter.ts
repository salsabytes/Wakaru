import { UA, fetchBuffer } from './http.ts'

const statusOf = (rawUrl: string): string | undefined => rawUrl.match(/status\/(\d{5,})/)?.[1]

// fxtwitter embeds resolution in the url path, e.g. /vid/720x720/
const resOf = (url: string): number => Number(url.match(/\/vid\/(\d+)x/)?.[1] ?? 0)

export async function downloadTwitter(rawUrl: string) {
  if (!/(?:twitter\.com|x\.com)\//i.test(rawUrl)) throw new Error('twitter: not an X/Twitter link')
  const id = statusOf(rawUrl)
  if (!id) throw new Error('twitter: link format not recognized')
  const j: any = await fetch(`https://api.fxtwitter.com/status/${id}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  })
    .then((r) => r.json())
    .catch(() => null)
  if (!j?.tweet) throw new Error(`twitter: ${j?.message ?? 'request failed'}`)
  const photos: { url: string }[] = j.tweet.media?.photos ?? []
  const videos: { url: string }[] = j.tweet.media?.videos ?? []
  const best = [...videos].sort((a, b) => resOf(b.url) - resOf(a.url))[0]
  const refs = [
    ...photos.map((p) => ({ type: 'image' as const, url: p.url })),
    ...(best ? [{ type: 'video' as const, url: best.url }] : []),
  ]
  if (!refs.length) throw new Error('twitter: no photos or video in this tweet')
  const got = await Promise.allSettled(
    refs.map(async ({ type, url }) => ({ type, buf: await fetchBuffer(url, { headers: { 'User-Agent': UA } }) })),
  )
  const media = got
    .filter((r): r is PromiseFulfilledResult<{ type: 'image' | 'video'; buf: Buffer }> => r.status === 'fulfilled')
    .map((r) => r.value)
  if (!media.length) throw new Error('twitter: download failed')
  const who = j.tweet.author?.screen_name ? `@${j.tweet.author.screen_name}` : 'x'
  const title = `${who}: ${j.tweet.text?.slice(0, 120) || id}`
  return { media, title }
}
