import base64
import json
import random
import sys
import time
import uuid
from datetime import datetime, timezone

from curl_cffi import requests

# Windows console defaults to cp1252 — emoji in prompt/answer would crash
# stdout on write. Force UTF-8 pipes so 😭 survives the trip to TS.
try:
  sys.stdin.reconfigure(encoding='utf-8', errors='replace')
  sys.stdout.reconfigure(encoding='utf-8', errors='replace')
  sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
  pass

# One-shot anonymous chat with chatgpt.com: prompt in (argv or stdin),
# answer out on stdout. Every run mints a fresh device + tokens.
# Needs curl_cffi — plain fetch gets stopped at the edge (TLS fingerprint).
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
BASE = 'https://chatgpt.com'


def enc(o):
  return base64.b64encode(json.dumps(o, separators=(',', ':')).encode()).decode()


# FNV-style hash the backend uses for the proof-of-work check.
def mod(e):
  t = 2166136261
  for ch in e:
    t ^= ord(ch)
    t = (t * 16777619) & 0xFFFFFFFF
  t ^= (t >> 16)
  t = (t * 2246822507) & 0xFFFFFFFF
  t ^= (t >> 13)
  t = (t * 3266489909) & 0xFFFFFFFF
  t ^= (t >> 16)
  return f'{t:08x}'


# Grind the counter until the hash prefix beats the difficulty.
# Usually lands in a few thousand tries — a second or two.
def solve_pow(seed, difficulty, config):
  t0 = int(time.time() * 1000)
  for i in range(500000):
    config[3] = i
    config[9] = round(time.time() * 1000 - t0)
    e = enc(config)
    if mod(seed + e)[:len(difficulty)] <= difficulty:
      return 'gAAAAAB' + e + '~S'
  raise RuntimeError('pow unsolved')


# Pick text deltas out of the event stream, skip the control frames.
def parse_stream(text):
  out = []
  for line in text.split('\n'):
    if not line.startswith('data:'):
      continue
    s = line[5:].strip()
    if not s or s == '[DONE]':
      continue
    try:
      d = json.loads(s)
    except Exception:
      continue
    if not isinstance(d, dict):
      continue
    if d.get('o') == 'append' and d.get('p') == '/message/content/parts/0':
      out.append(d.get('v'))
    elif d.get('o') == 'patch' and isinstance(d.get('v'), list):
      for op in d['v']:
        if op.get('o') == 'append' and op.get('p') == '/message/content/parts/0':
          out.append(op.get('v'))
    elif isinstance(d.get('v'), str):
      out.append(d['v'])
  return ''.join(x for x in out if isinstance(x, str))


# One clear line on stderr + a distinct exit code per stage,
# so the TS side can tell *where* it died without parsing tracebacks.
def fail(msg, code):
  print(f'GPTANON_FAIL {msg}', file=sys.stderr, flush=True)
  raise SystemExit(code)


