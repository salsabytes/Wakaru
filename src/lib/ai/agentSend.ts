import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { AgentPathError, isDeniedPath, resolveRepoRel } from './agentFiles.ts'
import { fileMime } from '../fileinfo.ts'

/**
 * `@send <path>` - drop a real file, or a whole folder as .zip, into the chat.
 *
 * Why a hand-written zip writer: the project has no zip dependency,
 * and the agent's own rules forbid adding one.
 *
 * Safety: only paths the repo tools may touch are sendable.
 * config.json, .env, sessions/ and data/ stay blocked,
 * so the model can never leak secrets into the chat.
 */

const MAX_SEND_BYTES = 30 * 1024 * 1024 // one document
const MAX_ZIP_FILES = 400

interface ZipEntry {
  name: string
  data: Buffer
}

const dosTime = (d: Date): number => (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
const dosDate = (d: Date): number => ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()

/** Build a valid .zip in memory. Deflate per entry, fall back to store when smaller. */
export const zipFiles = (files: ZipEntry[], now = new Date()): Buffer => {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  const time = dosTime(now) & 0xffff
  const date = dosDate(now) & 0xffff
  for (const f of files) {
    const name = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8')
    const sum = crc32(f.data) >>> 0
    const packed = deflateRawSync(f.data)
    const store = packed.length >= f.data.length
    const body = store ? f.data : packed
    const method = store ? 0 : 8

    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4) // version needed
    head.writeUInt16LE(0x0800, 6) // UTF-8 file names
    head.writeUInt16LE(method, 8)
    head.writeUInt16LE(time, 10)
    head.writeUInt16LE(date, 12)
    head.writeUInt32LE(sum, 14)
    head.writeUInt32LE(body.length, 18)
    head.writeUInt32LE(f.data.length, 22)
    head.writeUInt16LE(name.length, 26)
    head.writeUInt16LE(0, 28)
    local.push(head, name, body)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4) // version made by
    dir.writeUInt16LE(20, 6) // version needed
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(method, 10)
    dir.writeUInt16LE(time, 12)
    dir.writeUInt16LE(date, 14)
    dir.writeUInt32LE(sum, 16)
    dir.writeUInt32LE(body.length, 20)
    dir.writeUInt32LE(f.data.length, 24)
    dir.writeUInt16LE(name.length, 28)
    dir.writeUInt16LE(0, 30) // extra len
    dir.writeUInt16LE(0, 32) // comment len
    dir.writeUInt16LE(0, 34) // disk start
    dir.writeUInt16LE(0, 36) // internal attrs
    dir.writeUInt32LE(0, 38) // external attrs
    dir.writeUInt32LE(offset, 42)
    central.push(dir, name)

    offset += head.length + name.length + body.length
  }
  const tail = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(tail.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, tail, end])
}

export interface SendPayload {
  fileName: string
  data: Buffer
  mime: string
  note: string
}

const walk = async (root: string, dir: string, rel: string, out: ZipEntry[]): Promise<void> => {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name.startsWith('.')) continue
    const childRel = rel ? `${rel}/${e.name}` : e.name
    if (isDeniedPath(childRel)) continue
    const abs = join(dir, e.name)
    if (e.isDirectory()) {
      await walk(root, abs, childRel, out)
      continue
    }
    if (!e.isFile()) continue
    const st = await stat(abs)
    if (st.size > MAX_SEND_BYTES) continue // skip single huge blobs
    out.push({ name: childRel, data: await readFile(abs) })
    if (out.length >= MAX_ZIP_FILES) return
  }
}

/** Give back what to send: a file as-is, or a folder packed as .zip. */
export const prepareSend = async (root: string, input: string): Promise<SendPayload> => {
  const raw = String(input ?? '').trim().replace(/^["'`]+|["'`]+$/g, '')
  if (!raw) throw new AgentPathError('@send needs a path')
  const rel = /^\.?\/?$/.test(raw) ? '' : resolveRepoRel(root, raw)
  const abs = rel ? join(root, rel) : root
  const st = await stat(abs).catch(() => null)
  if (!st) throw new AgentPathError(`not found: ${rel || '.'}`)
  if (st.isFile()) {
    if (st.size > MAX_SEND_BYTES) throw new AgentPathError(`too large: ${st.size} bytes (max ${MAX_SEND_BYTES >> 20}MB)`)
    const data = await readFile(abs)
    return {
      fileName: basename(abs),
      data,
      mime: fileMime('documentMessage', undefined, basename(abs)),
      note: `${data.length} bytes`,
    }
  }
  const files: ZipEntry[] = []
  // entries keep the folder name, so unzipping gives `src/...`, not a bare dump
  await walk(root, abs, rel ? basename(abs) : '', files)
  if (!files.length) throw new AgentPathError(`nothing to send in ${rel || '.'} (empty or blocked)`)
  const data = zipFiles(files)
  if (data.length > MAX_SEND_BYTES) throw new AgentPathError(`zip too large: ${data.length} bytes`)
  return {
    fileName: `${rel ? basename(abs) : 'repo'}.zip`,
    data,
    mime: 'application/zip',
    note: `${files.length} file, ${data.length} bytes`,
  }
}

/** Send it to the chat. Returns the tool result line the model will read. */
export const sendRepoPath = async (ctx: CommandContext, root: string, input: string): Promise<string> => {
  try {
    const payload = await prepareSend(root, input)
    await ctx.sendDocument(payload.data, payload.fileName, payload.mime)
    return `[send] sent ${payload.fileName} to this chat (${payload.note})`
  } catch (err) {
    return `[send] error: ${(err as Error).message}`
  }
}
