import { readJson, register, saveJson } from '../disk.ts'

export type TaskIntent = 'chat' | 'build' | 'bot_action' | 'repo_read' | 'repo_edit' | 'research' | 'clarify'

export interface AiTask {
  intent: TaskIntent
  goal: string
  plan: string[]
  step: number
  status: 'active' | 'done' | 'blocked'
  needsWrite: boolean
  touched: string[]
  notes: string[]
  updatedAt: number
}

const TASK_TTL = 2 * 60 * 60 * 1000
const MAX_TASKS = 500

const tasks = new Map<string, AiTask>()

for (const [k, v] of Object.entries(readJson<Record<string, AiTask>>('ai-task.json', {}))) {
  if (!v || typeof v !== 'object') continue
  if (Date.now() - (Number(v.updatedAt) || 0) > TASK_TTL) continue
  tasks.set(k, {
    intent: (v.intent as TaskIntent) || 'chat',
    goal: String(v.goal || ''),
    plan: Array.isArray(v.plan) ? v.plan.map(String).slice(0, 8) : [],
    step: Number(v.step) || 0,
    status: v.status === 'done' || v.status === 'blocked' ? v.status : 'active',
    needsWrite: !!v.needsWrite,
    touched: Array.isArray(v.touched) ? v.touched.map(String).slice(-12) : [],
    notes: Array.isArray(v.notes) ? v.notes.map(String).slice(-4) : [],
    updatedAt: Number(v.updatedAt) || Date.now(),
  })
}

register('ai-task.json', () => Object.fromEntries(tasks.entries()))

const prune = (): void => {
  const now = Date.now()
  for (const [k, v] of tasks) if (now - v.updatedAt > TASK_TTL) tasks.delete(k)
  while (tasks.size > MAX_TASKS) tasks.delete(tasks.keys().next().value!)
}

export const getTask = (key: string): AiTask | undefined => {
  const t = tasks.get(key)
  if (!t) return undefined
  if (Date.now() - t.updatedAt > TASK_TTL) {
    tasks.delete(key)
    return undefined
  }
  return t
}

export const setTask = (key: string, task: Omit<AiTask, 'updatedAt'>): AiTask => {
  const next: AiTask = { ...task, updatedAt: Date.now() }
  tasks.set(key, next)
  prune()
  saveJson('ai-task.json')
  return next
}

export const updateTask = (key: string, patch: Partial<AiTask>): AiTask | undefined => {
  const cur = getTask(key)
  if (!cur) return undefined
  const next: AiTask = {
    ...cur,
    ...patch,
    plan: Array.isArray(patch.plan) ? patch.plan.slice(0, 8) : cur.plan,
    touched: Array.isArray(patch.touched) ? patch.touched.slice(-12) : cur.touched,
    notes: Array.isArray(patch.notes) ? patch.notes.slice(-4) : cur.notes,
    updatedAt: Date.now(),
  }
  tasks.set(key, next)
  prune()
  saveJson('ai-task.json')
  return next
}

export const clearTask = (key: string): void => {
  if (tasks.delete(key)) saveJson('ai-task.json')
}

export const isActiveRepoTask = (key: string): boolean => {
  const t = getTask(key)
  return !!t && t.status === 'active' && (t.intent === 'repo_read' || t.intent === 'repo_edit' || t.intent === 'research')
}

const RECENT_WINDOW = 30 * 60 * 1000

export const isRecentRepoTask = (key: string, windowMs = RECENT_WINDOW): boolean => {
  const t = getTask(key)
  return !!t && (t.intent === 'repo_edit' || t.intent === 'repo_read') && Date.now() - t.updatedAt <= windowMs
}

export const formatTaskHint = (key: string): string => {
  const t = getTask(key)
  if (!t) return ''
  const parts = [`goal: ${t.goal || '-'}`, `status: ${t.status}`]
  if (t.touched.length) parts.push(`changed: ${t.touched.slice(-6).join(', ')}`)
  return parts.join(' | ')
}

export const formatTaskScratchpad = (key: string): string => {
  const t = getTask(key)
  if (!t || t.status !== 'active') return ''
  const lines = [`goal: ${t.goal || '-'}`]
  if (t.plan.length) lines.push(`plan: ${t.plan.slice(0, 5).join(' | ')}`)
  if (t.step) lines.push(`step: ${t.step}`)
  if (t.touched.length) lines.push(`touched: ${t.touched.slice(-6).join(', ')}`)
  if (t.notes.length) lines.push(`notes: ${t.notes.slice(-2).join(' ; ')}`)
  return lines.join('\n')
}
