/**
 * WhatsApp rich messages (native): text, tables, and code cards.
 *
 * How it works (simple):
 * - `sections`  = what modern WhatsApp clients render (Android, Web, iPhone).
 * - `submessages` = backup for older clients that ignore `sections`.
 *
 * Most callers want `sendRichParts()`:
 *   sendRichParts(sock, jid, [{type:'text',...}, {type:'table',...}])
 *
 * HTML cards are Android-only (special primitive). Web/iPhone can't draw them,
 * so we don't use HTML for cross-device replies.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { generateWAMessageFromContent, proto, type WASocket } from 'baileys'

const BOT_JID = '0@bot'
const TEXT_CHUNK = 4000
const CODE_MAX = 4000

/** Undocumented WhatsApp primitive; only Android renders it (offline, no network). */
export const AI_RICH_HTML_PRIMITIVE = 'GenAIaeacdsnwHtmlPrimitive'

export interface RichExOptions {
  /** Send an identical edit after the first message. Helps Android skip "Download" on HTML cards. */
  withEdit?: boolean
  /** Wait before the edit so the original lands first (ms). Only with `withEdit`. */
  editDelayMs?: number
  /** 1 = STANDARD (default, most compatible), 0 = UNKNOWN. */
  messageType?: number
  /** Also put native text/table into `sections` next to an HTML card. */
  mirrorSections?: boolean
  /** Short text fallback for clients that can't draw an HTML card. */
  mirrorText?: string
  fallback?: boolean
  title?: string
  footer?: string
  /** Fixed card height in px (1-4096). Prevents bubble "jump" on re-measure. */
  height?: number
}

export type RichPart =
  | { type: 'text'; text: string }
  | { type: 'table'; title?: string; rows: string[][] }
  | { type: 'code'; language?: string; code: string }

interface RichSubMessage {
  messageType: number
  messageText?: string
  tableMetadata?: {
    title?: string
    rows: Array<{ items: string[]; isHeading?: boolean }>
  }
  codeMetadata?: {
    codeLanguage: string
    codeBlocks: Array<{ codeContent: string; highlightType: number }>
  }
}

export interface RichExContent {
  messageContextInfo: {
    deviceListMetadata: Record<string, never>
    deviceListMetadataVersion: number
    messageSecret?: Uint8Array
    botMetadata: { messageDisclaimerText: string }
  }
  botForwardedMessage: {
    message: {
      richResponseMessage: {
        messageType: number
        submessages: RichSubMessage[]
        unifiedResponse: { data: string }
        contextInfo: Record<string, unknown>
      }
    }
  }
}

// --- HTML helpers (used only for the Android HTML-card path) -----------------

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => {
      try {
        return String.fromCodePoint(Number(n))
      } catch {
        return ''
      }
    })
}

function stripCode(s: string): string {
  return s.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
}

// Keep a space between inline tags: "<b>128</b><span>pesan</span>" -> "128 pesan"
function padInline(s: string): string {
  return s.replace(
    /(<\/(?:span|b|strong|i|em|code|tt|pre|a)>)\s*(<(?:span|b|strong|i|em|code|tt|pre|a)[\s>])/gi,
    '$1 $2',
  )
}

export function htmlToText(html: string): string {
  let s = padInline(stripCode(String(html ?? '')))
  s = s.replace(/<(br|hr)[^>]*>/gi, '\n')
  s = s.replace(/<\/(p|div|section|article|h[1-6]|tr|ul|ol|table|blockquote)>/gi, '\n')
  s = s.replace(/<li[^>]*>/gi, '\n• ')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return s
}

export function htmlToMarkdown(html: string): string {
  let s = padInline(stripCode(String(html ?? '')))
  s = s.replace(/<(br|hr)[^>]*>/gi, '\n')
  s = s.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
  s = s.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/(b|strong)>/gi, '*$2*')
  s = s.replace(/<(i|em)[^>]*>([\s\S]*?)<\/(i|em)>/gi, '_$2_')
  s = s.replace(/<(code|tt|pre)[^>]*>([\s\S]*?)<\/(code|tt|pre)>/gi, '`$2`')
  s = s.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n*$1*\n')
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n• $1')
  s = s.replace(/<\/(p|div|section|article|ul|ol|table|tr|blockquote)>/gi, '\n')
  s = s.replace(/<[^>]+>/g, '')
  s = decodeEntities(s)
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return s
}