def main():
  t_start = time.time()
  mark = lambda: round((time.time() - t_start) * 1000)
  timed = '--timed' in sys.argv
  log = lambda *a: timed and print('TIMED', mark(), *a, file=sys.stderr, flush=True)
  prompt = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != '--timed' else sys.stdin.read()
  prompt = prompt.strip()
  if not prompt:
    fail('empty prompt', 10)
  s = requests.Session(impersonate='chrome133a')
  s.headers.update({'user-agent': UA})
  log('session-ready')
  land = s.get(BASE, timeout=30)
  if land.status_code != 200:
    fail(f'landing HTTP {land.status_code}', 11)
  log('landing', land.status_code)
  try:
    prod = land.text.split('data-build="')[1].split('"')[0]
  except IndexError:
    fail('no data-build in landing', 12)
  did = s.cookies.get('oai-did') or str(uuid.uuid4())
  t0 = int(time.time() * 1000)
  now = datetime.now(timezone.utc).astimezone()
  cfg = [4880, now.strftime('%a %b %d %Y %H:%M:%S GMT%z (%Z)'), 4294705152, random.random(),
    UA, None, prod, 'id-ID', 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7', random.random(),
    'x', 'location', 'window', 800 + random.random() * 600, str(uuid.uuid4()), '', 20, t0]
  req_h = {'accept': '*/*', 'content-type': 'application/json', 'oai-client-version': prod,
    'oai-device-id': did, 'oai-language': 'id-ID', 'origin': BASE, 'referer': BASE + '/'}
  req = s.post(BASE + '/backend-anon/sentinel/chat-requirements', json={'p': 'gAAAAAC' + enc(cfg)},
    headers=req_h, timeout=30)
  if req.status_code != 200:
    fail(f'requirements HTTP {req.status_code} {req.text[:200]}', 13)
  jr = req.json()
  log('requirements', req.status_code)
  t_pow = time.time()
  pow_token = solve_pow(jr['proofofwork']['seed'], jr['proofofwork']['difficulty'], cfg)
  log('pow', round((time.time() - t_pow) * 1000))
  prep_h = {'accept': '*/*', 'content-type': 'application/json', 'oai-client-version': prod,
    'oai-device-id': did, 'oai-language': 'id-ID', 'origin': BASE, 'referer': BASE + '/',
    'x-conduit-token': 'no-token'}
  prep = s.post(BASE + '/backend-anon/f/conversation/prepare', headers=prep_h, json={
    'action': 'next', 'fork_from_shared_post': False, 'parent_message_id': 'client-created-root',
    'model': 'auto', 'timezone_offset_min': 420, 'timezone': 'Asia/Jakarta',
    'history_and_training_disabled': True, 'conversation_mode': {'kind': 'primary_assistant'},
    'system_hints': [], 'supports_buffering': True, 'supported_encodings': ['v1']}, timeout=30)
  conduit = ''
  try:
    conduit = prep.json().get('conduit_token') or ''
  except Exception:
    pass
  if not conduit:
    fail(f'prepare HTTP {prep.status_code} {prep.text[:200]}', 14)
  log('prepare', prep.status_code)
  # Turnstile goes out blank — the backend currently waves it through,
  # so no need to lug around the whole VM decompiler.
  conv_h = {'accept': 'text/event-stream', 'content-type': 'application/json',
    'oai-client-version': prod, 'oai-device-id': did, 'oai-language': 'id-ID',
    'openai-sentinel-chat-requirements-token': jr['token'],
    'openai-sentinel-proof-token': pow_token,
    'openai-sentinel-turnstile-token': '',
    'origin': BASE, 'referer': BASE + '/', 'x-conduit-token': conduit}
  conv = s.post(BASE + '/backend-anon/f/conversation', headers=conv_h, json={
    'action': 'next', 'messages': [{'id': str(uuid.uuid4()), 'author': {'role': 'user'},
    'create_time': round(time.time(), 3),
    'content': {'content_type': 'text', 'parts': [prompt]}, 'metadata': {}}],
    'parent_message_id': 'client-created-root', 'model': 'auto',
    'timezone_offset_min': 420, 'timezone': 'Asia/Jakarta',
    'history_and_training_disabled': True, 'conversation_mode': {'kind': 'primary_assistant'},
    'system_hints': [], 'supports_buffering': True, 'supported_encodings': ['v1']}, timeout=60)
  log('conversation', conv.status_code, len(conv.text))
  if conv.status_code != 200:
    fail(f'conversation HTTP {conv.status_code} {conv.text[:300]}', 15)
  text = parse_stream(conv.text).strip()
  if not text:
    fail('empty response', 16)
  sys.stdout.write(text)


if __name__ == '__main__':
  try:
    main()
  except SystemExit:
    raise
  except Exception as e:
    # anything unexpected (network drop, bad JSON, curl hiccup) gets one
    # clean line + code 17 instead of a raw traceback
    print(f'GPTANON_FAIL unexpected {type(e).__name__}: {str(e)[:300]}', file=sys.stderr, flush=True)
    raise SystemExit(17)
