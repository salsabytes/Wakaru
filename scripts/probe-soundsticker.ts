// Diagnose `.ss` (sound sticker) on a machine where it sends a silent sticker.
// Run from the repo root:  bun scripts/probe-soundsticker.ts
//
// Every check prints PASS/FAIL with the measured value. The first FAIL is the
// bug — the rest is context, so the whole run is printed even after a failure.
// Nothing here touches WhatsApp: the send path is exercised up to the encoded
// protobuf bytes, which is where a silent sticker comes from.
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'

const exec = promisify(execFile)
const require = createRequire(import.meta.url)
const ROOT = join(import.meta.dirname, '..')

const results: Array<{ name: string; ok: boolean; detail: string }> = []
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`)
}

// --- 1. runtime ------------------------------------------------------------
const baileysPkg = require('baileys/package.json') as { version: string }
check(
  'runtime',
  true,
  `node ${process.version} · bun ${process.versions.bun ?? '-'} · ${process.platform}/${process.arch}`,
)
check('baileys version', baileysPkg.version === '7.0.0-rc14', `${baileysPkg.version} (patch expects 7.0.0-rc14)`)

// The encode patch is skipped (silently, by design) when WAProto grows the
// field itself — then `soundAudio` is dropped and the sticker sends mute.
const { proto } = await import('baileys')
const nativeSupport = 'audioMessage' in (proto.Message.StickerMessage as unknown as object)
check('WAProto needs our encode patch', !nativeSupport, nativeSupport ? 'audioMessage ALREADY in WAProto → patch skipped → SOUND LOST' : 'no audioMessage in WAProto, patch will apply')

// --- 2. sidecars -----------------------------------------------------------
const bin = (n: string) => join(ROOT, 'bin', process.platform === 'win32' ? `${n}.exe` : n)
const audioBin = bin('audio')
const stickerBin = bin('sticker')
check('bin/audio exists', existsSync(audioBin), audioBin)
check('bin/sticker exists', existsSync(stickerBin), stickerBin)

// A stale sidecar (built before the `soundsticker` subcommand) answers with the
// usage block instead of a result — that is the classic VPS divergence.
let audioSupportsSoundsticker = false
if (existsSync(audioBin)) {
  try {
    const { stdout, stderr } = await exec(audioBin, ['soundsticker'], { timeout: 10_000 })
    audioSupportsSoundsticker = /usage:.*soundsticker/s.test(`${stdout}${stderr}`)
    check('bin/audio has the soundsticker subcommand', audioSupportsSoundsticker, (stderr || stdout).trim().split('\n')[0] ?? '')
  } catch (err) {
    const e = err as { stderr?: string; message?: string }
    const msg = (e.stderr ?? e.message ?? '').trim().split('\n')[0] ?? ''
    audioSupportsSoundsticker = /usage:.*soundsticker/s.test(e.stderr ?? '')
    check('bin/audio has the soundsticker subcommand', audioSupportsSoundsticker, msg || 'no output')
  }
}

// The sidecars live in `bin/` (gitignored) and nothing rebuilds them
// automatically: `ensure-audio.mjs` only builds when the file is MISSING, and
// install.sh skips a crate whose binary already exists. So a binary built
// before a fix in native/*/src keeps running old code — the bot sends a sticker
// with no sound, and the only trace is the error reply (an old build fails the
// decode the newer one handles).
const newestMtime = (dir: string): number => {
  let newest = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    const m = e.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs
    if (m > newest) newest = m
  }
  return newest
}

const staleCheck = (label: string, crate: string, binPath: string): void => {
  if (!existsSync(binPath)) return
  const src = join(ROOT, 'native', crate, 'src')
  if (!existsSync(src)) return
  const binAt = statSync(binPath).mtimeMs
  const srcAt = newestMtime(src)
  const ageMin = (srcAt - binAt) / 60_000
  check(
    `${label} binary is newer than its source`,
    srcAt <= binAt,
    srcAt <= binAt
      ? `binary ${new Date(binAt).toISOString()} > source ${new Date(srcAt).toISOString()}`
      : `STALE by ${ageMin.toFixed(0)} min — source changed after the build (rebuild it)`,
  )
}

// A Windows .exe carried over to a Linux VPS: the bot looks for `bin/audio`
// (no extension), so it reports "not built" while the .exe sits there unused.
if (process.platform !== 'win32') {
  const stray = ['audio.exe', 'sticker.exe'].filter((n) => existsSync(join(ROOT, 'bin', n)))
  check('no Windows .exe sidecars on this platform', stray.length === 0, stray.length ? `stray: ${stray.join(', ')} (ignored by the bot)` : 'clean')
}

staleCheck('bin/audio', 'audio', audioBin)
staleCheck('bin/sticker', 'sticker', stickerBin)

// --- 3. real encode --------------------------------------------------------
const dir = await mkdtemp(join(tmpdir(), 'wakaru-probe-ss-'))
try {
  // 64x64 RGB PNG, generated here so the probe has no fixtures to lose.
  const { deflateSync } = await import('node:zlib')
  const w = 64
  const h = 64
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 3 + 1) + 1 + x * 3
    raw[o] = x * 4
    raw[o + 1] = y * 4
    raw[o + 2] = 128
  }
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  const crc = (b: Buffer) => {
    let c = 0xffffffff
    for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4)
    c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
  await writeFile(join(dir, 'in.png'), png)

  // A 2 s 440 Hz mono 48 kHz WAV: valid input for every decoder path.
  const rate = 48_000
  const frames = rate * 2
  const pcm = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12_000), i * 2)
  const hdr = Buffer.alloc(44)
  hdr.write('RIFF', 0)
  hdr.writeUInt32LE(36 + pcm.length, 4)
  hdr.write('WAVEfmt ', 8)
  hdr.writeUInt32LE(16, 16)
  hdr.writeUInt16LE(1, 20)
  hdr.writeUInt16LE(1, 22)
  hdr.writeUInt32LE(rate, 24)
  hdr.writeUInt32LE(rate * 2, 28)
  hdr.writeUInt16LE(2, 32)
  hdr.writeUInt16LE(16, 34)
  hdr.write('data', 36)
  hdr.writeUInt32LE(pcm.length, 40)
  await writeFile(join(dir, 'in.wav'), Buffer.concat([hdr, pcm]))

  const webp = join(dir, 'sticker.webp')
  if (existsSync(stickerBin)) {
    try {
      await exec(stickerBin, [join(dir, 'in.png'), webp, 'Wakaru', ''], { timeout: 30_000 })
      const size = (await readFile(webp)).length
      check('sticker build (png → webp)', size > 100, `${size} bytes`)
    } catch (err) {
      check('sticker build (png → webp)', false, (err as { stderr?: string }).stderr?.trim() ?? String(err))
    }
  }

  const ogg = join(dir, 'audio.ogg')
  if (audioSupportsSoundsticker) {
    try {
      const { stdout, stderr } = await exec(audioBin, ['soundsticker', join(dir, 'in.wav'), ogg, '10'], { timeout: 60_000 })
      const size = existsSync(ogg) ? (await readFile(ogg)).length : 0
      const [secs, ch] = stdout.trim().split('\t')
      // 2 s of audible 32 kbps stereo is ~8 KB; a few hundred bytes means silence.
      check('audio encode (wav → ogg opus)', Number.parseFloat(secs ?? '0') > 0 && size > 2000, `stdout "${stdout.trim()}" · ${size} bytes`)
      if (size) {
        const head = (await readFile(ogg)).subarray(0, 64)
        check('ogg is a real Ogg/Opus stream', head.toString('ascii', 0, 4) === 'OggS' && head.toString('ascii', 28, 36) === 'OpusHead', head.toString('ascii', 0, 36))
      }
      void stderr
    } catch (err) {
      check('audio encode (wav → ogg opus)', false, (err as { stderr?: string }).stderr?.trim() ?? String(err))
    }

    // A silent input must FAIL. It used to exit 0 with a valid ~700 byte Ogg,
    // and the bot then sent a sticker with no sound and no error anywhere.
    const silentWav = join(dir, 'silent.wav')
    const silentPcm = Buffer.alloc(48_000 * 2) // 1 s of digital zero
    const sh = Buffer.alloc(44)
    sh.write('RIFF', 0)
    sh.writeUInt32LE(36 + silentPcm.length, 4)
    sh.write('WAVEfmt ', 8)
    sh.writeUInt32LE(16, 16)
    sh.writeUInt16LE(1, 20)
    sh.writeUInt16LE(1, 22)
    sh.writeUInt32LE(48_000, 24)
    sh.writeUInt32LE(96_000, 28)
    sh.writeUInt16LE(2, 32)
    sh.writeUInt16LE(16, 34)
    sh.write('data', 36)
    sh.writeUInt32LE(silentPcm.length, 40)
    await writeFile(silentWav, Buffer.concat([sh, silentPcm]))
    const silentOut = join(dir, 'silent.ogg')
    let silentRejected = false
    let silentNote = ''
    try {
      await exec(audioBin, ['soundsticker', silentWav, silentOut, '5'], { timeout: 30_000 })
      silentNote = 'exited 0 — silent sticker would be sent'
    } catch (err) {
      const e = err as { stderr?: string; message?: string }
      silentRejected = /silent/i.test(`${e.stderr ?? ''}${e.message ?? ''}`)
      silentNote = (e.stderr ?? e.message ?? '').trim().split('\n')[0] ?? ''
    }
    check('a silent input is rejected (not sent mute)', silentRejected, silentNote)
  }

  // --- 4. wire layout ------------------------------------------------------
  const { ensureSoundStickerEncoding } = await import(join(ROOT, 'src', 'lib', 'wa', 'soundSticker.ts'))
  ensureSoundStickerEncoding()
  const audioMsg = proto.Message.AudioMessage.create({
    url: 'https://mmg.whatsapp.net/x',
    mimetype: 'audio/ogg; codecs=opus',
    fileSha256: randomBytes(32),
    fileLength: 8_000n as unknown as number,
    seconds: 2,
    mediaKey: randomBytes(32),
    fileEncSha256: randomBytes(32),
    directPath: '/v/x',
  })
  const encoded = Buffer.from(
    proto.Message.encode(
      proto.Message.create({
        stickerMessage: { url: 'https://mmg.whatsapp.net/s', mimetype: 'image/webp', isAnimated: false, soundAudio: audioMsg },
      }),
    ).finish(),
  )
  const tag134 = encoded.indexOf(Buffer.from([0xb2, 0x08]))
  check('encoded message carries field 134 (audioStickerMessage)', tag134 === 0, `tag 0xb2 0x08 at byte ${tag134}`)
  const hasTag26 = encoded.indexOf(Buffer.from([0xd2, 0x01])) > 0
  check('nested StickerMessage carries field 26 (audioMessage)', hasTag26, hasTag26 ? 'present' : 'MISSING → sticker sends mute')
  const opusMime = encoded.includes(Buffer.from('audio/ogg; codecs=opus'))
  check('audio mimetype is audio/ogg; codecs=opus', opusMime, opusMime ? 'present' : 'absent/plain audio/ogg renders silent')
} finally {
  await rm(dir, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok)
console.log('\n' + '='.repeat(60))
console.log(`${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('first failure:', failed[0].name)
  console.log('detail:', failed[0].detail)
  process.exitCode = 1
}
