const R = '\x1b[0m'
const C: Record<string, string> = process.stdout.isTTY
  ? { DEBU: '\x1b[1;38;5;63m', INFO: '\x1b[1;38;5;86m', WARN: '\x1b[1;38;5;192m', ERRO: '\x1b[1;38;5;204m', FATA: '\x1b[1;38;5;134m' }
  : { DEBU: '', INFO: '', WARN: '', ERRO: '', FATA: '' }

const now = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function emit(level: string, msg: string, rest: unknown[], toErr = false): void {
  const line = `${now()} ${C[level]}${level}${R} ${msg}`
  if (toErr) console.error(line, ...rest)
  else console.log(line, ...rest)
}

export const logger = {
  debug: (msg: string, ...rest: unknown[]) => emit('DEBU', msg, rest),
  info: (msg: string, ...rest: unknown[]) => emit('INFO', msg, rest),
  warn: (msg: string, ...rest: unknown[]) => emit('WARN', msg, rest),
  error: (msg: string, ...rest: unknown[]) => emit('ERRO', msg, rest, true),
  fatal: (msg: string, ...rest: unknown[]) => emit('FATA', msg, rest, true),
}