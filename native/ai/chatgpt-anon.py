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


def _messages(msgs):
  out = []
  for m in msgs or []:
    if isinstance(m, dict):
      role = str(m.get('role') or 'user').lower()
      text = m.get('content')
    else:
      role, text = 'user', m
    text = str(text or '').strip()
    if not text:
      continue
    out.append(_message('assistant' if role == 'assistant' else 'system' if role == 'system' else 'user', text))
  return out


def _body(msgs, model):
  # camelCase + supportedEncodings=['text/plain'] makes upstream send
  # cumulative message snapshots (no delta_encoding patches), so a dropped
  # patch can never truncate the answer. forceUseSse keeps the stream SSE.
  return {
    'action': 'next',
    'messages': _messages(msgs),
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


def ask(msgs, model=None):
  model = model or DEFAULT_MODEL
  if not _messages(msgs):
    raise LLMError('empty prompt', 10)
  body = json.dumps(_body(msgs, model))
  conduit = ''
  last = ''
  for attempt in range(3):
    tok = _sentinel(force=attempt > 0)
    headers = _headers()
    headers['openai-sentinel-chat-requirements-token'] = tok
    headers['x-conduit-token'] = conduit or 'no-token'
    try:
      r = session().post(BASE + 'f/conversation', headers=headers, data=body, timeout=TIMEOUT)
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
      conduit = _prepare(msgs, model)
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
      resp = {'id': rid, 'text': ask(req.get('messages') or [], req.get('model'))}
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
  try:
    data = json.loads(raw)
    if isinstance(data, dict) and 'messages' in data:
      msgs, model = data.get('messages'), data.get('model')
    elif isinstance(data, list):
      msgs, model = data, None
    else:
      msgs, model = [{'role': 'user', 'content': raw}], None
  except Exception:
    msgs, model = [{'role': 'user', 'content': raw}], None
  try:
    sys.stdout.write(ask(msgs, model))
  except LLMError as e:
    print(f'GPTANON_FAIL {e}', file=sys.stderr, flush=True)
    raise SystemExit(e.code)
  except Exception as e:
    print(f'GPTANON_FAIL unexpected {type(e).__name__}: {str(e)[:300]}', file=sys.stderr, flush=True)
    raise SystemExit(17)


_load_cache()

if __name__ == '__main__':
  main()
