import { UA } from './scrapers/http.ts'

export interface WikiResult {
  title: string
  extract: string
  url: string
}

// one call returns top hit + intro extract + canonical url
const api = async (sub: string, query: string): Promise<WikiResult | null> => {
  const u = `https://${sub}.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=1&prop=extracts%7Cinfo&exintro&explaintext&exsentences=3&redirects=1&inprop=url`
  const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`wikipedia http ${res.status}`)
  const j = (await res.json()) as {
    query?: { pages?: Record<string, { title?: string; extract?: string; fullurl?: string }> }
  }
  const p = j.query?.pages ? Object.values(j.query.pages)[0] : undefined
  if (!p?.title || !p.extract) return null
  return { title: p.title, extract: p.extract, url: p.fullurl ?? '' }
}

// bot lang doubles as wiki subdomain; null = no article, throw = network down
export const searchWiki = async (query: string, lang: string): Promise<WikiResult | null> => {
  const sub = /^[a-z]{2,3}$/.test(lang) ? lang : 'en'
  try {
    return await api(sub, query)
  } catch {
    if (sub === 'en') throw new Error('wikipedia unreachable')
    return api('en', query)
  }
}

if (process.env.WIKI_SELFTEST) {
  const r = await searchWiki('jakarta', 'id')
  if (!r?.title.includes('Jakarta') || !r.extract || !r.url.includes('wikipedia.org')) {
    throw new Error('wiki id fail')
  }
  if (await searchWiki('zzzzzqqqqqnonexistent', 'id')) throw new Error('wiki empty fail')
  console.log('wiki self-check ok')
  process.exit(0)
}
