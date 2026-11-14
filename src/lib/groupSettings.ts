import { readJson, register, saveJsonNow } from './disk.ts'

export interface GroupSettings {
  antilink?: boolean
  antilinkKick?: boolean // kick at max warns? default true
  antilinkMaxWarn?: number // warns before kick, default 3
  warns?: Record<string, number> // sender num -> strike count
}

export const ANTILINK_DEFAULT_MAX_WARN = 3
export const ANTILINK_MAX_WARN_MIN = 1
export const ANTILINK_MAX_WARN_MAX = 10

const FILE = 'groups.json'
const store = readJson<Record<string, GroupSettings>>(FILE, {})
register(FILE, () => store)

const persist = (): void => {
  void saveJsonNow(FILE)
}

export const getGroupSettings = (jid: string): GroupSettings => store[jid] ?? {}

// antilink config with defaults filled in
export const antilinkConfig = (jid: string): { on: boolean; kick: boolean; maxWarn: number } => {
  const s = store[jid] ?? {}
  return {
    on: s.antilink ?? false,
    kick: s.antilinkKick ?? true,
    maxWarn: s.antilinkMaxWarn ?? ANTILINK_DEFAULT_MAX_WARN,
  }
}

export const setGroupSetting = (jid: string, key: keyof GroupSettings, val: any) => {
  if (!store[jid]) store[jid] = {}
  ;(store[jid] as any)[key] = val
  persist()
}

export const toggleAntilink = (jid: string, on?: boolean): boolean => {
  const cur = store[jid]?.antilink ?? false
  const next = on === undefined ? !cur : on
  if (!store[jid]) store[jid] = {}
  store[jid].antilink = next
  // off clears strikes, so re-enabling starts fresh
  if (!next) delete store[jid].warns
  persist()
  return next
}

export const setAntilinkKick = (jid: string, on: boolean): boolean => {
  if (!store[jid]) store[jid] = {}
  store[jid].antilinkKick = on
  persist()
  return on
}

export const setAntilinkMaxWarn = (jid: string, n: unknown): number => {
  const v = Math.round(Number(n))
  const clamped = Number.isFinite(v)
    ? Math.min(ANTILINK_MAX_WARN_MAX, Math.max(ANTILINK_MAX_WARN_MIN, v))
    : ANTILINK_DEFAULT_MAX_WARN
  if (!store[jid]) store[jid] = {}
  store[jid].antilinkMaxWarn = clamped
  persist()
  return clamped
}

// add a strike, return the new total
export const addAntilinkWarn = (jid: string, user: string): number => {
  if (!store[jid]) store[jid] = {}
  const warns = (store[jid].warns ??= {})
  const n = (warns[user] ?? 0) + 1
  warns[user] = n
  persist()
  return n
}

export const resetAntilinkWarns = (jid: string, user: string): void => {
  const warns = store[jid]?.warns
  if (!warns) return
  delete warns[user]
  persist()
}
