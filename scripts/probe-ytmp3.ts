import { UA } from '../src/lib/scrapers/http.ts'

const vid = 'dQw4w9WgXcQ'
const HOME = 'https://id.ytmp3.mobi/'
const HOST = 'a.ymcdn.org'
const initUrl = () => `https://${HOST}/api/v1/init?p=y&23=1llum1n471&_=${Math.random()}`
const t0 = Date.now()
const log = (label: string) => console.log(`${Date.now() - t0}ms\t${label}`)

const home = await fetch(HOME, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) })
const jar = (home.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
log('jar fetched')
const h: Record<string, string> = { 'User-Agent': UA, Referer: HOME, Cookie: jar }

const init = await (await fetch(initUrl(), { headers: h, signal: AbortSignal.timeout(15_000) })).json()
log(`init done, error=${init.error}`)
const convertURL = init.convertURL as string
const sep = convertURL.includes('?') ? '&' : '?'
const conv = await (await fetch(`${convertURL}${sep}v=${vid}&f=mp3&_=${Math.random()}`, { headers: h, signal: AbortSignal.timeout(15_000) })).json()
log(`convert done, error=${conv.error} redirect=${conv.redirect}`)
const { progressURL, downloadURL } = conv as { progressURL: string; downloadURL: string }
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 1000))
  const p = await (await fetch(progressURL, { headers: h, signal: AbortSignal.timeout(15_000) })).json()
  if (p.error > 0) { console.log('poll error', JSON.stringify(p)); break }
  if (p.progress >= 3) { log(`progress done at poll #${i + 1} (progress=${p.progress})`); break }
}
const buf = await (await fetch(downloadURL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) })).arrayBuffer()
log(`downloaded ${(buf.byteLength / 1e6).toFixed(2)}MB`)
