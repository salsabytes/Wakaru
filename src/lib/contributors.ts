import NodeCache from '@cacheable/node-cache'

const FALLBACK = 'Salsabila R. (salsabytes, creator/maintainer) and VonAntaraxia (github.com/VonAntaraxia)'

const cache = new NodeCache({ stdTTL: 24 * 60 * 60 }) as {
  get(k: string): string | undefined
  set(k: string, v: string): boolean
}

// fetched once a day, falls back to the static list when GitHub is unreachable
export const fetchContributors = async (): Promise<string> => {
  const cached = cache.get('contributors')
  if (cached) return cached
  try {
    const res = await fetch('https://api.github.com/repos/salsabytes/Wakaru/contributors?per_page=100')
    if (!res.ok) return FALLBACK
    const list = (await res.json()) as { login: string; html_url: string }[]
    // creator line in prompt.ts already names salsabytes — drop them here so the AI doesn't treat them as two people
    const others = list.filter((c) => c.login !== 'salsabytes')
    const line = others.length ? others.map((c) => `${c.login} (${c.html_url})`).join(', ') : 'none yet'
    cache.set('contributors', line)
    return line
  } catch {
    return FALLBACK
  }
}
