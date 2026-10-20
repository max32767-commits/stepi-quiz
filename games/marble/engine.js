/* 마블 룰렛 — 물리 엔진 · 맵 · 레이스 상태
 * 모든 좌표는 "월드 단위". 맵 폭은 W(26), 세로는 맵마다 다르다.
 * 고정 시간 간격(1/120초)으로 시뮬레이션하므로 같은 시드·입력·맵이면 같은 결과가 나온다. */
(function () {
  'use strict';

  const W = 26;
  const STEP = 1 / 120;      // 고정 스텝
  const SUB = 3;             // 스텝당 서브스텝
  const GRAVITY = 30;
  const MAX_SPEED = 34;
  const SETTLE_STEPS = 240;  // 시작 전 정착 스텝 수(고정 → 결정론 유지)
  const TIMEOUT = 240;       // 초. 이 시간이 지나도 남은 구슬은 현재 위치(더 아래쪽 우선)로 순위 확정

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function newSeed() {
    try {
      const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] || 1;
    } catch (e) { return (Math.random() * 4294967295) >>> 0 || 1; }
  }

  /* ------------------------------------------------------------------ 맵 */
  function MapBuilder(H) {
    this.H = H; this.goalY = H;
    this.walls = []; this.pegs = []; this.bumpers = []; this.rotors = [];
    this.movers = []; this.portals = [];
  }
  MapBuilder.prototype.wall = function (ax, ay, bx, by, t) { this.walls.push({ ax, ay, bx, by, t: t || 0.14 }); return this; };
  MapBuilder.prototype.peg = function (x, y, r) { this.pegs.push({ x, y, r: r || 0.26 }); return this; };
  MapBuilder.prototype.bumper = function (x, y, r) { this.bumpers.push({ x, y, r: r || 0.7, hit: 0 }); return this; };
  MapBuilder.prototype.rotor = function (cx, cy, len, speed, angle) {
    this.rotors.push({ cx, cy, len, speed, angle: angle || 0, t: 0.2 }); return this;
  };
  // 좌우로 왕복하는 막대: 중심(cx,cy), 길이 len, 진폭 amp, 주기 period(초)
  MapBuilder.prototype.slider = function (cx, cy, len, amp, period, phase, angle) {
    this.movers.push({ type: 'slider', cx, cy, len, amp, w: Math.PI * 2 / period, ph: phase || 0, ang: angle || 0, t: 0.2 });
    return this;
  };
  // 플리퍼: 축(px,py)에서 길이 len, 기본 각도 base에서 swing만큼 주기적으로 튕겨 올림
  MapBuilder.prototype.flipper = function (px, py, len, base, swing, period, phase) {
    this.movers.push({ type: 'flipper', px, py, len, base, swing, w: Math.PI * 2 / period, ph: phase || 0, t: 0.22 });
    return this;
  };
  // 순간이동 포털: 입구(ax,ay) → 출구(bx,by)
  MapBuilder.prototype.portal = function (ax, ay, bx, by) {
    this.portals.push({ ax, ay, bx, by, r: 0.85 });
    return this;
  };
  // 양쪽 벽에서 가운데 틈으로 모으는 깔때기
  MapBuilder.prototype.funnel = function (y, gapHalf, drop) {
    this.wall(0, y, W / 2 - gapHalf, y + drop);
    this.wall(W, y, W / 2 + gapHalf, y + drop);
    return this;
  };
  MapBuilder.prototype.finish = function () {
    const H = this.H;
    // 도착 깔때기 + 좁은 결승 통로: 한 번에 한 개씩 통과하도록 순서를 분명하게 만든다
    this.wall(0, H - 9, W / 2 - 1.15, H - 2.2);
    this.wall(W, H - 9, W / 2 + 1.15, H - 2.2);
    this.wall(W / 2 - 1.15, H - 2.2, W / 2 - 1.15, H + 0.4);
    this.wall(W / 2 + 1.15, H - 2.2, W / 2 + 1.15, H + 0.4);
    this.goalY = H;
    return this;
  };

  const MAPS = [
    {
      id: 'classic', name: '클래식 핀볼', desc: '엇갈린 핀 숲과 회전 막대를 지나는 기본 맵',
      build(rng) {
        const H = 118, m = new MapBuilder(H);
        m.funnel(3, 5, 3);
        let row = 0, portalY = 40;
        for (let y = 9; y < H - 14; y += 2.5, row++) {
          if (row === 13) portalY = y + 1.25;
          if (row % 8 === 7) {
            if (row % 16 === 7) {
              m.rotor(W * 0.3, y + 1.2, 6.4, 2.2, rng() * 6);
              m.rotor(W * 0.7, y + 1.2, 6.4, -2.2, rng() * 6);
            } else {
              m.slider(W / 2, y + 1.2, 7, 7, 3.4, rng() * 6);   // 좌우로 움직이는 벽
            }
            y += 3; continue;
          }
          if (row % 8 === 3) { m.bumper(W * 0.5, y + 0.6, 0.8); }
          const off = row % 2 ? 1.3 : 0;
          for (let x = 1.4 + off; x < W - 1; x += 2.6) {
            if (row % 8 === 3 && Math.abs(x - W / 2) < 1.6) continue;
            if (row === 13 && (x < 3.5 || x > W - 3.5)) continue;   // 포털 자리
            m.peg(x, y);
          }
        }
        m.portal(1.6, portalY, W / 2, 81.2);      // 행운의 포털(아래로)
        m.portal(W - 1.6, portalY, W / 2, 24.8);  // 함정 포털(위로)
        // 결승 전 플리퍼
        m.flipper(1.2, H - 13.5, 6, 0.55, -0.75, 1.9, 0);
        m.flipper(W - 1.2, H - 13.5, 6, Math.PI - 0.55, 0.75, 1.9, Math.PI);
        return m.finish();
      }
    },
    {
      id: 'zigzag', name: '지그재그 슬로프', desc: '좌우로 꺾이는 경사로를 굴러 내려가는 마블 런',
      build(rng) {
        const H = 124, m = new MapBuilder(H);
        m.funnel(3, 4, 3);
        let left = true;
        for (let y = 10; y < H - 18; y += 12) {
          if (left) m.wall(0, y, W - 4, y + 6.5, 0.18);
          else m.wall(W, y, 4, y + 6.5, 0.18);
          // 경사로 끝 근처의 작은 핀과 회전 막대
          const ex = left ? W - 2 : 2;
          m.rotor(ex, y + 8.8, 3.4, left ? -2.6 : 2.6, rng() * 6);
          for (let i = 0; i < 3; i++) m.peg(5 + rng() * (W - 10), y + 9 + rng() * 1.2, 0.24);
          if (((y - 10) / 12) % 2 === 1) m.slider(W / 2, y + 10.4, 4, 6.5, 2.8, rng() * 6);
          left = !left;
        }
        // 2번째 경사로 끝 → 6번째 경사로 위로 순간이동
        m.portal(9, 25.2, W / 2, 71);
        m.flipper(3, H - 12.5, 5.5, 0.45, -0.7, 2.3, 0);
        m.flipper(W - 3, H - 12.5, 5.5, Math.PI - 0.45, 0.7, 2.3, Math.PI);
        return m.finish();
      }
    },
    {
      id: 'windmill', name: '풍차 들판', desc: '회전하는 풍차 사이로 구슬이 튕겨 다니는 맵',
      build(rng) {
        const H = 132, m = new MapBuilder(H);
        m.funnel(3, 5, 3);
        let r = 0;
        for (let y = 11; y < H - 16; y += 9, r++) {
          const xs = r % 2 ? [W * 0.33, W * 0.67] : [W * 0.17, W * 0.5, W * 0.83];
          xs.forEach((x, i) => m.rotor(x, y, xs.length === 3 ? 5.8 : 7, ((r + i) % 2 ? 1 : -1) * (1.7 + rng() * 1.2), rng() * 6));
          for (let i = 0; i < 5; i++) m.peg(1.5 + rng() * (W - 3), y + 4.2 + rng() * 1.4, 0.24);
          if (r % 3 === 1) { m.bumper(0.9, y + 4.5, 0.9); m.bumper(W - 0.9, y + 4.5, 0.9); }
          if (r % 3 === 2) m.slider(W / 2, y + 4.9, 5, 7.5, 3 + rng(), rng() * 6);
        }
        m.portal(W / 2, 11 + 9 * 4 + 4.9, 3, 11 + 9 * 9 + 6.4);
        m.flipper(1.2, H - 13, 6, 0.55, -0.75, 1.7, 0);
        m.flipper(W - 1.2, H - 13, 6, Math.PI - 0.55, 0.75, 1.7, Math.PI);
        return m.finish();
      }
    },
    {
      id: 'chevron', name: '산맥 장애물', desc: '지붕 모양 장애물과 범퍼가 이어지는 맵',
      build(rng) {
        const H = 140, m = new MapBuilder(H);
        m.funnel(3, 5, 3);
        let r = 0;
        for (let y = 10; y < H - 16; y += 7.5, r++) {
          const xs = r % 2 ? [W * 0.5] : [W * 0.22, W * 0.78];
          if (r % 2) { m.wall(0, y - 1, 2.6, y + 1.2); m.wall(W, y - 1, W - 2.6, y + 1.2); }
          xs.forEach(cx => { m.wall(cx - 3.2, y + 1.8, cx, y, 0.16); m.wall(cx, y, cx + 3.2, y + 1.8, 0.16); });
          const bx = r % 2 ? [W * 0.2, W * 0.8] : [W * 0.5];
          bx.forEach(x => m.bumper(x + (rng() - 0.5) * 2, y + 3.8, 0.75));
          for (let i = 0; i < 3; i++) m.peg(1.5 + rng() * (W - 3), y + 5.6 + rng(), 0.24);
          if (r % 3 === 2) m.slider(W / 2, y + 6.3, 4.5, 8, 2.6 + rng(), rng() * 6);
        }
        m.portal(W * 0.5, 10 + 7.5 * 3 + 3.8, W * 0.22, 10 + 7.5 * 10 - 1.2);
        m.flipper(1.2, H - 12.5, 6, 0.5, -0.75, 2, 0);
        m.flipper(W - 1.2, H - 12.5, 6, Math.PI - 0.5, 0.75, 2, Math.PI);
        return m.finish();
      }
    }
  ];

  // 정적 물체를 세로 구간(BUCKET)별로 묶어 충돌 검사 대상을 줄인다
  const BUCKET = 2;
  function indexMap(map) {
    const buckets = [];
    const add = (obj, y0, y1) => {
      const b0 = Math.max(0, Math.floor((y0 + 8) / BUCKET)), b1 = Math.floor((y1 + 8) / BUCKET);
      for (let b = b0; b <= b1; b++) (buckets[b] || (buckets[b] = [])).push(obj);
    };
    map.walls.forEach(w => { w.kind = 0; add(w, Math.min(w.ay, w.by) - 1, Math.max(w.ay, w.by) + 1); });
    map.pegs.forEach(p => { p.kind = 1; add(p, p.y - p.r - 1, p.y + p.r + 1); });
    map.bumpers.forEach(p => { p.kind = 2; add(p, p.y - p.r - 1, p.y + p.r + 1); });
    map.rotors.forEach(r => { r.kind = 3; add(r, r.cy - r.len / 2 - 1, r.cy + r.len / 2 + 1); });
    map.movers.forEach(o => {
      o.kind = 4;
      if (o.type === 'slider') add(o, o.cy - o.len / 2 - 1, o.cy + o.len / 2 + 1);
      else add(o, o.py - o.len - 1, o.py + o.len + 1);
    });
    map.portals.forEach(o => { o.kind = 5; add(o, o.ay - o.r - 1, o.ay + o.r + 1); });
    updateMovers(map, 0);
    map.buckets = buckets;
    return map;
  }

  // 움직이는 장애물의 위치·속도를 시뮬레이션 시각 T로 계산(결정론적)
  function flipAngle(o, T) { return o.base + o.swing * (0.5 + 0.5 * Math.tanh(5 * Math.sin(o.w * T + o.ph))); }
  function updateMovers(map, T) {
    for (const o of map.movers) {
      if (o.type === 'slider') {
        const x = o.cx + o.amp * Math.sin(o.w * T + o.ph);
        o.vx = o.amp * o.w * Math.cos(o.w * T + o.ph);
        const c = Math.cos(o.ang) * o.len / 2, sn = Math.sin(o.ang) * o.len / 2;
        o.ax = x - c; o.ay = o.cy - sn; o.bx = x + c; o.by = o.cy + sn; o.x = x;
      } else {
        const a = flipAngle(o, T);
        o.omega = (flipAngle(o, T + 1e-3) - a) / 1e-3;
        o.angle = a;
        o.ax = o.px; o.ay = o.py; o.bx = o.px + Math.cos(a) * o.len; o.by = o.py + Math.sin(a) * o.len;
      }
    }
  }

  function buildMap(id) {
    const def = MAPS.find(m => m.id === id) || MAPS[0];
    // 맵 모양은 맵 ID로 고정(매번 같은 모양) — 추첨의 무작위성은 구슬 배치 시드가 담당
    let h = 7; for (const c of def.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const m = def.build(mulberry32(h));
    m.id = def.id; m.name = def.name; m.desc = def.desc; m.W = W;
    m.gateY = 0; m.topY = -7;
    return indexMap(m);
  }

  /* ------------------------------------------------------------------ 충돌 */
  function collideSeg(m, ax, ay, bx, by, half, svx, svy, rx, ry, spin) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
    let t = ((m.x - ax) * dx + (m.y - ay) * dy) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = ax + dx * t, py = ay + dy * t;
    let nx = m.x - px, ny = m.y - py, d = Math.hypot(nx, ny);
    const minD = m.r + half;
    if (d >= minD) return 0;
    if (d < 1e-6) { nx = -dy; ny = dx; d = Math.hypot(nx, ny); }
    nx /= d; ny /= d;
    m.x += nx * (minD - d); m.y += ny * (minD - d);
    let sx = svx || 0, sy = svy || 0;
    if (spin) { sx = -(py - ry) * spin; sy = (px - rx) * spin; }
    const rvx = m.vx - sx, rvy = m.vy - sy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const j = -(1 + 0.38) * vn;
      m.vx += j * nx; m.vy += j * ny;
      const tx = -ny, ty = nx, vt = (m.vx - sx) * tx + (m.vy - sy) * ty;
      m.vx -= vt * 0.006 * tx; m.vy -= vt * 0.006 * ty;
      return -vn + 1e-3;
    }
    return 1e-3;
  }
  function collideCircle(m, cx, cy, cr, e, kick) {
    let nx = m.x - cx, ny = m.y - cy, d = Math.hypot(nx, ny);
    const minD = m.r + cr;
    if (d >= minD) return 0;
    if (d < 1e-6) { nx = 0; ny = -1; d = 1; }
    nx /= d; ny /= d;
    m.x += nx * (minD - d); m.y += ny * (minD - d);
    const vn = m.vx * nx + m.vy * ny;
    if (vn < 0) { const j = -(1 + e) * vn; m.vx += j * nx; m.vy += j * ny; }
    if (kick) { m.vx += nx * kick; m.vy += ny * kick; }
    return vn < 0 ? -vn + 1e-3 : 1e-3;
  }

  /* ------------------------------------------------------------------ 레이스 */
  /**
   * @param {object} map buildMap() 결과
   * @param {Array<{pid:number,name:string,color:string,no:number,of:number}>} entries 구슬 목록
   * @param {{seed:number, skills:boolean}} opts
   */
  function Race(map, entries, opts) {
    this.map = map;
    this.seed = opts.seed >>> 0 || 1;
    this.skills = !!opts.skills;
    this.rng = mulberry32(this.seed);
    this.time = 0;            // 출발 이후 경과(초)
    this.state = 'ready';     // ready | running | done
    this.settleLeft = SETTLE_STEPS;
    this.finished = [];       // {m, time}
    this.effects = [];        // 시각 효과(렌더러 전용, 시뮬레이션에 영향 없음)
    this.events = [];         // UI 로그용
    this.nextSkill = 2.5;
    this.clock = 0;          // 장애물 시계(정착 단계 포함, 고정 스텝 수로만 증가)
    this.impacts = [];       // 충돌 기록(효과음·이펙트용, 시뮬레이션에 영향 없음)
    this.timedOut = false;

    const n = entries.length;
    const r = n > 260 ? 0.3 : n > 120 ? 0.34 : 0.4;
    this.radius = r;
    // 출발 상자(y: -6.5 ~ -0.2)에 시드 기반으로 무작위 배치 — 순서도 섞는다
    const order = entries.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const maxCols = Math.max(1, Math.floor((W - 1) / (r * 2.15)));
    const cols = Math.min(maxCols, Math.max(1, n));
    const gap = (W - 1 - 2 * r) / Math.max(1, cols - (cols === maxCols ? 1 : 0));
    this.marbles = order.map((ei, k) => {
      const e = entries[ei];
      const c = k % cols, row = Math.floor(k / cols);
      return Object.assign({}, e, {
        id: ei, r,
        x: cols === maxCols ? 0.5 + r + c * gap : 0.5 + r + (c + 0.5) * gap + (this.rng() - 0.5) * 0.3,
        y: -0.6 - r - row * r * 2.1,
        vx: (this.rng() - 0.5) * 1.5, vy: 0,
        done: false, still: 0, rank: 0, portalCd: 0, roll: 0
      });
    });
    // 시작 상자가 넘치면 위로 쌓이게 맵 상단을 넓힌다
    const rows = Math.ceil(n / cols);
    map.topY = Math.min(-7, -1.5 - rows * r * 2.1);
  }

  Race.prototype.start = function () {
    if (this.state !== 'ready') return false;
    while (this.settleLeft > 0) this.step();   // 정착 스텝을 고정 횟수만큼 채운다
    this.state = 'running';
    this.events.push({ t: 0, type: 'start' });
    return true;
  };

  Race.prototype.active = function () { return this.marbles.filter(m => !m.done); };

  Race.prototype.step = function () {
    const map = this.map;
    if (this.state === 'ready') {
      if (this.settleLeft <= 0) return;   // 정착 완료 후에는 정지 상태 유지
      this.settleLeft--;
    }
    if (this.state === 'done') { this.tickVisual(); return; }
    const running = this.state === 'running';
    const h = STEP / SUB;
    const act = this.active();
    map.rotors.forEach(r => { r.angle += r.speed * STEP; });
    this.clock += STEP;
    updateMovers(map, this.clock);
    const imp = this.impacts, rec = (m, v, kind) => { if (v > 6 && imp.length < 400) imp.push({ x: m.x, y: m.y, v, kind, c: m.color }); };

    for (let s = 0; s < SUB; s++) {
      for (const m of act) {
        if (m.portalCd > 0) m.portalCd -= h;
        m.vy += GRAVITY * h;
        m.vx *= 0.9995; m.vy *= 0.9995;
        const sp = Math.hypot(m.vx, m.vy);
        if (sp > MAX_SPEED) { m.vx *= MAX_SPEED / sp; m.vy *= MAX_SPEED / sp; }
        m.x += m.vx * h; m.y += m.vy * h;
        m.roll += m.vx * h / m.r;
      }
      this.collideMarbles(act);
      for (const m of act) {
        // 좌우 벽
        if (m.x < m.r) { m.x = m.r; if (m.vx < 0) m.vx = -m.vx * 0.4; }
        if (m.x > W - m.r) { m.x = W - m.r; if (m.vx > 0) m.vx = -m.vx * 0.4; }
        if (!running) collideSeg(m, 0, map.gateY, W, map.gateY, 0.12);
        const bi = Math.floor((m.y + 8) / BUCKET), list = map.buckets[bi];
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const o = list[i];
          if (o.kind === 0) rec(m, collideSeg(m, o.ax, o.ay, o.bx, o.by, o.t), 'wall');
          else if (o.kind === 1) rec(m, collideCircle(m, o.x, o.y, o.r, 0.42, 0), 'peg');
          else if (o.kind === 2) { const v = collideCircle(m, o.x, o.y, o.r, 0.7, 2.2 / SUB); if (v) { if (o.hit < 0.5) rec(m, v + 6, 'bumper'); o.hit = 1; } }
          else if (o.kind === 3) {
            const c = Math.cos(o.angle), sn = Math.sin(o.angle), L = o.len / 2;
            rec(m, collideSeg(m, o.cx - c * L, o.cy - sn * L, o.cx + c * L, o.cy + sn * L, o.t, 0, 0, o.cx, o.cy, o.speed), 'rotor');
          } else if (o.kind === 4) {
            const v = o.type === 'slider'
              ? collideSeg(m, o.ax, o.ay, o.bx, o.by, o.t, o.vx, 0)
              : collideSeg(m, o.ax, o.ay, o.bx, o.by, o.t, 0, 0, o.px, o.py, o.omega);
            rec(m, v, o.type);
          } else if (o.kind === 5 && s === 0 && m.portalCd <= 0) {
            if (Math.hypot(m.x - o.ax, m.y - o.ay) < o.r) {
              this.effects.push({ type: 'portal', x: o.ax, y: o.ay, t: 0, color: '#8b5cf6' });
              m.x = o.bx + (m.x - o.ax) * 0.3; m.y = o.by; m.vy = Math.max(m.vy, 3); m.vx *= 0.6; m.portalCd = 1.2;
              this.effects.push({ type: 'portal', x: o.bx, y: o.by, t: 0, color: '#8b5cf6' });
              imp.push({ x: o.bx, y: o.by, v: 20, kind: 'portal', c: m.color });
              if (running) this.events.push({ t: this.time, type: 'portal', m });
              break;
            }
          }
        }
      }
    }
    if (!running) return;

    this.time += STEP;
    // 도착 판정
    for (const m of act) {
      if (m.y > map.goalY + m.r) this.finish(m);
    }
    // 멈춘 구슬 흔들기(무한 대기 방지) — 시드 기반 난수 사용
    for (const m of act) {
      if (m.done) continue;
      const sp = Math.hypot(m.vx, m.vy);
      m.still = sp < 0.35 ? m.still + STEP : 0;
      if (m.still > 1.4) {
        m.vx += (this.rng() - 0.5) * 12; m.vy -= 5 + this.rng() * 4; m.still = 0;
        this.effects.push({ type: 'nudge', x: m.x, y: m.y, t: 0, color: m.color });
      }
    }
    if (this.skills) this.runSkills();
    if (this.time > TIMEOUT) this.forceFinish();
    if (this.finished.length === this.marbles.length) this.state = 'done';
    this.tickVisual();
  };

  Race.prototype.collideMarbles = function (act) {
    // 공간 해시
    const cell = this.radius * 2.2, grid = new Map();
    for (let i = 0; i < act.length; i++) {
      const m = act[i], k = Math.floor(m.x / cell) + Math.floor((m.y + 400) / cell) * 64;
      const a = grid.get(k); if (a) a.push(m); else grid.set(k, [m]);
    }
    for (let i = 0; i < act.length; i++) {
      const a = act[i], cx = Math.floor(a.x / cell), cy = Math.floor((a.y + 400) / cell);
      for (let oy = 0; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        if (oy === 0 && ox < 0) continue;
        const list = grid.get(cx + ox + (cy + oy) * 64); if (!list) continue;
        for (let j = 0; j < list.length; j++) {
          const b = list[j]; if (b === a || (oy === 0 && ox === 0 && b.id <= a.id)) continue;
          let dx = b.x - a.x, dy = b.y - a.y; const minD = a.r + b.r;
          if (dx > minD || dx < -minD || dy > minD || dy < -minD) continue;
          let d = Math.hypot(dx, dy); if (d >= minD) continue;
          if (d < 1e-6) { dx = 1; dy = 0; d = 1; }
          dx /= d; dy /= d;
          const push = (minD - d) / 2;
          a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
          const rv = (b.vx - a.vx) * dx + (b.vy - a.vy) * dy;
          if (rv < 0) { const j2 = -(1 + 0.5) * rv / 2; a.vx -= j2 * dx; a.vy -= j2 * dy; b.vx += j2 * dx; b.vy += j2 * dy; }
        }
      }
    }
  };

  Race.prototype.finish = function (m) {
    if (m.done) return;
    m.done = true; m.rank = this.finished.length + 1; m.finishTime = this.time;
    this.finished.push(m);
    this.events.push({ t: this.time, type: 'finish', m });
    this.effects.push({ type: 'goal', x: m.x, y: this.map.goalY, t: 0, color: m.color });
    this.impacts.push({ x: m.x, y: this.map.goalY, v: 30, kind: 'goal', c: m.color });
  };

  Race.prototype.forceFinish = function () {
    // 제한 시간 초과: 남은 구슬을 더 아래(결승에 가까운) 순서대로 확정
    this.timedOut = true;
    this.active().sort((a, b) => b.y - a.y || a.id - b.id).forEach(m => this.finish(m));
    this.events.push({ t: this.time, type: 'timeout' });
  };

  Race.prototype.runSkills = function () {
    if (this.time < this.nextSkill) return;
    this.nextSkill = this.time + 2.2 + this.rng() * 2.2;
    const act = this.active(); if (!act.length) return;
    const m = act[Math.floor(this.rng() * act.length)];
    if (this.rng() < 0.5) {
      // 부스트: 대상 구슬을 아래 방향으로 밀어 준다
      m.vy += 9 + this.rng() * 5; m.vx += (this.rng() - 0.5) * 6;
      this.effects.push({ type: 'boost', x: m.x, y: m.y, t: 0, color: m.color, m });
      this.impacts.push({ x: m.x, y: m.y, v: 18, kind: 'boost', c: m.color });
      this.events.push({ t: this.time, type: 'skill', skill: '부스트', m });
    } else {
      // 충격파: 주변 구슬을 밀어낸다
      const R = 4;
      for (const o of act) {
        if (o === m) continue;
        const dx = o.x - m.x, dy = o.y - m.y, d = Math.hypot(dx, dy);
        if (d > R || d < 1e-6) continue;
        const f = (1 - d / R) * 14; o.vx += dx / d * f; o.vy += dy / d * f;
      }
      this.effects.push({ type: 'impact', x: m.x, y: m.y, t: 0, color: m.color, R });
      this.impacts.push({ x: m.x, y: m.y, v: 25, kind: 'shock', c: m.color });
      this.events.push({ t: this.time, type: 'skill', skill: '충격파', m });
    }
  };

  Race.prototype.tickVisual = function () {
    for (const e of this.effects) e.t += STEP;
    if (this.effects.length > 60 || (this.effects.length && this.effects[0].t > 1.2)) {
      this.effects = this.effects.filter(e => e.t < 1.2).slice(-60);
    }
    this.map.bumpers.forEach(b => { if (b.hit > 0) b.hit = Math.max(0, b.hit - STEP * 4); });
  };

  window.MR = { W, STEP, MAPS, buildMap, Race, newSeed, mulberry32 };
})();
