import { cfg } from '../config.ts'

export type AiProvider = 'wakafy' | 'openai-compatible'

export const botAiProvider = (): AiProvider => {
  const v = String(process.env.WAKARU_AI_PROVIDER || cfg('aiProvider', 'wakafy')).toLowerCase()
  return v === 'openai-compatible' || v === 'openai' ? 'openai-compatible' : 'wakafy'
}

export const botAiBaseUrl = (): string => String(process.env.WAKARU_AI_BASE_URL || cfg('aiBaseUrl', '') || '').trim()
export const botAiApiKey = (): string => String(process.env.WAKARU_AI_API_KEY || cfg('aiApiKey', '') || '').trim()
export const botAiModel = (): string => String(process.env.WAKARU_AI_MODEL || cfg('aiModel', '') || '').trim()
export const botAiPath = (): string => String(process.env.WAKAFY_AI_PATH || cfg('aiPath', '') || '').trim()
