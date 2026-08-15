import { UA, fetchBuffer } from './http.ts'

const statusOf = (rawUrl: string): string | undefined => rawUrl.match(/status\/(\d{5,})/)?.[1]

// pick the highest-res mp4 — fxtwitter returns one url per quality variant,
// resolution is embedded in the path like /vid/720x720/
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
  const videos: { url: string }[] = j.tweet.media?.videos
  if (!videos?.length) throw new Error('twitter: no video in this tweet')
  const best = [...videos].sort((a, b) => resOf(b.url) - resOf(a.url))[0]
  const buf = await fetchBuffer(best.url, { headers: { 'User-Agent': UA } })
  const who = j.tweet.author?.screen_name ? `@${j.tweet.author.screen_name}` : 'x'
  const title = `${who}: ${j.tweet.text?.slice(0, 120) || id}`
  return { buf, title }
}
