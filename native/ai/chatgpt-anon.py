"""Anonymous ChatGPT backend (GPT-6) for Wakaru.

Uses OpenAI's Android anonymous endpoint — no account, no API key, no PoW,
no Turnstile. The sentinel token is cached for its lifetime (~9 min), so most
messages only pay for the conversation round-trip.

One-shot:
  echo '{"messages":[{"role":"user","content":"hi"}]}' | python3 chatgpt-anon.py

Daemon (used by src/lib/llm.ts):
  python3 chatgpt-anon.py --serve    # JSON lines in, JSON lines out
"""

import json
import os
import re
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from curl_cffi import requests
import base64
import mimetypes
import urllib.request

# File upload safety limits (keep requests small/fast)
MAX_FILES = 4  # max files per request
MAX_FILE_BYTES = 20 * 1024 * 1024  # 20MB per file
FETCH_TIMEOUT = 60  # seconds when fetching a file URL

EXT_MIME = {
  'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp',
  'pdf': 'application/pdf', 'txt': 'text/plain', 'md': 'text/markdown', 'html': 'text/html', 'htm': 'text/html',
  'json': 'application/json', 'xml': 'application/xml', 'csv': 'text/csv', 'yaml': 'text/yaml', 'yml': 'text/yaml',
  'js': 'text/javascript', 'ts': 'text/x-typescript', 'py': 'text/x-script.python', 'java': 'text/x-java',
  'c': 'text/x-c', 'cpp': 'text/x-c++', 'cs': 'text/x-csharp', 'rb': 'text/x-ruby', 'php': 'text/x-php',
  'sh': 'text/x-sh', 'tex': 'text/x-tex', 'rtf': 'application/rtf',
  'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'ppt': 'application/vnd.ms-powerpoint', 'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg', 'm4a': 'audio/mp4', 'opus': 'audio/ogg',
  'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime',
  'zip': 'application/zip', 'tar': 'application/x-tar', 'gz': 'application/gzip', '7z': 'application/x-7z-compressed',
}
MIME_EXT = {v: k for k, v in EXT_MIME.items()}
MULTIMODAL_MIMES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}


# Guess file type from magic bytes (fallback when mime is missing/wrong)
def _sniff_mime(b):
  if len(b) >= 8 and b[:8] == b'\x89PNG\r\n\x1a\n': return 'image/png'
  if len(b) >= 3 and b[:3] == b'\xff\xd8\xff': return 'image/jpeg'
  if len(b) >= 6 and b[:6] in (b'GIF87a', b'GIF89a'): return 'image/gif'
  if len(b) >= 12 and b[:4] == b'RIFF' and b[8:12] == b'WEBP': return 'image/webp'
  if len(b) >= 5 and b[:5] == b'%PDF-': return 'application/pdf'
  if len(b) >= 4 and b[:4] == b'PK\x03\x04': return 'application/zip'
  if len(b) >= 12 and b[:4] == b'RIFF' and b[8:12] == b'WAVE': return 'audio/wav'
  if len(b) >= 3 and b[:3] == b'ID3': return 'audio/mpeg'
  if len(b) >= 2 and b[0] == 0xff and (b[1] & 0xe0) == 0xe0: return 'audio/mpeg'
  if len(b) >= 4 and b[:4] == b'OggS': return 'audio/ogg'
  if len(b) >= 12 and b[4:8] == b'ftyp': return 'video/mp4'
  if len(b) >= 4 and b[:4] == b'\x1aE\xdf\xa3': return 'video/webm'
  return ''


def _ext_for_mime(mime):
  if mime in MIME_EXT: return MIME_EXT[mime]
  ext = mimetypes.guess_extension(mime or '', strict=False) or ''
  return ext.lstrip('.')[:8] or 'bin'


