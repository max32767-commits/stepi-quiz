/* 부위별 닮은꼴 분석 — MediaPipe Face Mesh(468점) 랜드마크로 얼굴형·눈·코·입·눈썹의 기하 특징을 재고
 * 두 얼굴을 부위별로 비교해 "어디가 닮았는지" 문장을 만든다. (총점은 face.js의 ArcFace가 담당)
 *   await PARTS.load()
 *   const f = await PARTS.analyze(img)      // 특징 객체 또는 null
 *   PARTS.compare(fa, fb, nameA, nameB)     // {parts:[{key,label,score,note}], text, diffText} */
(function () {
  'use strict';
  const BASE = (document.currentScript && document.currentScript.src.replace(/[^/]*$/, '')) || './';
  let mesh = null, pending = null, loading = null;

  function load() {
    if (mesh) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      try {
        mesh = new FaceMesh({ locateFile: f => BASE + 'mp/' + f });
        mesh.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.4, staticImageMode: true });
        mesh.onResults(r => { const p = pending; pending = null; if (p) p(r); });
        mesh.initialize().then(res, rej);
      } catch (e) { rej(e); }
    });
    return loading;
  }

  // 사진이 너무 크면 줄여서(긴 변 800) 넘긴다
  function prep(img) {
    const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height, k = Math.min(1, 800 / Math.max(W, H));
    const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
  }
  async function landmarks(img) {
    await load();
    const c = prep(img);
    if (mesh.reset) mesh.reset();   // 이전 사진의 추적 상태를 지워 사진마다 같은 결과가 나오게
    const r = await new Promise(res => { pending = res; mesh.send({ image: c }); });
    const lm = r.multiFaceLandmarks && r.multiFaceLandmarks[0]; if (!lm) return null;
    return lm.map(p => [p.x * c.width, p.y * c.height]);
  }

  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  // 안쪽 점(inner)에서 바깥 점(outer)으로 갈 때 올라가는 각도(도). 왼쪽 눈은 바깥이 -x 방향이므로 dir=-1
  const tilt = (inner, outer, dir) => Math.atan2(-(outer[1] - inner[1]), dir * (outer[0] - inner[0])) * 180 / Math.PI;
  const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
  function features(L) {
    // 눈 중심선을 수평으로 맞춰 회전 보정
    const le = mid(L[33], L[133]), re = mid(L[362], L[263]), roll = Math.atan2(re[1] - le[1], re[0] - le[0]);
    const cs = Math.cos(-roll), sn = Math.sin(-roll), cx = (le[0] + re[0]) / 2, cy = (le[1] + re[1]) / 2;
    const P = L.map(([x, y]) => [cx + (x - cx) * cs - (y - cy) * sn, cy + (x - cx) * sn + (y - cy) * cs]);
    const fw = d(P[234], P[454]), fh = d(P[10], P[152]);
    const yaw = ((P[1][0] - (P[234][0] + P[454][0]) / 2) / fw);   // 코끝이 중앙에서 벗어난 정도(옆모습 판정)
    const eyeW = (d(P[33], P[133]) + d(P[362], P[263])) / 2, eyeH = (d(P[159], P[145]) + d(P[386], P[374])) / 2;
    const f = {
      yaw,
      faceRatio: fw / fh,                                            // 얼굴 가로/세로
      jawWidth: d(P[58], P[288]) / fw,                                // 턱선 폭(광대 대비)
      chinAngle: Math.abs(ang(P[152], P[58]) - ang(P[152], P[288])), // 턱끝 각도(클수록 둥글/넓음)
      eyeAspect: eyeH / eyeW,                                         // 눈 높이/길이
      eyeSize: eyeW / fw,                                             // 눈 길이(얼굴 폭 대비)
      eyeTilt: (tilt(P[133], P[33], -1) + tilt(P[362], P[263], 1)) / 2,   // 눈꼬리 기울기(+: 올라감)
      eyeGap: d(P[133], P[362]) / eyeW,                               // 미간(눈 길이 대비)
      noseLen: d(P[168], P[2]) / fh,                                  // 코 길이
      noseW: d(P[48], P[278]) / fw,                                   // 콧볼 폭
      mouthW: d(P[61], P[291]) / fw,                                  // 입 너비
      lipH: d(P[0], P[17]) / fh,                                      // 입술 두께(위+아래)
      browTilt: (tilt(P[107], P[70], -1) + tilt(P[336], P[300], 1)) / 2,  // 눈썹 기울기(+: 올라감)
      browGap: ((P[159][1] - P[105][1]) + (P[386][1] - P[334][1])) / 2 / fh   // 눈썹-눈 거리
    };
    return f;
  }
  function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

  async function analyze(img) { const L = await landmarks(img); return L ? features(L) : null; }

  // 부위 정의: 비교에 쓰는 특징과 허용 오차(이만큼 차이면 0점), 공통 특징 설명
  const PARTS = [
    { key: 'face', label: '얼굴형', feats: [['faceRatio', 0.09], ['jawWidth', 0.07], ['chinAngle', 18]],
      traits: [['faceRatio', 0.82, 0.90, '갸름한 계란형 얼굴', '둥글고 넓은 얼굴형'], ['chinAngle', 98, 106, '뾰족한 턱선', '둥근 턱선']] },
    { key: 'eye', label: '눈매', feats: [['eyeAspect', 0.12], ['eyeTilt', 7], ['eyeSize', 0.03], ['eyeGap', 0.08]],
      traits: [['eyeTilt', 3, 7, '처진 눈매', '눈꼬리가 올라간 눈매'], ['eyeAspect', 0.28, 0.36, '가늘고 긴 눈', '동그랗고 큰 눈'], ['eyeGap', 1.19, 1.23, '눈 사이가 가까운 편', '눈 사이가 먼 편']] },
    { key: 'nose', label: '코', feats: [['noseLen', 0.035], ['noseW', 0.04]],
      traits: [['noseLen', 0.315, 0.335, '짧은 코', '길고 오똑한 코'], ['noseW', 0.255, 0.28, '콧볼이 좁은 코', '콧볼이 넓은 편']] },
    { key: 'mouth', label: '입매', feats: [['mouthW', 0.1], ['lipH', 0.035]],
      traits: [['mouthW', 0.36, 0.42, '작은 입', '큰 입'], ['lipH', 0.095, 0.115, '얇은 입술', '도톰한 입술']] },
    { key: 'brow', label: '눈썹', feats: [['browTilt', 9], ['browGap', 0.03]],
      traits: [['browTilt', -10, -4, '끝이 처진 눈썹', '일자 눈썹'], ['browGap', 0.115, 0.135, '눈과 가까운 눈썹', '눈과 먼 눈썹']] }
  ];
  const sideLabel = { face: '얼굴은 {n} 님이 더 넓적해요', eye: '눈은 {n} 님이 더 커요', nose: '코는 {n} 님이 더 길어요', mouth: '입은 {n} 님이 더 커요', brow: '눈썹은 {n} 님이 더 올라가 있어요' };

  function compare(a, b, nameA, nameB) {
    if (!a || !b) return null;
    const parts = PARTS.map(p => {
      let s = 0; for (const [k, tol] of p.feats) s += Math.max(0, 1 - Math.abs(a[k] - b[k]) / tol);
      const score = Math.round(100 * s / p.feats.length);
      // 둘 다 같은 쪽에 있는 특징(공통점) 찾기
      let note = '';
      for (const [k, loT, hiT, lo, hi] of p.traits) {   // 둘 다 뚜렷하게 기준 아래면 lo, 둘 다 위면 hi
        if (a[k] < loT && b[k] < loT) { note = lo; break; }
        if (a[k] > hiT && b[k] > hiT) { note = hi; break; }
      }
      if (!note && score >= 55) for (const [k, loT, hiT, lo, hi] of p.traits) {   // 뚜렷하진 않아도 같은 쪽이면 '살짝'을 붙여 설명
        const mid = (loT + hiT) / 2, sa = a[k] >= mid, sb = b[k] >= mid;
        if (sa === sb) { note = '살짝 ' + (sa ? hi : lo); break; }
      }
      return { key: p.key, label: p.label, score, note };
    });
    const sorted = [...parts].sort((x, y) => y.score - x.score);
    const good = sorted.filter(p => p.score >= 55).slice(0, 3), bad = sorted[sorted.length - 1];
    const side = Math.abs(a.yaw) > 0.22 || Math.abs(b.yaw) > 0.22;
    let text;
    if (!good.length) text = '부위별로는 뚜렷하게 겹치는 특징이 없어요 — 전체 인상이 다른 타입';
    else text = (good.length >= 2 ? '특히 닮은 부위: ' : '닮은 부위: ') + good.map(p => `<b>${p.label}</b>${p.note ? `(${p.note})` : ''}`).join(' · ');
    // 가장 다른 부위 한 줄
    let diffText = '';
    if (bad && bad.score < 45) {
      const p = PARTS.find(x => x.key === bad.key), k = p.feats[0][0], more = a[k] > b[k] ? nameA : nameB;
      diffText = sideLabel[bad.key].replace('{n}', more);
    }
    if (side) diffText = (diffText ? diffText + ' · ' : '') + '옆으로 돌린 사진이라 부위 비교는 참고만';
    return { parts, text, diffText };
  }

  window.PARTS = { load, analyze, compare, get ready() { return !!mesh; } };
})();
