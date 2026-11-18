import { cpus, freemem, hostname, loadavg, platform, release, totalmem, type, uptime } from 'node:os'
import { formatDuration } from '../../lib/time.ts'

const mb = (n: number): string => `${(n / 1024 / 1024).toFixed(0)} MB`

const pct = (used: number, total: number): string => `${((used / total) * 100).toFixed(1)}%`

export default {
  name: 'stats',
  desc: 'info device & server tempat bot jalan',
  aliases: ['spec', 'server'],
  run: async (ctx: CommandContext) => {
    const cpu = cpus()
    const total = totalmem()
    const free = freemem()
    const used = total - free
    const mem = process.memoryUsage()
    const botUptime = process.uptime() * 1000
    const lines = [
      `*${hostname()}*`,
      `${type()} ${platform()} ${release()} · ${cpu[0]?.model?.trim() || 'unknown'} (${cpu.length} core)`,
      `RAM: ${mb(used)} / ${mb(total)} (${pct(used, total)}) · free ${mb(free)}`,
      `Load: ${loadavg().map((n) => n.toFixed(2)).join(' / ')}`,
      `Uptime OS: ${formatDuration(uptime() * 1000)}`,
      `Uptime bot: ${formatDuration(botUptime)}`,
      `Node: ${process.version} · PID ${process.pid}`,
      `Proses: rss ${mb(mem.rss)} · heap ${mb(mem.heapUsed)} / ${mb(mem.heapTotal)}`,
    ]
    return ctx.reply(lines.join('\n'))
  },
} satisfies Command
