export type ChatMsg = { role: string; content: string }

const API_URL = 'https://chateverywhere.app/api/chat/'
const UA =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

export async function askLLM(messages: ChatMsg[]): Promise<string> {
  const prompt = messages[messages.length - 1].content
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      Origin: 'https://chateverywhere.app',
      Referer: 'https://chateverywhere.app/',
    },
    body: JSON.stringify({
      model: {
        id: 'gpt-4',
        name: 'GPT-4',
        maxLength: 32000,
        tokenLimit: 8000,
        completionTokenLimit: 5000,
        deploymentName: 'gpt-4',
      },
      messages,
      prompt,
      temperature: 0.5,
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (!res.ok) throw new Error(`chateverywhere HTTP ${res.status}`)
  const text = (await res.text()).trim()
  if (!text || text.includes('Vercel Security Checkpoint')) throw new Error('blocked by anti-bot checkpoint')
  return text
}