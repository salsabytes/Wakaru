// WhatsApp sends code files (index.js, .ts, .py) as application/octet-stream.
// The AI API then treats them as opaque blobs.
// So: map the extension to a type the model can actually read.
const EXT_MIME: Record<string, string> = {
  js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', jsx: 'text/javascript',
  ts: 'text/plain', tsx: 'text/plain', json: 'application/json', jsonc: 'application/json',
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  html: 'text/html', htm: 'text/html', css: 'text/css', scss: 'text/css', less: 'text/css',
  xml: 'application/xml', svg: 'image/svg+xml', csv: 'text/csv',
  yml: 'application/yaml', yaml: 'application/yaml', toml: 'text/plain', ini: 'text/plain', env: 'text/plain',
  log: 'text/plain', sh: 'text/x-shellscript', bash: 'text/x-shellscript', zsh: 'text/x-shellscript',
  py: 'text/x-python', rb: 'text/x-ruby', php: 'text/x-php', go: 'text/x-go', rs: 'text/x-rust',
  java: 'text/x-java', kt: 'text/x-kotlin', c: 'text/x-c', h: 'text/x-c', cpp: 'text/x-c++', hpp: 'text/x-c++',
  sql: 'text/x-sql', patch: 'text/plain', diff: 'text/plain',
  pdf: 'application/pdf',
}

const extOf = (fileName?: string): string => String(fileName || '').split('.').pop()?.toLowerCase() ?? ''

// Pick order:
//   1. explicit MIME
//   2. file extension
//   3. media-type default
// A generic octet-stream never wins over a known extension.
export const fileMime = (mtype?: string, mimetype?: string, fileName?: string): string => {
  const m = String(mimetype || '').split(';')[0].trim().toLowerCase()
  const byExt = EXT_MIME[extOf(fileName)]
  if (byExt && (!m || m === 'application/octet-stream')) return byExt
  if (m) return m
  if (byExt) return byExt
  if (mtype === 'imageMessage') return 'image/jpeg'
  if (mtype === 'stickerMessage') return 'image/webp'
  if (mtype === 'videoMessage') return 'video/mp4'
  if (mtype === 'audioMessage') return 'audio/mpeg'
  return 'application/octet-stream'
}

const MIME_EXT: Record<string, string> = {
  'text/plain': 'txt', 'text/javascript': 'js', 'application/json': 'json', 'text/markdown': 'md',
  'text/html': 'html', 'text/css': 'css', 'text/csv': 'csv', 'image/svg+xml': 'svg',
  'application/xml': 'xml', 'application/yaml': 'yml', 'application/pdf': 'pdf',
  'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
}

export const fileNameOf = (mtype?: string, mime?: string, fileName?: string): string => {
  if (fileName) return fileName
  const fallback: Record<string, string> = {
    imageMessage: 'image.jpg', stickerMessage: 'sticker.webp', videoMessage: 'video.mp4', audioMessage: 'audio.mp3',
  }
  if (fallback[mtype ?? '']) return fallback[mtype ?? '']
  const ext =
    MIME_EXT[String(mime || '').split(';')[0].trim().toLowerCase()] ||
    (mime || '').split('/')[1]?.replace(/[^a-z0-9]/gi, '') ||
    'bin'
  return `file.${ext}`
}
