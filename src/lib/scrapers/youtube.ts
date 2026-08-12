import { UA } from './http.ts'

export interface YtResult {
  id: string
  title: string
}

export async function searchYouTube(query: string): Promise<YtResult[]> {
  const res = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
    headers: {
      'User-Agent': UA,
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: 'CONSENT=YES+cb.20240101-00-p0.en+FX+111; SOCS=CAI',
    },
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) throw new Error(`youtube search http ${res.status}`)
  const blob = (await res.text()).match(/var ytInitialData = ({[\s\S]*?});<\/script>/)?.[1]
  if (!blob) throw new Error('youtube: no search data')
  let j: any
  try {
    j = JSON.parse(blob)
  } catch {
    throw new Error('youtube: bad search data')
  }
  const raws = j?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents ?? []
  const items = raws.flatMap((s: any) => s?.itemSectionRenderer?.contents ?? [])
  return items
    .filter((i: any) => i?.videoRenderer?.videoId)
    .map((i: any) => ({
      id: i.videoRenderer.videoId,
      title: (i.videoRenderer.title?.runs?.[0]?.text ?? '').trim(),
    }))
    .filter((v: YtResult) => v.title)
    .slice(0, 5)
}
