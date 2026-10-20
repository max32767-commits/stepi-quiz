#!/usr/bin/env python3
"""사전에 없는 단어를 꼬멘틀 정답으로 쓰기 위한 SQL 생성기.
   python3 make_word_sql.py cc.ko.300.vec.gz 연찬회 단합대회 ... > words.sql  → Supabase SQL Editor 에 붙여넣고 Run
   (fastText 어휘 200만 개에 있는 단어만 가능. 벡터 파일: https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.ko.300.vec.gz)"""
import sys, gzip, unicodedata
import numpy as np
VEC, want = sys.argv[1], [unicodedata.normalize('NFC', w) for w in sys.argv[2:]]
left, rows = set(want), []
with gzip.open(VEC, 'rt', encoding='utf-8', errors='ignore') as f:
    next(f)
    for line in f:
        w, _, rest = line.partition(' ')
        if w in left:
            v = np.fromstring(rest, sep=' ', dtype=np.float32); v /= (np.linalg.norm(v) or 1)
            rows.append(f"('{w}', '[{','.join(f'{x:.4f}' for x in v)}]', false)"); left.discard(w)
            if not left: break
if rows:
    print("insert into words(word, embedding, candidate) values\n" + ",\n".join(rows) + "\non conflict (word) do nothing;")
if left: print("-- fastText 에 없는 단어 (추가 불가): " + ", ".join(sorted(left)), file=sys.stderr)
