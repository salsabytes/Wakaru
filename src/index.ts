import readline from 'readline'
import NodeCache from '@cacheable/node-cache'
import qrcode from 'qrcode-terminal'
import { Boom } from '@hapi/boom'
import {
  Browsers,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
  type BaileysEventMap,
  type CacheStore,
  type GroupMetadata,
  type WASocket,
} from 'baileys'
import { getMessage } from './store.ts'
import { handleMessagesUpsert } from './handlers/messages.ts'

const SESSION_DIR = process.env.SESSION_DIR ?? 'sessions'
const usePairingCode = process.argv.includes('--use-pairing-code') || !!process.env.PAIRING_CODE

// logger senyap: baileys butuh objek logger, tapi kita gak mau noise-nya
const logger = {
  level: 'silent',
  child: () => logger,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  silent: () => {},
}

const msgRetryCounterCache = new NodeCache({ stdTTL: 60 * 60 * 24 }) as CacheStore
const callOfferCache = new NodeCache({ stdTTL: 5 * 60 }) as CacheStore
const placeholderResendCache = new NodeCache({ stdTTL: 5 * 60 }) as CacheStore
const groupCache = new NodeCache({ stdTTL: 5 * 60, maxKeys: 100 }) as CacheStore

export let waka: WASocket
let isShuttingDown = false
let isAskingPairingCode = false
let reconnectAttempts = 0
let reconnectTimer: ReturnType<typeof setTimeout> | undefined

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text: string) => new Promise<string>((resolve) => rl.question(text, resolve))

async function connectToWhatsApp(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR)
  waka = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    getMessage,
    browser: Browsers.appropriate('Google Chrome'),
    markOnlineOnConnect: true,
    cachedGroupMetadata: async (jid) => {
      const cached = groupCache.get<GroupMetadata>(jid)
      if (cached) return cached
      const metadata = await waka.groupMetadata(jid)
      if (metadata) groupCache.set(jid, metadata)
      return metadata
    },
    msgRetryCounterCache,
    callOfferCache,
    placeholderResendCache,
    generateHighQualityLinkPreview: true,
  })

  registerEvents(saveCreds)
}

function registerEvents(saveCreds: () => Promise<void>): void {
  waka.ev.on('connection.update', handleConnectionUpdate)
  waka.ev.on('creds.update', saveCreds)
  waka.ev.on('messages.upsert', handleMessagesUpsert)
}

async function handleConnectionUpdate(
  update: BaileysEventMap['connection.update'],
): Promise<void> {
  const { connection, lastDisconnect, qr } = update
  if (connection === 'close') {
    const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode
    if (statusCode === DisconnectReason.loggedOut) {
      console.error(`Koneksi ditutup: kamu sudah logout. Hapus folder "${SESSION_DIR}/" lalu scan ulang.`)
      process.exit(1)
    }
    if (!isShuttingDown) {
      const delay = Math.min(3000 * 2 ** reconnectAttempts, 60_000)
      reconnectAttempts++
      console.warn(
        `Koneksi terputus${statusCode ? ` (status ${statusCode})` : ''} — mencoba reconnect dalam ${delay / 1000}s...`,
      )
      reconnectTimer = setTimeout(connectToWhatsApp, delay)
    }
    return
  }

  if (connection === 'open') {
    reconnectAttempts = 0
    console.log('✅ Bot berhasil terhubung!')
    return
  }

  if (!qr) return

  if (usePairingCode && !waka.authState.creds.registered && !isAskingPairingCode) {
    isAskingPairingCode = true
    try {
      const phoneNumber = await question(
        'Masukkan nomor HP (format internasional, contoh: 628123456789): ',
      )
      const code = await waka.requestPairingCode(phoneNumber)
      console.log(`\nKode pairing kamu: ${code}\n`)
    } finally {
      isAskingPairingCode = false
    }
  } else {
    console.log('\n📱 Scan QR ini dengan WhatsApp  (HP > Perangkat Tertaut):')
    qrcode.generate(qr, { small: true })
  }
}

async function shutdown(signal: string): Promise<void> {
  isShuttingDown = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  console.log(`Menerima ${signal} — mematikan bot...`)
  try {
    await waka?.end(new Error('Bot dimatikan manual'))
  } catch (err) {
    console.error('Gagal menutup koneksi:', err)
  }
  rl.close()
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err)
})

connectToWhatsApp().catch((err) => {
  console.error('Gagal memulai bot:', err)
  process.exit(1)
})