function chunkText(text: string, max: number = TEXT_CHUNK): string[] {
  if (text.length <= max) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max)
    if (cut < max * 0.4) cut = max
    out.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
    if (!rest) break
  }
  if (rest) out.push(rest)
  return out.filter(Boolean)
}

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 120)
}

/** Pin card height (px) so the bubble doesn't jump when WhatsApp re-measures it. */
export function lockHeight(px: number): string {
  const h = Math.min(4096, Math.max(1, Math.floor(px)))
  return `<style>html,body{margin:0;height:${h}px;max-height:${h}px;overflow:hidden}</style>`
}

// --- Section builders (one "block" in the rich message) ----------------------

function textSection(text: string): Record<string, unknown> {
  return {
    view_model: {
      primitive: { text, __typename: 'GenAIMarkdownTextUXPrimitive' },
      __typename: 'GenAISingleLayoutViewModel',
    },
  }
}

function tableSection(part: Extract<RichPart, { type: 'table' }>): Record<string, unknown> | undefined {
  const [header, ...body] = part.rows
  if (!header || body.length === 0) return undefined
  return {
    view_model: {
      primitive: {
        rows: [{ is_header: true, cells: header }, ...body.map((cells) => ({ is_header: false, cells }))],
        __typename: 'GenATableUXPrimitive',
      },
      __typename: 'GenAISingleLayoutViewModel',
    },
  }
}

function htmlSection(html: string, height?: number): Record<string, unknown> {
  return {
    view_model: {
      primitive: {
        payload: height === undefined ? html : lockHeight(height) + html,
        trusted_sources: [],
        __typename: AI_RICH_HTML_PRIMITIVE,
      },
      __typename: 'GenAISingleLayoutViewModel',
    },
  }
}

// --- Code syntax highlighting (tiny tokenizer) --------------------------------
// WhatsApp renders the color tokens we send; it doesn't parse code itself.
// So we do a small, safe token pass: comments, strings, numbers, keywords.
// It's not perfect (not a real parser) — wrong colors are fine, broken output is not.

const CODE_KEYWORDS: Record<string, string[]> = {
  javascript: 'async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield'.split(' '),
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'.split(' '),
  bash: 'case do done elif else esac fi for function if in local return then until while export echo cd'.split(' '),
  sql: 'select from where join left right inner outer on group by order having limit insert into values update set delete create table alter drop and or not null as distinct union'.split(' '),
  json: 'true false null'.split(' '),
  html: 'html head body div span a p ul li table tr td th script style link meta title form input button'.split(' '),
  css: 'important media import font face keyframes from to'.split(' '),
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false'.split(' '),
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self static struct super trait true type unsafe use where while'.split(' '),
  java: 'abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws try void while true false'.split(' '),
  php: 'abstract and array as break case catch class const continue default do echo else elseif extends false finally for foreach function if implements include instanceof interface new null or private protected public return static switch throw trait true try use var while'.split(' '),
  ruby: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield'.split(' '),
}

// Short names -> canonical names (e.g. "js" -> "javascript")
const CODE_ALIAS: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'typescript', py: 'python', python3: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', powershell: 'bash', pwsh: 'bash',
  yml: 'yaml', md: 'markdown', rs: 'rust', golang: 'go', kt: 'kotlin',
  c: 'c', cpp: 'cpp', 'c++': 'cpp', h: 'c', html5: 'html', svg: 'html', scss: 'css',
}

// Line comment markers per language (block /* */ is handled separately)
const CODE_COMMENTS: Record<string, string[]> = {
  python: ['#'], bash: ['#'], ruby: ['#'], yaml: ['#'],
  sql: ['--'], lua: ['--'],
}

