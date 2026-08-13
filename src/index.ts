import { execFileSync } from 'node:child_process'
import { connectToWhatsApp, shutdown } from './socket.ts'
import { handleMessagesUpsert } from './handlers/messages.ts'
import { logger } from './lib/logger.ts'
import { checkForUpdate } from './lib/updater.ts'
import pkg from '../package.json' with { type: 'json' }

// boot marker — lets you confirm the running process is actually this build
// (after a fix, the short commit hash must change on restart)
let commit = '?'
try {
  commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  // git missing — marker still prints, just without a hash
}
logger.info(`Wakaru v${pkg.version} (${commit})`)

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
