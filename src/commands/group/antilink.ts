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
import { tx } from '../../lib/lang.ts'

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

const panel = async (chat: string): Promise<{ text: string; buttons: Button[] }> => {
  const c = antilinkConfig(chat)
  const status = await tx(c.on ? 'toggleOn' : 'toggleOff')
  const text = [
    await tx('antilinkTitle'),
    '',
    await tx('statusLine', { status }),
    c.kick ? await tx('antilinkKickOn', { n: c.maxWarn }) : await tx('antilinkKickOff'),
    '',
    await tx('antilinkHint'),
  ].join('\n')
  return {
    text,
    buttons: [
      { id: 'antilink:toggle', text: await tx(c.on ? 'disableButton' : 'enableButton') },
      { id: 'antilink:kick', text: await tx(c.kick ? 'antilinkKickButtonOn' : 'antilinkKickButtonOff') },
      { id: 'antilink:max', text: await tx('antilinkMaxButton', { n: c.maxWarn }) },
    ],
  }
}

const sendPanel = async (ctx: CommandContext): Promise<void> => {
  const { text, buttons } = await panel(ctx.chat)
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
    await send.text(await tx('antilinkMaxCancelled'))
    return true
  }
  const n = Number(t)
  if (!Number.isInteger(n) || n < ANTILINK_MAX_WARN_MIN || n > ANTILINK_MAX_WARN_MAX) {
    await send.text(await tx('antilinkMaxInvalid', { min: ANTILINK_MAX_WARN_MIN, max: ANTILINK_MAX_WARN_MAX }))
    return true
  }
  dropPending(chat, sender)
  setAntilinkMaxWarn(chat, n)
  const { text: body, buttons } = await panel(chat)
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
          await tx('antilinkMaxPrompt', { min: ANTILINK_MAX_WARN_MIN, max: ANTILINK_MAX_WARN_MAX }),
        )
      }
    }

    await sendPanel(ctx)
  },
} satisfies Command