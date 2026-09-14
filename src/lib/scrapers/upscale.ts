import { UA } from './http.ts'

const PAGE = 'https://www.iloveimg.com/upscale-image'

export async function upscaleImage(buf: Buffer, scale = 2): Promise<Buffer> {
  const landing = await (await fetch(PAGE, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30_000),
  })).text()
  const cfg = JSON.parse(landing.match(/ilovepdfConfig = (\{.*?\});/)?.[1] ?? '')
  const task = landing.match(/ilovepdfConfig\.taskId = '([^']+)'/)?.[1]
  if (!cfg?.token || !task) throw new Error('upscale: no session')
  const server = `https://${cfg.servers[0]}.iloveimg.com`
  const head = {
    'User-Agent': UA,
    Authorization: `Bearer ${cfg.token}`,
    Origin: 'https://www.iloveimg.com',
    Referer: PAGE,
  }
  const upForm = new FormData()
  upForm.append('task', task)
  upForm.append('preview', '1')
  upForm.append('pdfinfo', '0')
  upForm.append('pdfforms', '0')
  upForm.append('pdfresetforms', '0')
  upForm.append('v', '7054aee')
  upForm.append('file', new Blob([new Uint8Array(buf)], { type: 'image/png' }), 'photo.png')
  const up = await fetch(`${server}/v1/upload`, {
    method: 'POST', headers: head, body: upForm,
    signal: AbortSignal.timeout(120_000),
  })
  const upJson: any = await up.json()
  const server_filename = upJson?.server_filename
  if (!server_filename) throw new Error(`upscale: upload http ${up.status}`)
  const scForm = new FormData()
  scForm.append('task', task)
  scForm.append('server_filename', server_filename)
  scForm.append('scale', String(scale))
  const out = await fetch(`${server}/v1/upscale`, {
    method: 'POST', headers: head, body: scForm,
    signal: AbortSignal.timeout(300_000),
  })
  if (!out.ok || !out.headers.get('content-type')?.startsWith('image/'))
    throw new Error(`upscale: process http ${out.status}`)
  return Buffer.from(await out.arrayBuffer())
}

if (process.env.UPSCALE_SELFTEST) {
  const { readFileSync } = await import('node:fs')
  const out = await upscaleImage(readFileSync(process.argv[2]))
  if (out.subarray(0, 4).toString('hex') !== '89504e47') throw new Error('upscale: not a png')
  console.log(`upscale self-check ok: ${out.length} bytes`)
  process.exit(0)
}
