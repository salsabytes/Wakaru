import { connectToWhatsApp, shutdown } from './socket.ts'
import { handleMessagesUpsert } from './handlers/messages.ts'
import { logger } from './lib/logger.ts'

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled rejection:', err)
})

connectToWhatsApp(handleMessagesUpsert).catch((err) => {
  logger.error('Failed to start bot:', err)
  process.exit(1)
})
