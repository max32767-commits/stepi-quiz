/* 브라우저 안 얼굴 인식 (InsightFace SCRFD-500m 검출 + ArcFace MobileFaceNet 임베딩, ONNX Runtime Web)
 *   await FACE.load(onProgress)            // 모델 2개(약 16MB) 로드
 *   const f = await FACE.analyze(img)      // {box, kps, score, emb(512, 정규화), faces:n} 또는 null(얼굴 없음)
 *   FACE.similarity(a.emb, b.emb)          // 코사인 유사도(-1~1)
 *   FACE.toScore(cos)                      // 0~100 닮은꼴 점수 */
(function () {
  'use strict';
  const BASE = (document.currentScript && document.currentScript.src.replace(/[^/]*$/, '')) || './';
  const TPL = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
  let det = null, rec = null, loading = null;

  async function load(onProgress) {
    if (det && rec) return;
    if (loading) return loading;
    loading = (async () => {
      ort.env.wasm.wasmPaths = BASE + 'ort/';
      ort.env.wasm.numThreads = 1;
      const opt = { executionProviders: ['wasm'] };
      const fetchBuf = async (name, label) => {
        const res = await fetch(BASE + 'models/' + name); if (!res.ok) throw new Error(name + ' 로드 실패');
        const total = +res.headers.get('content-length') || 0, reader = res.body.getReader(), chunks = []; let got = 0;
        for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; if (onProgress) onProgress(label, total ? got / total : 0); }
        const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out;
      };
      det = await ort.InferenceSession.create(await fetchBuf('det_500m.onnx', '얼굴 검출 모델'), opt);
      rec = await ort.InferenceSession.create(await fetchBuf('w600k_mbf.onnx', '얼굴 특징 모델'), opt);
    })();
    try { await loading; } finally { loading = null; }
  }

  // 큰 사진은 먼저 줄여서(긴 변 1280) 처리 속도를 맞춘다
  function shrink(img) {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, k = Math.min(1, 1280 / Math.max(W, H));
    if (k === 1) return img;
    const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
  }

  async function detect(img) {
    const S = 640, W = img.width, H = img.height, sc = S / Math.max(W, H);
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    g.drawImage(img, 0, 0, Math.round(W * sc), Math.round(H * sc));
    const d = g.getImageData(0, 0, S, S).data, x = new Float32Array(3 * S * S), N = S * S;
    for (let i = 0; i < N; i++) { x[i] = (d[i * 4] - 127.5) / 128; x[N + i] = (d[i * 4 + 1] - 127.5) / 128; x[2 * N + i] = (d[i * 4 + 2] - 127.5) / 128; }
    const out = await det.run({ 'input.1': new ort.Tensor('float32', x, [1, 3, S, S]) });
    const names = det.outputNames, res = [];
    [8, 16, 32].forEach((st, i) => {
      const n = S / st, scores = out[names[i]].data, boxes = out[names[3 + i]].data, kps = out[names[6 + i]].data;
      for (let j = 0; j < scores.length; j++) {
        if (scores[j] < 0.5) continue;
        const cell = j >> 1, cx = (cell % n) * st, cy = Math.floor(cell / n) * st;
        const b = [cx - boxes[j * 4] * st, cy - boxes[j * 4 + 1] * st, cx + boxes[j * 4 + 2] * st, cy + boxes[j * 4 + 3] * st];
        const k = []; for (let q = 0; q < 5; q++) k.push([(cx + kps[j * 10 + q * 2] * st) / sc, (cy + kps[j * 10 + q * 2 + 1] * st) / sc]);
        res.push({ score: scores[j], box: b.map(v => v / sc), kps: k });
      }
    });
    res.sort((a, b) => b.score - a.score);
    const keep = [];
    for (const r of res) {
      let ok = true;
      for (const q of keep) {
        const a = r.box, b = q.box, ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
        const inter = ix * iy, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
        if (inter / u > 0.4) { ok = false; break; }
      }
      if (ok) keep.push(r);
    }
    return keep;
  }

  // 5개 랜드마크 → 112×112 표준 위치로 보내는 닮음변환(회전+배율+이동)
  function similarityTransform(src, dst) {
    let msx = 0, msy = 0, mdx = 0, mdy = 0; for (let i = 0; i < 5; i++) { msx += src[i][0]; msy += src[i][1]; mdx += dst[i][0]; mdy += dst[i][1]; }
    msx /= 5; msy /= 5; mdx /= 5; mdy /= 5;
    let a = 0, b = 0, n = 0;
    for (let i = 0; i < 5; i++) { const sx = src[i][0] - msx, sy = src[i][1] - msy, dx = dst[i][0] - mdx, dy = dst[i][1] - mdy; a += sx * dx + sy * dy; b += sx * dy - sy * dx; n += sx * sx + sy * sy; }
    const A = a / n, B = b / n;
    return { A, B, tx: mdx - (A * msx - B * msy), ty: mdy - (B * msx + A * msy) };
  }

  async function embed(img, kps) {
    const { A, B, tx, ty } = similarityTransform(kps, TPL);
    const c = document.createElement('canvas'); c.width = c.height = 112;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 112, 112);
    g.setTransform(A, B, -B, A, tx, ty); g.drawImage(img, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
    const d = g.getImageData(0, 0, 112, 112).data, N = 112 * 112, x = new Float32Array(3 * N);
    for (let i = 0; i < N; i++) { x[i] = (d[i * 4] - 127.5) / 127.5; x[N + i] = (d[i * 4 + 1] - 127.5) / 127.5; x[2 * N + i] = (d[i * 4 + 2] - 127.5) / 127.5; }
    const out = await rec.run({ 'input.1': new ort.Tensor('float32', x, [1, 3, 112, 112]) });
    const e = Array.from(out[rec.outputNames[0]].data); let s = 0; for (const v of e) s += v * v; s = Math.sqrt(s) || 1;
    return { emb: e.map(v => v / s), face: c.toDataURL('image/jpeg', 0.85) };
  }

  async function analyze(imgEl) {
    await load();
    const img = shrink(imgEl), faces = await detect(img);
    if (!faces.length) return null;
    // 여러 명이면 가장 큰 얼굴
    faces.sort((a, b) => (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]) - (a.box[2] - a.box[0]) * (a.box[3] - a.box[1]));
    const f = faces[0], { emb, face } = await embed(img, f.kps);
    return { box: f.box, kps: f.kps, score: f.score, emb, face, faces: faces.length };
  }

  function similarity(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  // 서로 다른 사람끼리의 코사인 유사도는 대체로 -0.1~0.3 사이에 몰린다 → 그 구간을 넓게 펴서 0~100점으로
  const CURVE = [[-0.15, 8], [-0.05, 22], [0, 35], [0.1, 52], [0.2, 68], [0.3, 82], [0.45, 95], [0.6, 100]];
  function toScore(cos) {
    if (cos <= CURVE[0][0]) return CURVE[0][1]; if (cos >= CURVE[CURVE.length - 1][0]) return 100;
    for (let i = 1; i < CURVE.length; i++) if (cos <= CURVE[i][0]) { const [x0, y0] = CURVE[i - 1], [x1, y1] = CURVE[i]; return Math.round(y0 + (y1 - y0) * (cos - x0) / (x1 - x0)); }
    return 100;
  }
  window.FACE = { load, analyze, similarity, toScore, get ready() { return !!(det && rec); } };
})();