/** Normalize a language tag (`py` -> `python`). Unknown tags are kept as-is. */
export function normLang(lang: string): string {
  const l = String(lang ?? '').trim().toLowerCase().replace(/[^a-z0-9+#]/g, '')
  return CODE_ALIAS[l] ?? l
}

const KEYWORD_SET = (lang: string): Set<string> =>
  new Set([...(CODE_KEYWORDS[lang] ?? []), ...(lang === 'typescript' ? CODE_KEYWORDS.javascript : [])])

const HL = { DEFAULT: 0, KEYWORD: 1, METHOD: 2, STR: 3, NUMBER: 4, COMMENT: 5 } as const
const HL_NAME = ['DEFAULT', 'KEYWORD', 'METHOD', 'STR', 'NUMBER', 'COMMENT'] as const

type Tok = { codeContent: string; highlightType: number }

/** Split code into highlight tokens for WhatsApp's code card. */
export function tokenizeCode(code: string, lang = 'javascript'): { tokens: Tok[]; unified: Array<{ content: string; type: string }> } {
  const src = String(code ?? '').slice(0, CODE_MAX)
  const language = normLang(lang)
  const keywords = KEYWORD_SET(language)
  const lineComments = CODE_COMMENTS[language] ?? ['//']
  const hashComment = language === 'python' || language === 'bash' || language === 'ruby' || language === 'yaml'
  const tokens: Tok[] = []
  let i = 0

  // Merge same-type neighbors to keep the token list small.
  const push = (content: string, type: number) => {
    if (!content) return
    const last = tokens[tokens.length - 1]
    if (last && last.highlightType === type) last.codeContent += content
    else tokens.push({ codeContent: content, highlightType: type })
  }

  while (i < src.length) {
    const c = src[i]
    const rest = src.slice(i)

    if (/\s/.test(c)) {
      let j = i
      while (j < src.length && /\s/.test(src[j])) j++
      push(src.slice(i, j), HL.DEFAULT)
      i = j
      continue
    }
    if (rest.startsWith('/*')) {
      const end = src.indexOf('*/', i + 2)
      push(src.slice(i, end === -1 ? src.length : end + 2), HL.COMMENT)
      i = end === -1 ? src.length : end + 2
      continue
    }
    if (lineComments.some((p) => rest.startsWith(p)) || (hashComment && c === '#')) {
      const end = src.indexOf('\n', i)
      push(src.slice(i, end === -1 ? src.length : end), HL.COMMENT)
      i = end === -1 ? src.length : end
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\' && j + 1 < src.length) j += 2
        else if (src[j] === c) { j++; break }
        else j++
      }
      push(src.slice(i, j), HL.STR)
      i = j
      continue
    }
    if (/[0-9]/.test(c)) {
      let j = i
      while (j < src.length && /[0-9._xXa-fA-F]/.test(src[j])) j++
      push(src.slice(i, j), HL.NUMBER)
      i = j
      continue
    }
    if (/[A-Za-z_$@]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++
      const word = src.slice(i, j)
      let type: number = HL.DEFAULT
      if (keywords.has(word) || keywords.has(word.toLowerCase())) type = HL.KEYWORD
      else {
        let k = j
        while (k < src.length && /\s/.test(src[k])) k++
        if (src[k] === '(') type = HL.METHOD // foo(...) -> method-like
      }
      push(word, type)
      i = j
      continue
    }
    push(c, HL.DEFAULT)
    i++
  }

  return {
    tokens,
    unified: tokens.map((t) => ({ content: t.codeContent, type: HL_NAME[t.highlightType] ?? 'DEFAULT' })),
  }
}

function codeSection(part: Extract<RichPart, { type: 'code' }>): Record<string, unknown> {
  const language = normLang(part.language ?? 'plaintext') || 'plaintext'
  const { unified } = tokenizeCode(part.code, language)
  return {
    view_model: {
      primitive: { language, code_blocks: unified, __typename: 'GenAICodeUXPrimitive' },
      __typename: 'GenAISingleLayoutViewModel',
    },
  }
}

function codeSubMessage(part: Extract<RichPart, { type: 'code' }>): RichSubMessage {
  const language = normLang(part.language ?? 'plaintext') || 'plaintext'
  const { tokens } = tokenizeCode(part.code, language)
  return { messageType: 5, codeMetadata: { codeLanguage: language, codeBlocks: tokens } }
}

function tableSubMessage(part: Extract<RichPart, { type: 'table' }>): RichSubMessage | undefined {
  const [header, ...body] = part.rows
  if (!header || body.length === 0) return undefined
  return {
    messageType: 4,
    tableMetadata: {
      title: part.title ?? '',
      rows: [{ items: header, isHeading: true }, ...body.map((items) => ({ items }))],
    },
  }
}

// --- Envelope builders --------------------------------------------------------

/** Wrap sections + submessages into the full WhatsApp rich-message envelope. */
function finishRich(
  sections: Record<string, unknown>[],
  submessages: RichSubMessage[],
  opts: Pick<RichExOptions, 'title' | 'footer' | 'messageType'> = {},
): RichExContent {
  if (opts.footer) {
    sections.push({
      view_model: {
        primitive: { text: opts.footer, __typename: 'GenAIMetadataTextPrimitive' },
        __typename: 'GenAISingleLayoutViewModel',
      },
    })
    submessages.push({ messageType: 2, messageText: opts.footer })
  }
  const base64Data = Buffer.from(
    JSON.stringify({ response_id: randomUUID(), sections }),
  ).toString('base64')
  return {
    messageContextInfo: {
      deviceListMetadata: {},
      deviceListMetadataVersion: 2,
      botMetadata: { messageDisclaimerText: opts.title ?? '' },
    },
    botForwardedMessage: {
      message: {
        richResponseMessage: {
          messageType: opts.messageType ?? 1,
          submessages,
          unifiedResponse: { data: base64Data },
          contextInfo: {
            forwardingScore: 1,
            isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: BOT_JID },
            forwardOrigin: 4,
          },
        },
      },
    },
  }
}

