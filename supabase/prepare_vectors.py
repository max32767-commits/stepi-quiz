#!/usr/bin/env python3
"""
꼬멘틀용 단어 벡터 업로드 스크립트 (한 번만 실행)

  1) fastText 한국어 벡터 내려받기 (약 1.2GB, 압축 해제 후 4.5GB)
       https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.ko.300.vec.gz
  2) pip install psycopg2-binary numpy
  3) 실행:
       python prepare_vectors.py cc.ko.300.vec.gz "postgresql://postgres:[PW]@db.[PROJECT].supabase.co:5432/postgres"
     (DB 접속 문자열: Supabase > Project Settings > Database > Connection string, URI)

  - 한글로만 된 2~6글자 단어 중 빈도 상위 N개(기본 10만)만 올립니다.
  - 정답 후보(candidate)는 그중 상위 5,000개 명사성 단어입니다 (상위일수록 흔한 단어).
"""
import sys, gzip, re, io
import numpy as np
import psycopg2
from psycopg2.extras import execute_values

VEC = sys.argv[1]
DSN = sys.argv[2]
LIMIT = int(sys.argv[3]) if len(sys.argv) > 3 else 100_000
CAND = 5000
HANGUL = re.compile(r'^[가-힣]{2,6}$')
STOP = ('하다', '있다', '없다', '되다', '이다', '같다', '그리고', '그러나', '하지만', '그런데', '것이', '것은', '것을')

def rows():
    op = gzip.open if VEC.endswith('.gz') else open
    with op(VEC, 'rt', encoding='utf-8', errors='ignore') as f:
        next(f)  # header
        n = 0
        for line in f:
            w, _, rest = line.partition(' ')
            if not HANGUL.match(w) or w.endswith(STOP[:2]) or w in STOP:
                continue
            v = np.fromstring(rest, sep=' ', dtype=np.float32)
            if v.size != 300:
                continue
            v = v / (np.linalg.norm(v) or 1)
            yield w, '[' + ','.join(f'{x:.5f}' for x in v) + ']', n < CAND
            n += 1
            if n >= LIMIT:
                return

conn = psycopg2.connect(DSN)
cur = conn.cursor()
cur.execute('truncate words restart identity cascade')
batch, total = [], 0
for r in rows():
    batch.append(r)
    if len(batch) >= 2000:
        execute_values(cur, 'insert into words(word, embedding, candidate) values %s on conflict (word) do nothing', batch)
        conn.commit(); total += len(batch); batch = []
        print(f'\r{total:,} 단어 업로드', end='', flush=True)
if batch:
    execute_values(cur, 'insert into words(word, embedding, candidate) values %s on conflict (word) do nothing', batch)
    conn.commit(); total += len(batch)
print(f'\n완료: {total:,} 단어 (정답 후보 {CAND:,})')
