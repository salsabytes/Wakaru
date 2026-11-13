export type ScraperErrorType =
  | 'private'
  | 'expired'
  | 'unsupported'
  | 'notfound'
  | 'rate_limited'
  | 'blocked'
  | 'network'
  | 'unknown'

export class ScraperError extends Error {
  type: ScraperErrorType
  platform?: string
  cause?: unknown

  constructor(
    message: string,
    opts: { type?: ScraperErrorType; platform?: string; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'ScraperError'
    this.type = opts.type ?? 'unknown'
    this.platform = opts.platform
    this.cause = opts.cause
  }
}

export const isScraperError = (e: unknown): e is ScraperError => e instanceof ScraperError

export const classifyError = (e: unknown, platform?: string): ScraperError => {
  if (isScraperError(e)) {
    if (platform && !e.platform) e.platform = platform
    return e
  }
  const msg = e instanceof Error ? e.message : String(e)
  const m = msg.toLowerCase()
  if (/(private|login required|forbidden|403)/.test(m)) {
    return new ScraperError(msg, { type: 'private', platform })
  }
  if (/(expired|not found|404|doesn'?t exist|deleted)/.test(m)) {
    return new ScraperError(msg, { type: 'notfound', platform })
  }
  if (/(rate limit|429|too many)/.test(m)) {
    return new ScraperError(msg, { type: 'rate_limited', platform })
  }
  if (/(geo|blocked|blocked in|unavailable)/.test(m)) {
    return new ScraperError(msg, { type: 'blocked', platform })
  }
  if (/(timeout|network|fetch|econn|enotfound|socket)/.test(m)) {
    return new ScraperError(msg, { type: 'network', platform })
  }
  if (/(not.*(link|supported)|unsupported)/.test(m)) {
    return new ScraperError(msg, { type: 'unsupported', platform })
  }
  return new ScraperError(msg, { type: 'unknown', platform, cause: e })
}