/** HTML card (Android-only). Modern clients read `sections`; old ones read `submessages`. */
export function buildRichContent(
  html: string,
  opts: Pick<RichExOptions, 'title' | 'footer' | 'height' | 'mirrorSections'> = {},
): RichExContent {
  const page = String(html ?? '')
  const sections: Record<string, unknown>[] = [htmlSection(page, opts.height)]
  // optional text mirror for clients that read sections but skip the HTML primitive; off by default to avoid double render
  if (opts.mirrorSections) sections.push(textSection(htmlToMarkdown(page) || ' '))
  const submessages: RichSubMessage[] = chunkText(htmlToText(page) || ' ').map((messageText) => ({
    messageType: 2,
    messageText,
  }))
  return finishRich(sections, submessages, opts)
}

/** Native parts (text/table/code). Renders on Android, Web, and iPhone from one message. */
export function buildRichParts(parts: RichPart[], opts: RichExOptions = {}): RichExContent {
  const sections: Record<string, unknown>[] = []
  const submessages: RichSubMessage[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      sections.push(textSection(part.text))
      submessages.push({ messageType: 2, messageText: part.text })
      continue
    }
    if (part.type === 'code') {
      sections.push(codeSection(part))
      submessages.push(codeSubMessage(part))
      continue
    }
    const section = tableSection(part)
    if (section) sections.push(section)
    const table = tableSubMessage(part)
    if (table) submessages.push(table)
  }
  return finishRich(sections, submessages, opts)
}

/** Mixed: HTML card in `sections` + native parts in `submessages`. Mostly Android-focused. */
export function buildRichMulti(html: string, parts: RichPart[], opts: RichExOptions = {}): RichExContent {
  const sections: Record<string, unknown>[] = [htmlSection(String(html ?? ''), opts.height)]
  const mirrored: Record<string, unknown>[] = []
  if (opts.mirrorText) mirrored.push(textSection(opts.mirrorText))
  const submessages: RichSubMessage[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      submessages.push({ messageType: 2, messageText: part.text })
      if (opts.mirrorSections === true) mirrored.push(textSection(part.text))
      continue
    }
    if (part.type === 'code') {
      submessages.push(codeSubMessage(part))
      if (opts.mirrorSections === true) mirrored.push(codeSection(part))
      continue
    }
    const table = tableSubMessage(part)
    if (table) submessages.push(table)
    if (opts.mirrorSections === true) {
      const section = tableSection(part)
      if (section) mirrored.push(section)
    }
  }
  sections.push(...mirrored)
  return finishRich(sections, submessages, opts)
}

