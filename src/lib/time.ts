const UNITS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  secs: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
}

export const parseDuration = (s: string): number | undefined => {
  const str = s.toLowerCase().trim()
  if (!str) return undefined
  // HH:MM
  const hm = str.match(/^(\d{1,2}):(\d{2})$/)
  if (hm) {
    const hh = Number(hm[1])
    const mm = Number(hm[2])
    if (hh > 23 || mm > 59) return undefined
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0)
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
    return d.getTime() - now.getTime()
  }
  // duration like 10m, 1h30m
  let total = 0
  const re = /(\d+(?:\.\d+)?)\s*([a-z]+)?/g
  let m
  while ((m = re.exec(str))) {
    const num = Number(m[1])
    const unit = m[2] || 'm'
    const mul = UNITS[unit]
    if (!mul) return undefined
    total += num * mul
  }
  if (total <= 0) return undefined
  return total
}

export const formatDuration = (ms: number): string => {
  if (ms < 0) ms = 0
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const min = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const parts: string[] = []
  if (d) parts.push(`${d}h`)
  if (h) parts.push(`${h}j`)
  if (min) parts.push(`${min}m`)
  if (sec && parts.length === 0) parts.push(`${sec}d`)
  return parts.join(' ') || '0m'
}
