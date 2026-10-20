#!/usr/bin/env python3
"""
꼬맨틀 단어 벡터 업로드 (이미 완료됨 — 다시 올릴 때만 사용)

  1) fastText 한국어 벡터: https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.ko.300.vec.gz (1.2GB)
  2) 정답 후보 목록: https://github.com/newsjelly/semantle-ko 의 data/secrets.txt
  3) Supabase SQL Editor 에서 임시 정책 열기:
        create policy words_insert_tmp on words for insert to anon with check (true);
  4) pip install numpy
     SB_URL=https://<project>.supabase.co SB_KEY=<publishable key> python upload_words.py cc.ko.300.vec.gz secrets.txt 70000
     (중단되면 같은 명령으로 재실행 — progress.txt 부터 이어서 올림)
  5) 끝나면 정책 닫기:  drop policy words_insert_tmp on words;

  - 한글로만 된 단어를 빈도순으로 LIMIT 개 올립니다. HNSW 인덱스 때문에 7만 개 근처부터 insert 가 느려집니다.
  - 벡터는 정규화해서 저장하므로 코사인 유사도 = 내적입니다.
"""
import sys, gzip, re, json, os, time, unicodedata, urllib.request
import numpy as np
VEC, SECRETS = sys.argv[1], sys.argv[2]
LIMIT = int(sys.argv[3]) if len(sys.argv) > 3 else 70000
URL, KEY = os.environ['SB_URL'].rstrip('/') + '/rest/v1/words', os.environ['SB_KEY']
HANGUL = re.compile(r'^[가-힣]{1,8}$')
cands = {unicodedata.normalize('NFC', l.strip()) for l in open(SECRETS, encoding='utf-8') if l.strip()}
done = int(open('progress.txt').read() or 0) if os.path.exists('progress.txt') else 0
def post(rows):
    body = json.dumps(rows, ensure_ascii=False).encode()
    req = urllib.request.Request(URL, data=body, method='POST', headers={
        'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'})
    for i in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return r.status
        except Exception as e:
            err = getattr(e, 'read', lambda: b'')().decode(errors='ignore')[:300]
            print('\nretry', i, e, err, flush=True); time.sleep(3 * (i + 1))
    raise SystemExit('upload failed')
seen, batch, total, nc = set(), [], 0, 0
with gzip.open(VEC, 'rt', encoding='utf-8', errors='ignore') as f:
    next(f)
    for line in f:
        w, _, rest = line.partition(' ')
        w = unicodedata.normalize('NFC', w)
        if not HANGUL.match(w) or w in seen: continue
        seen.add(w)
        if len(seen) <= done: continue          # 이미 올린 구간 건너뛰기
        v = np.fromstring(rest, sep=' ', dtype=np.float32)
        if v.size != 300: continue
        v /= (np.linalg.norm(v) or 1)
        c = w in cands; nc += c
        batch.append({'word': w, 'embedding': '[' + ','.join(f'{x:.4f}' for x in v) + ']', 'candidate': c})
        if len(batch) >= 150:
            post(batch); total += len(batch); batch = []
            open('progress.txt', 'w').write(str(len(seen)))
            print(f'\r{len(seen):,} 단어 (이번 실행 {total:,}, 후보 {nc:,})', end='', flush=True)
        if len(seen) >= LIMIT: break
if batch: post(batch); open('progress.txt', 'w').write(str(len(seen)))
print(f'\n현재 {len(seen):,} / {LIMIT:,}', flush=True)