/** Plain-text version of parts, used as a fallback when rich send fails. */
function partsToText(parts: RichPart[], footer?: string): string {
  const lines: string[] = []
  for (const part of parts) {
    if (part.type === 'text') lines.push(part.text)
    else if (part.type === 'code') lines.push('```' + (part.language ?? '') + '\n' + part.code + '\n```')
    else for (const row of part.rows) lines.push(row.join(' · '))
  }
  if (footer) lines.push(footer)
  return lines.join('\n')
}

// --- Send ---------------------------------------------------------------------

async function relayRich(
  sock: WASocket,
  jid: string,
  inner: RichExContent,
  opts: RichExOptions,
  fallbackText: string,
): Promise<string | undefined> {
  const withEdit = opts.withEdit === true
  // messageSecret is required for a valid rich envelope on some clients.
  if (!inner.messageContextInfo.messageSecret) {
    inner.messageContextInfo.messageSecret = randomBytes(32)
  }

  try {
    const userJid = sock.user?.id ?? ''
    const waMsg = generateWAMessageFromContent(jid, inner as unknown as proto.IMessage, { userJid })
    if (!waMsg.message || typeof waMsg.key.id !== 'string') throw new Error('gagal generate pesan rich')

    const id = await sock.relayMessage(jid, waMsg.message, { messageId: waMsg.key.id })

    // Optional: send an "edit" of the same message to help Android render HTML cards cleanly.
    if (id && withEdit) {
      try {
        const editDelay = Math.max(0, opts.editDelayMs ?? 350)
        if (editDelay) await new Promise((resolve) => setTimeout(resolve, editDelay))
        const edit = generateWAMessageFromContent(
          jid,
          {
            botForwardedMessage: {
              message: {
                protocolMessage: {
                  key: { remoteJid: jid, fromMe: true, id },
                  type: 14, // MESSAGE_EDIT
                  timestampMs: Date.now(),
                  editedMessage: waMsg.message,
                },
              },
            },
          } as unknown as proto.IMessage,
          { userJid },
        )
        if (edit.message && typeof edit.key.id === 'string') {
          await sock.relayMessage(jid, edit.message, { messageId: edit.key.id })
        }
      } catch (e) {
        console.log('rich edit failed:', errMsg(e))
      }
    }

    if (id && opts.fallback === true) {
      try {
        await sock.sendMessage(jid, { text: fallbackText || ' ' })
      } catch (e) {
        console.log('rich fallback failed:', errMsg(e))
      }
    }

    return id
  } catch (error) {
    console.error('rich send error:', error)
    throw error
  }
}

/** Send an HTML card (Android-only). Use `sendRichParts` for cross-device tables/text. */
export function sendHtml(
  sock: WASocket,
  jid: string,
  html: string,
  opts: RichExOptions = {},
): Promise<string | undefined> {
  return relayRich(
    sock,
    jid,
    buildRichContent(html, opts),
    { ...opts, withEdit: opts.withEdit !== false },
    htmlToText(html),
  )
}

/** Send an HTML card then (optionally) a text bubble in that order; returns the HTML msg id. */
export async function sendHtmlThenText(
  sock: WASocket,
  jid: string,
  html: string,
  text: string,
  opts: RichExOptions = {},
): Promise<string | undefined> {
  const id = await sendHtml(sock, jid, html, { ...opts, fallback: false })
  if (text) await sock.sendMessage(jid, { text })
  return id
}

/** Send native rich parts (text/table/code). Works on Android, Web, and iPhone. */
export function sendRichParts(
  sock: WASocket,
  jid: string,
  parts: RichPart[],
  opts: RichExOptions = {},
): Promise<string | undefined> {
  return relayRich(sock, jid, buildRichParts(parts, opts), opts, partsToText(parts, opts.footer))
}

/** Send an HTML card + native submessages in one bubble (mostly Android-focused). */
export function sendRichMulti(
  sock: WASocket,
  jid: string,
  html: string,
  parts: RichPart[],
  opts: RichExOptions = {},
): Promise<string | undefined> {
  return relayRich(sock, jid, buildRichMulti(html, parts, opts), opts, partsToText(parts, opts.footer))
}
