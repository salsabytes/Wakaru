import {
  antilinkConfig,
  ANTILINK_MAX_WARN_MAX,
  ANTILINK_MAX_WARN_MIN,
  setAntilinkKick,
  setAntilinkMaxWarn,
  toggleAntilink,
} from '../../lib/groupSettings.ts'
import type { Button } from '../../lib/buttons.ts'
import type { Sender } from '../../lib/sender.ts'

const onOff = (w: string): boolean | undefined =>
  w === 'on' || w === 'enable' || w === '1' ? true : w === 'off' || w === 'disable' || w === '0' ? false : undefined

// "max warn" = tap button, then type a number
const pending = new Map<string, number>()
const PENDING_TTL = 2 * 60_000
const PENDING_MAX = 500

const prunePending = (now = Date.now()): void => {
  for (const [key, at] of pending) if (now - at > PENDING_TTL) pending.delete(key)
  while (pending.size > PENDING_MAX) pending.delete(pending.keys().next().value!)
}

const keyOf = (chat: string, sender: string): string => `${chat}:${sender}`
const dropPending = (chat: string, sender: string): void => {
  pending.delete(keyOf(chat, sender))
}
export const hasPendingAntilinkMax = (chat: string, sender: string): boolean => {
  const at = pending.get(keyOf(chat, sender))
  if (!at) return false
  if (Date.now() - at > PENDING_TTL) {
    dropPending(chat, sender)
    return false
  }
  return true
}

const panel = (chat: string): { text: string; buttons: Button[] } => {
  const c = antilinkConfig(chat)
  const text = [
    '🛡️ *Anti-Link*',
    '',
    `Status : ${c.on ? 'ON ✅' : 'OFF ⛔'}`,
    `Kick   : ${c.kick ? `ON — kick setelah ${c.maxWarn}x pelanggaran` : 'OFF — hanya hapus pesan'}`,
    '',
    'Ketuk tombol buat ngatur. Owner, admin grup, dan bot sendiri nggak kena.',
  ].join('\n')
  return {
    text,
    buttons: [
      { id: 'antilink:toggle', text: c.on ? '⛔ Matikan' : '✅ Aktifkan' },
      { id: 'antilink:kick', text: c.kick ? '👢 Kick: ON' : '👢 Kick: OFF' },
      { id: 'antilink:max', text: `⚠️ Maks warn: ${c.maxWarn}` },
    ],
  }
}

const sendPanel = async (ctx: CommandContext): Promise<void> => {
  const { text, buttons } = panel(ctx.chat)
  try {
    await ctx.sendButtons(buttons, text)
  } catch {
    await ctx.reply(text)
  }
}

// only eats the next text if this user was just asked for a number
export async function handleAntilinkMaxInput(
  chat: string,
  sender: string,
  text: string,
  send: Sender,
): Promise<boolean> {
  if (!hasPendingAntilinkMax(chat, sender)) return false
  const t = text.trim().toLowerCase()
  if (/^(batal|cancel|gajadi|gak jadi|nggak jadi)$/.test(t)) {
    dropPending(chat, sender)
    await send.text('Dibatalkan. Maks warn tidak diubah.')
    return true
  }
  const n = Number(t)
  if (!Number.isInteger(n) || n < ANTILINK_MAX_WARN_MIN || n > ANTILINK_MAX_WARN_MAX) {
    await send.text(
      `Masukkan angka ${ANTILINK_MAX_WARN_MIN}-${ANTILINK_MAX_WARN_MAX} ya. Ketik "batal" buat berhenti.`,
    )
    return true
  }
  dropPending(chat, sender)
  setAntilinkMaxWarn(chat, n)
  const { text: body, buttons } = panel(chat)
  await send.buttons(buttons, body).catch(() => send.text(body))
  return true
}

export default {
  name: 'antilink',
  desc: 'anti-link per group with buttons: on/off, kick on/off, max warns before kick',
  aliases: ['antipromosi', 'nolink'],
  groupOnly: true,
  adminOnly: true,
  run: async (ctx: CommandContext) => {
    const [raw, val] = ctx.args.map((a) => a.toLowerCase())
    const sub = raw ?? ''

    if (sub === 'toggle' || sub === 'on' || sub === 'off' || sub === 'enable' || sub === 'disable') {
      toggleAntilink(ctx.chat, onOff(sub) ?? undefined)
    } else if (sub === 'kick') {
      const on = onOff(val ?? '')
      setAntilinkKick(ctx.chat, on === undefined ? !antilinkConfig(ctx.chat).kick : on)
    } else if (sub === 'max' || sub === 'warn' || sub === 'limit') {
      const n = Number(val)
      if (val !== undefined && Number.isFinite(n)) {
        setAntilinkMaxWarn(ctx.chat, n)
      } else {
        // no number yet, ask for it
        prunePending()
        pending.set(keyOf(ctx.chat, ctx.sender), Date.now())
        return ctx.reply(
          `Ketik angka ${ANTILINK_MAX_WARN_MIN}-${ANTILINK_MAX_WARN_MAX} untuk batas maksimal warn sebelum kick.\nKetik "batal" buat berhenti.`,
        )
      }
    }

    await sendPanel(ctx)
  },
} satisfies Command