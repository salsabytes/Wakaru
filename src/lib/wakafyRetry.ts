const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

const MAX_ATTEMPTS = 3
const INITIAL_DELAY = 1500
const MAX_DELAY = 8000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function retryDelay(attempt: number): number {
  return Math.min(INITIAL_DELAY * 2 ** attempt, MAX_DELAY)
}

export async function fetchWithGatewayRetry(
  input: string | URL,
  init?: RequestInit,
  attempts = MAX_ATTEMPTS
): Promise<Response> {
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(input, init)

      if (!RETRYABLE_STATUSES.has(response.status)) {
        return response
      }

      lastError = new Error(`Wakafy HTTP ${response.status}`)

      if (attempt === attempts - 1) {
        return response
      }

      await response.body?.cancel().catch(() => {})
    } catch (error) {
      lastError = error

      if (attempt === attempts - 1) {
        break
      }
    }

    await sleep(retryDelay(attempt))
  }

  throw new Error(
    `Wakafy unavailable after ${attempts} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  )
}