import os from 'node:os'

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }

  return `${value.toFixed(2)} ${units[unit]}`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  return [
    days ? `${days}d` : '',
    hours ? `${hours}h` : '',
    minutes ? `${minutes}m` : '',
    `${secs}s`
  ].filter(Boolean).join(' ')
}

export default {
  name: 'stats',
  aliases: ['status', 'runtime'],
  desc: 'Melihat statistik bot dan perangkat',
  async run(ctx) {
    const cpus = os.cpus()
    const memory = process.memoryUsage()
    const totalMemory = os.totalmem()
    const freeMemory = os.freemem()
    const usedMemory = totalMemory - freeMemory
    const cpu = cpus[0]?.model ?? 'Unknown'
    const cpuSpeed = cpus[0]?.speed ?? 0
    const memoryPercent = (usedMemory / totalMemory) * 100

    const text = [
      '📊 *WAKARU BOT STATISTICS*',
      '',
      '┌─ *BOT INFORMATION*',
      `│ Node.js: ${process.version}`,
      `│ Process Uptime: ${formatUptime(process.uptime())}`,
      `│ RAM Usage: ${formatBytes(memory.rss)}`,
      `│ Heap Used: ${formatBytes(memory.heapUsed)}`,
      `│ Heap Total: ${formatBytes(memory.heapTotal)}`,
      '└──────────────',
      '',
      '┌─ *SYSTEM INFORMATION*',
      `│ Hostname: ${os.hostname()}`,
      `│ OS: ${os.type()}`,
      `│ Release: ${os.release()}`,
      `│ Architecture: ${os.arch()}`,
      `│ CPU: ${cpu}`,
      `│ CPU Speed: ${cpuSpeed} MHz`,
      `│ CPU Cores: ${cpus.length}`,
      `│ System Uptime: ${formatUptime(os.uptime())}`,
      '└──────────────',
      '',
      '┌─ *MEMORY INFORMATION*',
      `│ Total: ${formatBytes(totalMemory)}`,
      `│ Used: ${formatBytes(usedMemory)}`,
      `│ Free: ${formatBytes(freeMemory)}`,
      `│ Usage: ${memoryPercent.toFixed(2)}%`,
      '└──────────────',
      '',
      '⚡ *Wakaru is running smoothly!*'
    ].join('\n')

    await ctx.reply(text)
  }
} satisfies Command