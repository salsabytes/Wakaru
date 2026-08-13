// one global slot pool shared by every command — multitasking by default, no per-command flags.
// ponytail: single pool caps ALL commands (downloads included); worst case N concurrent downloads
// ≈ N × 30MB × ~2.5 (buffer+base64) ≈ 300MB at N=4 — split download/light pools if RAM spikes.
const SLOT_LIMIT = 4
let running = 0
const waiters: (() => void)[] = []
export async function withSlot(fn: () => Promise<void>): Promise<void> {
  while (running >= SLOT_LIMIT) {
    await new Promise<void>((r) => waiters.push(r))
  }
  running++
  try {
    await fn()
  } finally {
    running--
    waiters.shift()?.()
  }
}