def _use_case_for_mime(mime):
  if mime in MULTIMODAL_MIMES: return 'multimodal'
  if (mime or '').startswith('text/'): return 'my_files'
  known = {'application/pdf','application/json','application/xml','application/rtf','application/msword',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-powerpoint',
           'application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.ms-excel',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
  if mime in known: return 'my_files'
  return 'ace_upload'


def _img_size(b, mime):
  try:
    if mime == 'image/png' and len(b) >= 24:
      return int.from_bytes(b[16:20],'big'), int.from_bytes(b[20:24],'big')
    if mime == 'image/gif' and len(b) >= 10:
      return int.from_bytes(b[6:8],'little'), int.from_bytes(b[8:10],'little')
    if mime == 'image/jpeg':
      i = 2
      while i + 9 < len(b):
        if b[i] != 0xff: i += 1; continue
        m = b[i+1]
        if m in (0xd8,0x01) or 0xd0 <= m <= 0xd7: i += 2; continue
        if m in (0xc0,0xc2): return int.from_bytes(b[i+7:i+9],'big'), int.from_bytes(b[i+5:i+7],'big')
        seg = int.from_bytes(b[i+2:i+4],'big')
        if seg < 2: break
        i += 2 + seg
    if mime == 'image/webp' and len(b) >= 30:
      tag = b[12:16]
      if tag == b'VP8X': return 1+(b[24]|(b[25]<<8)|(b[26]<<16)), 1+(b[27]|(b[28]<<8)|(b[29]<<16))
      if tag == b'VP8 ' and len(b) >= 30: return (int.from_bytes(b[26:28],'little') & 0x3fff), (int.from_bytes(b[28:30],'little') & 0x3fff)
      if tag == b'VP8L' and len(b) >= 25:
        v = int.from_bytes(b[21:25],'little')
        return 1+(v & 0x3fff), 1+((v >> 14) & 0x3fff)
  except Exception:
    pass
  return 0, 0


# Accept many input shapes: dict/base64/data URL/URL/bytes -> normalized file info
def _read_file_input(item):
  name = ''
  mime = ''
  data = item
  if isinstance(item, dict):
    name = str(item.get('name') or item.get('filename') or '').strip()
    mime = str(item.get('mime') or item.get('mimeType') or item.get('type') or item.get('content_type') or '').split(';')[0].strip()
    data = item.get('data') or item.get('base64') or item.get('content') or item.get('url') or item.get('src')
  if not isinstance(data, (str, bytes)) or (isinstance(data, str) and not data.strip()):
    raise LLMError('file must be base64/data URL/url string', 18)
  buf = b''
  if isinstance(data, bytes):
    buf = data
  else:
    data = data.strip()
    if data.startswith('data:'):
      comma = data.find(',')
      if comma < 0: raise LLMError('invalid data URL', 18)
      meta = data[:comma]
      if not mime and ';' in meta: mime = meta[5:].split(';')[0].strip()
      elif not mime and ':' in meta: mime = meta[5:].strip()
      b64 = data[comma+1:]
      buf = base64.b64decode(b64, validate=False)
    elif data.startswith('http://') or data.startswith('https://'):
      req = urllib.request.Request(data, headers={'User-Agent': UA})
      with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
        buf = r.read(MAX_FILE_BYTES + 1)
        if not mime:
          mime = str(r.headers.get('Content-Type') or '').split(';')[0].strip()
      if not name:
        name = os.path.basename(urllib.parse.urlparse(data).path)[:80]
    else:
      buf = base64.b64decode(data, validate=False)
  if not buf: raise LLMError('empty file', 18)
  if len(buf) > MAX_FILE_BYTES: raise LLMError(f'file too large (max {MAX_FILE_BYTES >> 20}MB)', 18)
  sniff = _sniff_mime(buf)
  if not mime or mime == 'application/octet-stream': mime = sniff or (EXT_MIME.get(name.rsplit('.',1)[-1].lower(),'') if '.' in name else '') or 'application/octet-stream'
  if not name: name = f"file.{_ext_for_mime(mime)}"
  elif '.' not in name.rsplit('/',1)[-1]: name += '.' + _ext_for_mime(mime)
  name = os.path.basename(name).replace('\x00','').strip()[:120] or f"file.{_ext_for_mime(mime)}"
  use_case = _use_case_for_mime(mime)
  w = h = 0
  if use_case == 'multimodal': w, h = _img_size(buf, mime)
  return {'buf': buf, 'name': name, 'mime': mime, 'size': len(buf), 'use_case': use_case, 'width': w, 'height': h}


# Upload flow: create file slot -> PUT bytes -> wait for processing to finish
def _upload_file(f):
  s = session()
  hdr = {
    'User-Agent': UA, 'OAI-Client-Type': 'android', 'OAI-Device-Id': device_id(),
    'OAI-Package-Name': PKG, 'X-OpenAI-No-Http-Logging': '1',
  }
  body = json.dumps({'file_name': f['name'], 'file_size': f['size'], 'use_case': f['use_case']})
  r = None
  for attempt in range(2):
    r = s.post(BASE + 'files', headers={**hdr, 'Content-Type': 'application/json', 'Accept': 'application/json'},
               data=body, timeout=30)
    if r.status_code == 200:
      break
    # Upload quota is per anonymous device: rotate to get a fresh quota
    if attempt == 0 and r.status_code == 429:
      _rotate_device()
      hdr['OAI-Device-Id'] = device_id()
      continue
    raise LLMError(f"file upload HTTP {r.status_code}: {r.text[:160]}", 19)
  if r is None or r.status_code != 200:
    raise LLMError(f"file upload HTTP {getattr(r, 'status_code', '?')}", 19)
  j = r.json()
  upload_url = j.get('upload_url') or ''
  file_id = j.get('file_id') or ''
  if not upload_url or not file_id: raise LLMError('file upload: missing upload_url/file_id', 19)
  put = s.put(upload_url, headers={'Content-Type': f['mime'], 'x-ms-blob-type': 'BlockBlob', 'x-ms-version': '2020-04-08'},
              data=f['buf'], timeout=90)
  if put.status_code not in (200, 201):
    raise LLMError(f"file blob upload HTTP {put.status_code}", 19)
  proc = s.post(BASE + 'files/process_upload_stream', headers={**hdr, 'Content-Type': 'application/json', 'Accept': 'application/json'},
                data=json.dumps({'file_id': file_id, 'use_case': f['use_case'], 'file_name': f['name'], 'index_for_retrieval': 0}), timeout=30)
  if proc.status_code != 200:
    raise LLMError(f"file process HTTP {proc.status_code}: {proc.text[:160]}", 19)
  text = proc.text or ''
  done = not text.strip()
  for line in text.splitlines():
    if not line.strip(): continue
    try:
      ev = json.loads(line)
      if ev.get('event') == 'file.processing.completed': done = True
      if ev.get('event') == 'file.processing.failed': raise LLMError(f"file process failed: {str(ev.get('error') or ev.get('message') or 'failed')[:160]}", 19)
    except LLMError:
      raise
    except Exception:
      pass
  if not done: raise LLMError('file process did not complete', 19)
  return {'file_id': file_id, **{k: f[k] for k in ('name','mime','size','use_case','width','height')}}


# Attach uploaded files to a user message (images as pointers, others as attachments)
def _build_last_user(msg, files):
  images = [x for x in files if x.get('use_case') == 'multimodal']
  parts = []
  for im in images:
    p = {'content_type': 'image_asset_pointer', 'asset_pointer': f"file-service://{im['file_id']}", 'size_bytes': im['size']}
    if im.get('width'): p['width'] = im['width']
    if im.get('height'): p['height'] = im['height']
    parts.append(p)
  parts.append(msg['content']['parts'][0] if msg.get('content',{}).get('parts') else '')
  msg['content'] = {'content_type': 'multimodal_text' if images else 'text', 'parts': parts}
  msg['metadata'] = msg.get('metadata') or {}
  msg['metadata']['attachments'] = []
  for f in files:
    a = {'id': f['file_id'], 'name': f['name'], 'mimeType': f['mime'], 'size': f['size']}
    if f.get('width'): a['width'] = f['width']
    if f.get('height'): a['height'] = f['height']
    msg['metadata']['attachments'].append(a)
  return msg


# Windows console defaults to cp1252 — emoji in prompt/answer would crash
# stdout on write. Force UTF-8 pipes so 😭 survives the trip to TS.
try:
  sys.stdin.reconfigure(encoding='utf-8', errors='replace')
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
  pass

UA = 'ChatGPT/1.2026.237 (Android 14; sdk_gphone64_arm64; build 2623711)'
BASE = 'https://android.chat.openai.com/backend-anon/'
PKG = 'com.openai.chatgpt.internal'
DEFAULT_MODEL = os.environ.get('WAKARU_AI_MODEL', 'gpt-6')
# Upstream search is advisory: the model may search anyway for fresh facts.
SEARCH = os.environ.get('WAKARU_AI_SEARCH', '1').strip().lower() not in ('0', 'false', 'no', 'off')
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.sentinel.json')
TIMEOUT = 120

# private-use citation markers the stream sprinkles into answers
CITE = re.compile(r'\ue200.*?\ue201', re.S)


class LLMError(Exception):
  def __init__(self, msg, code=17):
    super().__init__(msg)
    self.code = code


# curl_cffi sessions are not thread-safe — one per worker thread
_tls = threading.local()


def session():
  s = getattr(_tls, 's', None)
  if s is None:
    s = requests.Session(impersonate='chrome133a')
    _tls.s = s
  return s


_token_lock = threading.Lock()
_token = ''
_token_exp = 0.0
_device = ''


def _load_cache():
  global _device, _token, _token_exp
  try:
    with open(CACHE, encoding='utf-8') as f:
      d = json.load(f)
    _device = d.get('device_id') or ''
    tok = d.get('token') or ''
    exp = float(d.get('expires_at') or 0)
    if tok and exp > time.time() + 30:
      _token, _token_exp = tok, exp
  except Exception:
    pass


def _save_cache():
  try:
    tmp = CACHE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
      json.dump({'device_id': _device, 'token': _token, 'expires_at': _token_exp}, f)
    os.replace(tmp, CACHE)
  except Exception:
    pass


def device_id():
  global _device
  if not _device:
    _device = str(uuid.uuid4())
    _save_cache()
  return _device


def _rotate_device():
  # A fresh anonymous device gets a fresh upload quota + sentinel token.
  global _device, _token, _token_exp
  with _token_lock:
    _device = str(uuid.uuid4())
    _token, _token_exp = '', 0.0
    _save_cache()


def _headers(accept='text/event-stream'):
  return {
    'User-Agent': UA,
    'Content-Type': 'application/json',
    'Accept': accept,
    'OAI-Client-Type': 'android',
    'OAI-Device-Id': device_id(),
    'OAI-Package-Name': PKG,
    'X-OpenAI-No-Http-Logging': '1',
  }


def _sentinel(force=False):
  global _token, _token_exp, _device
  now = time.time()
  with _token_lock:
    if not force and _token and _token_exp > now + 20:
      return _token
    for attempt in range(2):
      try:
        r = session().post(BASE + 'sentinel/chat-requirements', headers=_headers(), data='{}', timeout=30)
      except Exception as e:
        raise LLMError(f'sentinel {type(e).__name__}: {str(e)[:200]}', 11)
      if r.status_code == 200:
        j = r.json()
        tok = j.get('token') or ''
        if not tok:
          raise LLMError('sentinel: empty token', 12)
        exp = now + float(j.get('expire_after') or 540)
        try:
          exp_at = float(j.get('expire_at') or 0)
          if now < exp_at < now + 3600:
            exp = min(exp, exp_at)
        except Exception:
          pass
        _token, _token_exp = tok, exp - 15
        _save_cache()
        return _token
      if attempt == 0 and r.status_code in (401, 403, 429):
        _device = str(uuid.uuid4())  # stuck device id — rotate and retry
        continue
      raise LLMError(f'sentinel HTTP {r.status_code}: {r.text[:200]}', 13)
    raise LLMError('sentinel failed', 13)


def _message(role, text):
  return {
    'id': str(uuid.uuid4()),
    'author': {'role': role},
    'create_time': round(time.time(), 3),
    'content': {'content_type': 'text', 'parts': [text]},
    'metadata': {},
  }


def _messages(msgs, allow_empty_last=False):
  out = []
  items = list(msgs or [])
  for i, m in enumerate(items):
    files = None
    if isinstance(m, dict):
      role = str(m.get('role') or 'user').lower()
      text = m.get('content')
      files = m.get('files') or m.get('attachments')
    else:
      role, text = 'user', m
    text = str(text or '').strip()
    if not text and not files and not (allow_empty_last and i == len(items) - 1):
      continue
    msg = _message('assistant' if role == 'assistant' else 'system' if role == 'system' else 'user', text or ('Tolong analisis file ini.' if (allow_empty_last or files) else ''))
    if files: msg['_files'] = list(files)
    out.append(msg)
  return out


def _body(messages, model):
  # camelCase + supportedEncodings=['text/plain'] makes upstream send
  # cumulative message snapshots (no delta_encoding patches), so a dropped
  # patch can never truncate the answer. forceUseSse keeps the stream SSE.
  return {
    'action': 'next',
    'messages': messages,
    'parentMessageId': None,
    'conversationId': None,
    'model': model or DEFAULT_MODEL,
    'historyAndTrainingDisabled': True,
    'conversationMode': {'kind': 'primary_assistant'},
    'forceUseSearch': SEARCH,
    'forceUseSse': True,
    'supportedEncodings': ['text/plain'],
    'timezone': 'Asia/Jakarta',
    'timezoneOffsetMin': 420,
    'noAuthAdPreferences': True,
  }


def _parse(text):
  """Return (answer, finished) from a backend-anon SSE body.

  The text/plain encoding re-sends the whole assistant message on every
  event (cumulative snapshots). Older delta-encoded streams use append/patch
  ops; both shapes are handled. Replayed history frames are skipped.
  """
  snap = ''
  delta = []
  done = False
  for line in text.split('\n'):
    if not line.startswith('data:'):
      continue
    raw = line[5:].strip()
    if not raw or raw == '[DONE]':
      continue
    try:
      d = json.loads(raw)
    except Exception:
      continue
    if not isinstance(d, dict):
      continue
    typ = d.get('type')
    if typ == 'message_stream_complete':
      done = True
      continue
    if typ == 'message_marker':
      if d.get('marker') == 'last_token':
        done = True
      continue
    m = d.get('message')
    if isinstance(m, dict):
      if m.get('author', {}).get('role') != 'assistant':
        continue
      md = m.get('metadata') or {}
      # Replayed history assistant frames carry no live turn markers.
      if (m.get('status') in ('finished_successfully', 'finished')
          and md.get('message_type') != 'next'
          and m.get('channel') != 'final'):
        continue
      parts = m.get('content', {}).get('parts') or []
      full = ''.join(p for p in parts if isinstance(p, str))
      if full:
        snap = full
      if m.get('status') == 'finished_successfully' and m.get('end_turn') is True:
        done = True
      continue
    # delta-encoding fallback
    op, path, v = d.get('o'), d.get('p'), d.get('v')
    if op == 'append' and path == '/message/content/parts/0' and isinstance(v, str):
      delta.append(v)
    elif op == 'patch' and isinstance(v, list):
      for p in v:
        if p.get('o') == 'append' and p.get('p') == '/message/content/parts/0' and isinstance(p.get('v'), str):
          delta.append(p['v'])
    elif op == 'add' and isinstance(v, dict):
      parts = v.get('message', {}).get('content', {}).get('parts')
      if isinstance(parts, list):
        delta.extend(p for p in parts if isinstance(p, str) and p)
  return snap or ''.join(delta), done


def _clean(text):
  text = CITE.sub('', text)
  text = text.replace('\ue200', '').replace('\ue201', '').replace('\ue202', '')
  text = '\n'.join(line for line in text.split('\n') if line.strip() != ':::' and not line.strip().startswith(':::writing'))
  return ''.join(ch for ch in text if not 0xE000 <= ord(ch) <= 0xF8FF).strip()


def _prepare(msgs, model):
  try:
    r = session().post(BASE + 'f/conversation/prepare', headers=_headers(), data=json.dumps(_body(msgs, model)), timeout=30)
    return (r.json().get('conduit_token') or '') if r.status_code == 200 else ''
  except Exception:
    return ''


def ask(msgs, model=None, files=None):
  model = model or DEFAULT_MODEL
  # Incognito per prompt: new anonymous device so per-device limits (uploads,
  # sentinel) start from zero instead of reusing a throttled device.
  _rotate_device()
  file_inputs = list(files or [])[:MAX_FILES]
  uploaded = []
  for i, item in enumerate(file_inputs):
    try:
      uploaded.append(_upload_file(_read_file_input(item)))
    except LLMError:
      raise
    except Exception as e:
      raise LLMError(f"file {i+1}/{len(file_inputs)}: {str(e)[:180]}", 19)
  messages = _messages(msgs, allow_empty_last=bool(uploaded))
  # upload and attach files embedded in history messages
  for msg in messages:
    embedded = msg.pop('_files', None)
    if embedded:
      up = []
      for j, item in enumerate(list(embedded)[:MAX_FILES]):
        try:
          up.append(_upload_file(_read_file_input(item)))
        except LLMError:
          raise
        except Exception as e:
          raise LLMError(f"history file {j+1}: {str(e)[:180]}", 19)
      if up:
        if msg.get('author', {}).get('role') == 'user':
          _build_last_user(msg, up)
        else:
          # assistant messages cannot carry uploads; keep a textual note
          note = ' '.join(f"[file: {f.get('name','file')}]" for f in up)
          parts = msg.get('content', {}).get('parts') or ['']
          parts[0] = (str(parts[0]) + '\n' + note).strip()
          msg['content']['parts'] = parts
  if not messages and uploaded:
    messages = [_message('user', 'Tolong analisis file ini.')]
  if not messages:
    raise LLMError('empty prompt', 10)
  if uploaded:
    # attach request-level files to last user message (avoid duplicating history-embedded ones)
    last_user = None
    for i in range(len(messages)-1, -1, -1):
      if messages[i].get('author',{}).get('role') == 'user':
        last_user = messages[i]; break
    if last_user and not last_user.get('_files_attached'):
      _build_last_user(last_user, uploaded)
      last_user['_files_attached'] = True
    elif not last_user:
      messages.append(_build_last_user(_message('user','Tolong analisis file ini.'), uploaded))
  body_json = json.dumps(_body(messages, model))
  conduit = ''
  last = ''
  for attempt in range(3):
    tok = _sentinel(force=attempt > 0)
    headers = _headers()
    headers['openai-sentinel-chat-requirements-token'] = tok
    headers['x-conduit-token'] = conduit or 'no-token'
    try:
      r = session().post(BASE + 'f/conversation', headers=headers, data=body_json, timeout=TIMEOUT)
    except Exception as e:
      last = f'{type(e).__name__}: {str(e)[:200]}'
      if attempt < 2:
        time.sleep(0.6 * (attempt + 1))
        continue
      raise LLMError(f'conversation {last}', 15)
    if r.status_code == 200:
      text, done = _parse(r.text)
      text = _clean(text)
      if text:
        return text
      last = 'empty response' if not done else 'empty response (finished)'
      if attempt < 2:
        time.sleep(0.4)
        continue
      raise LLMError(last, 16)
    last = f'HTTP {r.status_code}: {r.text[:300]}'
    if attempt == 0 and r.status_code in (400, 403, 409):
      conduit = _prepare(messages, model)
      continue
    if attempt < 2 and (r.status_code in (401, 403, 429) or r.status_code >= 500):
      time.sleep(0.6 * (attempt + 1))
      continue
    raise LLMError(f'conversation {last}', 15)
  raise LLMError(f'conversation {last}', 15)


def serve():
  pool = ThreadPoolExecutor(max_workers=4)
  out = threading.Lock()

  def work(req):
    rid = req.get('id')
    try:
      files = req.get('files') or req.get('attachments') or []
      resp = {'id': rid, 'text': ask(req.get('messages') or [], req.get('model'), files)}
    except Exception as e:
      resp = {'id': rid, 'error': str(e)[:500]}
    with out:
      sys.stdout.write(json.dumps(resp, ensure_ascii=False) + '\n')
      sys.stdout.flush()

  try:
    for line in sys.stdin:
      line = line.strip()
      if not line:
        continue
      try:
        req = json.loads(line)
      except Exception:
        continue
      if isinstance(req, dict):
        pool.submit(work, req)
  finally:
    pool.shutdown(wait=True)


def main():
  if '--serve' in sys.argv:
    return serve()
  args = [a for a in sys.argv[1:] if not a.startswith('--')]
  raw = (args[0] if args else sys.stdin.read()).strip()
  if not raw:
    print('GPTANON_FAIL empty prompt', file=sys.stderr, flush=True)
    raise SystemExit(10)
  files = []
  try:
    data = json.loads(raw)
    if isinstance(data, dict) and 'messages' in data:
      msgs, model, files = data.get('messages'), data.get('model'), (data.get('files') or data.get('attachments') or [])
    elif isinstance(data, list):
      msgs, model = data, None
    else:
      msgs, model = [{'role': 'user', 'content': raw}], None
  except Exception:
    msgs, model = [{'role': 'user', 'content': raw}], None
  try:
    sys.stdout.write(ask(msgs, model, files))
  except LLMError as e:
    print(f'GPTANON_FAIL {e}', file=sys.stderr, flush=True)
    raise SystemExit(e.code)
  except Exception as e:
    print(f'GPTANON_FAIL unexpected {type(e).__name__}: {str(e)[:300]}', file=sys.stderr, flush=True)
    raise SystemExit(17)


_load_cache()

if __name__ == '__main__':
  main()
