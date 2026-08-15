import { execFileSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import { join } from 'node:path'
import { connectToWhatsApp, shutdown } from './socket.ts'
import { handleMessagesUpsert } from './handlers/messages.ts'
import { logger } from './lib/logger.ts'
import { checkForUpdate } from './lib/updater.ts'
import pkg from '../package.json' with { type: 'json' }

// libsignal logs its session lifecycle to console.info/warn on every media send —
// filtered at the console so the fix survives reinstalls
const signalSpam = [
  'Closing session:',
  'Opening session:',
  'Session already closed',
  'Session already open',
  'Removing old closed session:',
  'Migrating session to:',
]
const dropSignal = (...args: unknown[]): boolean => {
  const first = args[0]
  return typeof first === 'string' && signalSpam.some((s) => first.startsWith(s))
}
const info = console.info.bind(console)
const warn = console.warn.bind(console)
console.info = (...args: unknown[]) => { if (!dropSignal(...args)) info(...args) }
console.warn = (...args: unknown[]) => { if (!dropSignal(...args)) warn(...args) }
logger.info('libsignal session spam filter: active')

// boot marker — lets you confirm the running process is actually this build
// (after a fix, the short commit hash must change on restart)
let commit = '?'
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  // git missing — marker still prints, just without a hash
}
logger.info(`Wakaru v${pkg.version} (${commit})`)

// binaries uploaded via a file manager (Pterodactyl etc.) often lose the +x bit — fix once at boot
if (process.platform !== 'win32') {
  for (const name of ['sticker', 'audio']) {
    try {
      chmodSync(join(import.meta.dirname, '..', 'bin', name), 0o755)
    } catch {
      // binary not there yet — fine, the feature just stays disabled
    }
  }
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection:', err)
})

connectToWhatsApp(handleMessagesUpsert)
  .then(() => checkForUpdate())
  .catch((err) => {
    logger.error('Failed to start bot:', err)
    process.exit(1)
  })
