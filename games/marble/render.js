/* 마블 룰렛 — Canvas 렌더러
 * CSS 표시 크기와 실제 픽셀 크기를 분리하고 devicePixelRatio를 적용해 고밀도 화면에서도 선명하게 그린다.
 * 도형은 월드 좌표 변환으로, 글자(이름표)는 화면 좌표(CSS px)로 그려 4K에서도 글자 크기가 일정하다. */
(function () {
  'use strict';
  const { W } = window.MR;
  const TAU = Math.PI * 2;

  // 밝은/어두운 테마 팔레트(2D·3D 공용)
  const PALETTES = {
    light: {
      page: '#eef1f7', track: '#ffffff', trackEdge: '#d5dbe7', grid: 'rgba(40,60,110,0.045)',
      wall: '#2a3350', peg: '#8a94ab', pegHi: '#b7bfd0', rotor: '#3b63f6', hub: '#ffffff',
      bumper: '#ff8a3d', bumperFill: '#fff2e8', gate: '#3b63f6', goal: '#121826', checker: '#ffffff',
      label: '#141a2b', labelStroke: 'rgba(255,255,255,0.92)', miniBg: 'rgba(255,255,255,0.92)', miniWall: 'rgba(42,51,80,0.5)',
      bg3d: 0xe9eef7, plate: '#fbfcfe', plateLine: 'rgba(40,60,110,0.07)', plateLine2: 'rgba(40,60,110,0.035)',
      base3d: 0xd9e0ee, wall3d: 0x2a3350, rail3d: 0x232b45, glowOpacity: 0.12,
      wallHi: '#8692b5', wallMid: '#323d60', wallLo: '#121829', wallLine: 'rgba(255,255,255,0.35)', neon: null,
      shadow: 'rgba(20,28,50,0.16)', pegA: '#eef1f7', pegB: '#9ba5bb', pegC: '#59637b', rim: 'rgba(20,26,43,0.35)',
      rotorA: '#7d9bff', rotorB: '#3b63f6', rotorC: '#1d3bb8', stripe: 'rgba(255,255,255,0.22)',
      slideA: '#5fe3d4', slideB: '#10b3a3', slideC: '#08766b', flipA: '#ff9ab8', flipB: '#ff4f86', flipC: '#b81d52',
      rail: 'rgba(16,179,163,0.35)', portalCore: 'rgba(139,92,246,0.18)'
    },
    dark: {
      page: '#07090e', track: '#10141e', trackEdge: '#2a3142', grid: 'rgba(160,180,230,0.05)',
      wall: '#9aa6c4', peg: '#5f6b85', pegHi: '#8f9ab3', rotor: '#5b80ff', hub: '#e8ecf5',
      bumper: '#ff8a3d', bumperFill: '#3a2414', gate: '#5b80ff', goal: '#e8ecf5', checker: '#10141e',
      label: '#f2f4f9', labelStroke: 'rgba(7,9,14,0.9)', miniBg: 'rgba(16,20,30,0.92)', miniWall: 'rgba(170,182,210,0.55)',
      bg3d: 0x07090e, plate: '#121722', plateLine: 'rgba(160,180,230,0.08)', plateLine2: 'rgba(160,180,230,0.04)',
      base3d: 0x0c1018, wall3d: 0x8592b3, rail3d: 0x2c3448, glowOpacity: 0.08,
      wallHi: '#c3cde6', wallMid: '#7d89a8', wallLo: '#3d4660', wallLine: 'rgba(255,255,255,0.45)', neon: 'rgba(90,200,255,0.16)',
      shadow: 'rgba(0,0,0,0.45)', pegA: '#e4e9f5', pegB: '#7c879f', pegC: '#353d50', rim: 'rgba(0,0,0,0.5)',
      rotorA: '#9db4ff', rotorB: '#5b80ff', rotorC: '#2a46b8', stripe: 'rgba(255,255,255,0.18)',
      slideA: '#7ff5e7', slideB: '#19c7b5', slideC: '#0a7f73', flipA: '#ffb0c8', flipB: '#ff5a8f', flipC: '#b81d52',
      rail: 'rgba(25,199,181,0.35)', portalCore: 'rgba(139,92,246,0.28)'
    }
  };
  window.MR.PALETTES = PALETTES;
  if (!window.MR.theme) window.MR.theme = 'dark';
  let C = PALETTES[window.MR.theme];

  /* ---------- 장애물 그리기 도우미(월드 좌표) ---------- */
  // 선분 (ax,ay)-(bx,by)을 반지름 r의 캡슐로 만들고, 로컬 좌표(가로=선분 방향)에서 fn을 실행
  function withSeg(ctx, ax, ay, bx, by, fn) {
    const L = Math.hypot(bx - ax, by - ay);
    ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.atan2(by - ay, bx - ax));
    fn(L); ctx.restore();
  }
  function capsule(ctx, L, r) {
    ctx.beginPath();
    ctx.moveTo(0, -r); ctx.lineTo(L, -r); ctx.arc(L, 0, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(0, r); ctx.arc(0, 0, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath();
  }
  function bodyGrad(ctx, r, a, b, c) {
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, a); g.addColorStop(0.45, b); g.addColorStop(1, c); return g;
  }
  // 그림자 → (네온) → 본체 → 윗면 하이라이트 순서로 입체감 있는 막대를 그린다
  function drawBar(ctx, ax, ay, bx, by, r, cols, opt) {
    opt = opt || {};
    withSeg(ctx, ax + 0.09, ay + 0.15, bx + 0.09, by + 0.15, L => { capsule(ctx, L, r); ctx.fillStyle = C.shadow; ctx.fill(); });
    withSeg(ctx, ax, ay, bx, by, L => {
      if (C.neon || opt.glow) { capsule(ctx, L, r + 0.14); ctx.fillStyle = opt.glow || C.neon; ctx.fill(); }
      capsule(ctx, L, r); ctx.fillStyle = bodyGrad(ctx, r, cols[0], cols[1], cols[2]); ctx.fill();
      if (opt.stripes) {
        ctx.save(); capsule(ctx, L, r); ctx.clip();
        ctx.fillStyle = C.stripe;
        for (let x = -r * 2; x < L + r * 2; x += r * 2.6) {
          ctx.beginPath(); ctx.moveTo(x, -r); ctx.lineTo(x + r * 1.2, -r); ctx.lineTo(x + r * 0.2, r); ctx.lineTo(x - r, r); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
      ctx.strokeStyle = C.wallLine; ctx.lineWidth = r * 0.28; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(r * 0.2, -r * 0.45); ctx.lineTo(L - r * 0.2, -r * 0.45); ctx.stroke();
      if (opt.rivets && L > 1.2) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        [0, L].forEach(x => { ctx.beginPath(); ctx.arc(x, 0, r * 0.38, 0, TAU); ctx.fill(); });
      }
    });
  }
  // 끝이 가늘어지는 플리퍼
  function drawFlipper(ctx, o) {
    const r0 = o.t * 1.5, r1 = o.t * 0.75, L = o.len;
    const shape = () => {
      ctx.beginPath(); ctx.arc(0, 0, r0, Math.PI / 2, Math.PI * 1.5);
      ctx.lineTo(L, -r1); ctx.arc(L, 0, r1, -Math.PI / 2, Math.PI / 2); ctx.closePath();
    };
    ctx.save(); ctx.translate(o.px + 0.09, o.py + 0.15); ctx.rotate(o.angle); shape(); ctx.fillStyle = C.shadow; ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(o.px, o.py); ctx.rotate(o.angle);
    if (Math.abs(o.omega || 0) > 1.5) { ctx.save(); ctx.scale(1.08, 1.6); shape(); ctx.fillStyle = 'rgba(255,90,143,0.22)'; ctx.fill(); ctx.restore(); }
    shape(); ctx.fillStyle = bodyGrad(ctx, r0, C.flipA, C.flipB, C.flipC); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.06; ctx.beginPath(); ctx.moveTo(0, -r0 * 0.5); ctx.lineTo(L, -r1 * 0.5); ctx.stroke();
    ctx.restore();
    bolt(ctx, o.px, o.py, 0.24);
  }
  function bolt(ctx, x, y, r) {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#c9d0de'); g.addColorStop(1, '#6b7590');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(40,48,70,0.7)'; ctx.lineWidth = r * 0.22;
    ctx.beginPath(); ctx.moveTo(x - r * 0.5, y); ctx.lineTo(x + r * 0.5, y); ctx.moveTo(x, y - r * 0.5); ctx.lineTo(x, y + r * 0.5); ctx.stroke();
  }
  function drawPeg(ctx, p) {
    ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.arc(p.x + 0.07, p.y + 0.12, p.r, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.4, p.r * 0.08, p.x, p.y, p.r);
    g.addColorStop(0, C.pegA); g.addColorStop(0.5, C.pegB); g.addColorStop(1, C.pegC);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = C.rim; ctx.lineWidth = 0.035; ctx.stroke();
  }
  function drawBumper(ctx, b, t) {
    const rr = b.r * (1 + b.hit * 0.14);
    // 빛 번짐
    const halo = ctx.createRadialGradient(b.x, b.y, rr * 0.6, b.x, b.y, rr * (1.7 + b.hit * 0.8));
    halo.addColorStop(0, `rgba(255,138,61,${0.35 + b.hit * 0.5})`); halo.addColorStop(1, 'rgba(255,138,61,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(b.x, b.y, rr * (1.7 + b.hit * 0.8), 0, TAU); ctx.fill();
    ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.arc(b.x + 0.09, b.y + 0.15, rr, 0, TAU); ctx.fill();
    // 바깥 고리
    const ring = ctx.createRadialGradient(b.x - rr * 0.3, b.y - rr * 0.3, rr * 0.2, b.x, b.y, rr);
    ring.addColorStop(0, '#ffd2a8'); ring.addColorStop(0.6, '#ff8a3d'); ring.addColorStop(1, '#c2410c');
    ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(b.x, b.y, rr, 0, TAU); ctx.fill();
    // 안쪽 원판 + 별 무늬
    ctx.fillStyle = C.bumperFill; ctx.beginPath(); ctx.arc(b.x, b.y, rr * 0.7, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(t * 0.8);
    ctx.fillStyle = b.hit > 0.2 ? '#ffd166' : '#ff8a3d';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, R = i % 2 ? rr * 0.22 : rr * 0.52; ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
    ctx.closePath(); ctx.fill();
    // 회전하는 점선 테두리
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.05; ctx.setLineDash([0.18, 0.14]);
    ctx.beginPath(); ctx.arc(0, 0, rr * 0.85, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.beginPath(); ctx.arc(b.x - rr * 0.35, b.y - rr * 0.4, rr * 0.13, 0, TAU); ctx.fill();
  }
  function drawRotor(ctx, r) {
    const c = Math.cos(r.angle), sn = Math.sin(r.angle), L = r.len / 2;
    // 잔상: 회전 방향 뒤쪽으로 옅어지는 부채꼴
    const span = Math.min(0.9, Math.abs(r.speed) * 0.14), dir = r.speed > 0 ? -1 : 1;
    [0, Math.PI].forEach(o => {
      const a0 = r.angle + o;
      for (let k = 1; k <= 3; k++) {
        ctx.fillStyle = `rgba(91,128,255,${0.09 / k})`;
        ctx.beginPath(); ctx.moveTo(r.cx, r.cy); ctx.arc(r.cx, r.cy, L + r.t * 0.5, a0, a0 + dir * span * k / 3, dir < 0); ctx.closePath(); ctx.fill();
      }
    });
    drawBar(ctx, r.cx - c * L, r.cy - sn * L, r.cx + c * L, r.cy + sn * L, r.t, r.final ? ['#ffc46b', '#ED911A', '#b35f05'] : [C.rotorA, C.rotorB, C.rotorC], { stripes: true, glow: r.final ? 'rgba(237,145,26,0.28)' : C.neon ? 'rgba(91,128,255,0.18)' : null });
    // 톱니 허브
    ctx.save(); ctx.translate(r.cx, r.cy); ctx.rotate(r.angle);
    ctx.fillStyle = C.rotorC; ctx.beginPath();
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, R = i % 2 ? 0.3 : 0.38; ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
    ctx.closePath(); ctx.fill(); ctx.restore();
    bolt(ctx, r.cx, r.cy, 0.24);
  }
  function drawSlider(ctx, o) {
    // 왕복 범위를 보여주는 레일
    const x0 = o.cx - o.amp - o.len / 2, x1 = o.cx + o.amp + o.len / 2;
    ctx.strokeStyle = C.rail; ctx.lineWidth = 0.08; ctx.setLineDash([0.3, 0.25]);
    ctx.beginPath(); ctx.moveTo(Math.max(0.3, x0), o.cy); ctx.lineTo(Math.min(W - 0.3, x1), o.cy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.rail;
    [Math.max(0.3, x0), Math.min(W - 0.3, x1)].forEach(x => { ctx.beginPath(); ctx.arc(x, o.cy, 0.14, 0, TAU); ctx.fill(); });
    drawBar(ctx, o.ax, o.ay, o.bx, o.by, o.t * 1.1, o.final ? ['#ffc46b', '#ED911A', '#b35f05'] : [C.slideA, C.slideB, C.slideC], { glow: o.final ? 'rgba(237,145,26,0.28)' : C.neon ? 'rgba(25,199,181,0.2)' : null });
    // 진행 방향 화살표
    const d = (o.vx || 0) >= 0 ? 1 : -1, cx = (o.ax + o.bx) / 2, cy = (o.ay + o.by) / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 0.07; ctx.lineJoin = 'round';
    for (let i = -1; i <= 1; i++) {
      const x = cx + i * 0.45;
      ctx.beginPath(); ctx.moveTo(x - d * 0.1, cy - 0.11); ctx.lineTo(x + d * 0.1, cy); ctx.lineTo(x - d * 0.1, cy + 0.11); ctx.stroke();
    }
  }
  function drawPortal(ctx, x, y, r, t, entry) {
    const core = ctx.createRadialGradient(x, y, 0, x, y, r * 1.35);
    core.addColorStop(0, entry ? 'rgba(255,255,255,0.95)' : 'rgba(237,233,254,0.8)');
    core.addColorStop(0.35, entry ? 'rgba(167,139,250,0.85)' : 'rgba(196,181,253,0.55)');
    core.addColorStop(1, 'rgba(124,58,237,0)');
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(x, y, r * 1.35, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(entry ? -t * 2.6 : t * 1.8);
    // 소용돌이 팔
    ctx.strokeStyle = entry ? 'rgba(255,255,255,0.8)' : 'rgba(245,243,255,0.7)'; ctx.lineWidth = 0.07; ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      for (let i = 0; i <= 20; i++) { const u = i / 20, a = k * TAU / 3 + u * 3.2, R = r * (0.15 + 0.8 * u); ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * R, Math.sin(a) * R); }
      ctx.stroke();
    }
    // 바깥 고리와 궤도 점
    ctx.strokeStyle = entry ? '#8b5cf6' : '#c4b5fd'; ctx.lineWidth = 0.12;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#ede9fe';
    for (let i = 0; i < 4; i++) { const a = i * TAU / 4; ctx.beginPath(); ctx.arc(Math.cos(a) * r, Math.sin(a) * r, 0.07, 0, TAU); ctx.fill(); }
    if (!entry) {   // 출구: 바깥으로 향하는 화살표
      ctx.fillStyle = 'rgba(196,181,253,0.9)';
      for (let i = 0; i < 4; i++) {
        const a = i * TAU / 4 + Math.PI / 4;
        ctx.save(); ctx.rotate(a); ctx.beginPath(); ctx.moveTo(r + 0.32, 0); ctx.lineTo(r + 0.12, -0.12); ctx.lineTo(r + 0.12, 0.12); ctx.closePath(); ctx.fill(); ctx.restore();
      }
    }
    ctx.restore();
  }

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cssW = 1; this.cssH = 1; this.dpr = 1;
    this.camY = -8; this.mode = 'follow';  // follow | manual | overview
    this.zoom = 1; this.shake = 0; this.pulse = 0; this.focusMarble = null;   // 결승 연출: 확대·흔들림·심장 박동
    this.reduced = false;
    this.race = null;
    this.highlight = null;  // 당첨 구슬 id 집합
    this.confetti = [];
    this.mini = null;
    this.onResize = null;

    // ResizeObserver 하나만 등록(크기 변경 때 리스너가 중복되지 않음)
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
    // devicePixelRatio 변경(모니터 이동·브라우저 확대)을 감지
    const watchDpr = () => {
      const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      const h = () => { mq.removeEventListener('change', h); this.resize(); watchDpr(); };
      mq.addEventListener('change', h);
    };
    try { watchDpr(); } catch (e) { /* 구형 브라우저 */ }
  }

  Renderer.prototype.resize = function () {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cssW = w; this.cssH = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.computeView();
    if (this.onResize) this.onResize();
  };

  // 화면 크기에 맞춰 축척(1 월드 단위 = scale CSS px)과 맵 좌우 위치를 계산
  Renderer.prototype.computeView = function () {
    const map = this.race && this.race.map;
    const miniW = this.cssW < 520 ? 0 : 64;   // 미니맵 폭(좁은 화면에서는 숨김)
    const avail = this.cssW - miniW - 24;
    if (this.mode === 'overview' && map) {
      const total = map.goalY + 3 - map.topY;
      this.scale = Math.min(avail / (W + 1), (this.cssH - 16) / total);
    } else {
      // 가로를 맵 폭에 맞추되 세로로 최소 26단위는 보이게 제한
      this.scale = Math.max(4, Math.min(avail / (W + 1), this.cssH / 26)) * this.zoom;
    }
    this.offX = miniW + (this.cssW - miniW - W * this.scale) / 2;
    if (this.cssW < 520) this.offX = (this.cssW - W * this.scale) / 2;
    if (this.zoom > 1.001) {   // 확대 중엔 결승을 다투는 구슬을 가로 중앙에 둔다(트랙 바깥은 보이지 않게)
      const f = this.focusMarble, want = this.cssW / 2 - (f ? f.x : W / 2) * this.scale;
      const left = this.cssW < 520 ? 0 : miniW, right = this.cssW - W * this.scale;
      this.offX = right < left ? Math.max(right, Math.min(left, want)) : this.offX;
    }
    this.viewH = this.cssH / this.scale;
  };

  Renderer.prototype.setRace = function (race) {
    this.race = race; this.highlight = null; this.confetti = [];
    this.computeView();
    this.camY = race.map.topY - 0.5;
    if (this.mode === 'manual') this.mode = 'follow';
  };

  Renderer.prototype.setMode = function (mode) { this.mode = mode; this.computeView(); };

  Renderer.prototype.scrollBy = function (dyCss) {
    this.mode = 'manual';
    this.camY += dyCss / this.scale;
    this.clampCam();
  };
  Renderer.prototype.jumpTo = function (worldY) {
    this.mode = 'manual'; this.camY = worldY - this.viewH / 2; this.clampCam();
  };
  Renderer.prototype.clampCam = function () {
    const map = this.race.map;
    this.camY = Math.max(map.topY - 1, Math.min(map.goalY + 3 - this.viewH, this.camY));
  };

  Renderer.prototype.updateCamera = function () {
    const race = this.race, map = race.map;
    if (this.mode === 'overview') { this.camY = map.topY - 0.5; return; }
    if (this.mode === 'manual') return;
    let target;
    const act = race.marbles.filter(m => !m.done);
    if (race.state === 'ready') target = map.topY - 0.5;
    else if (this.focusMarble && !this.focusMarble.done) target = this.focusMarble.y - this.viewH * 0.5;
    else if (act.length) {
      let lead = act[0]; for (const m of act) if (m.y > lead.y) lead = m;
      target = lead.y - this.viewH * 0.42;
    } else target = map.goalY + 3 - this.viewH;
    target = Math.max(map.topY - 1, Math.min(map.goalY + 3 - this.viewH, target));
    this.camY = this.reduced ? target : this.camY + (target - this.camY) * 0.12;
  };

  Renderer.prototype.celebrate = function (winners) {
    this.highlight = new Set(winners.map(m => m.id));
    if (this.reduced) return;
    const colors = winners.map(m => m.color).concat(['#ffc83d', '#3b63f6', '#ff6b8a']);
    for (let i = 0; i < 140; i++) {
      this.confetti.push({
        x: this.cssW / 2 + (Math.random() - 0.5) * 120, y: this.cssH * 0.35,
        vx: (Math.random() - 0.5) * 900, vy: -Math.random() * 700 - 150,
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 12,
        s: 5 + Math.random() * 6, c: colors[i % colors.length], life: 0
      });
    }
  };

  function tt0() { return performance.now() / 1000; }
  Renderer.prototype.viewHBase = function () { return this.cssH / (this.scale / this.zoom); };
  Renderer.prototype.draw = function (dt) {
    const ctx = this.ctx, race = this.race;
    if (!race) return;
    const map = race.map, dpr = this.dpr;
    // 결승 연출: 마지막 한 자리를 다투는 구슬이 결승 구간에 들어오면 확대 + 흔들림
    const focus = this.focusMarble && !this.focusMarble.done && this.mode === 'follow' ? this.focusMarble : null;
    const zt = focus && !this.reduced ? Math.min(1.8, Math.max(1.15, 32 / this.viewHBase())) : 1;
    if (Math.abs(zt - this.zoom) > 0.002) { this.zoom += (zt - this.zoom) * (this.reduced ? 1 : 0.07); this.computeView(); }
    else if (focus && this.zoom > 1.001) this.computeView();   // 가로 추적
    const s = this.scale;
    this.updateCamera();
    this.shake = Math.max(0, (this.shake || 0) - dt * 2.6); this.pulse = Math.max(0, (this.pulse || 0) - dt * 2.2);
    const shx = this.shake ? (Math.random() - 0.5) * this.shake * 0.5 : 0, shy = this.shake ? (Math.random() - 0.5) * this.shake * 0.5 : 0;
    const camY = this.camY + shy, y0 = camY - 2, y1 = camY + this.viewH + 2;

    C = PALETTES[window.MR.theme] || PALETTES.light;
    // 배경
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.page; ctx.fillRect(0, 0, this.cssW, this.cssH);

    // 월드 좌표계
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (this.offX + shx * s), dpr * (-camY * s));
    const top = Math.max(map.topY - 0.5, y0), bot = Math.min(map.goalY + 3, y1);
    // 결승 구간 바닥: 붉은 경고 띠
    if (map.finalY < y1 && map.goalY > y0) {
      const g2 = ctx.createLinearGradient(0, map.finalY, 0, map.goalY);
      g2.addColorStop(0, 'rgba(255,70,70,0)'); g2.addColorStop(1, `rgba(255,70,70,${focus ? 0.16 + 0.1 * this.pulse : 0.07})`);
      ctx.fillStyle = g2; ctx.fillRect(0, Math.max(top, map.finalY), W, Math.min(bot, map.goalY) - Math.max(top, map.finalY));
      ctx.strokeStyle = focus ? 'rgba(255,90,90,0.9)' : 'rgba(255,90,90,0.45)'; ctx.lineWidth = 0.1; ctx.setLineDash([0.6, 0.4]); ctx.lineDashOffset = -tt0() * 2;
      ctx.beginPath(); ctx.moveTo(0, map.finalY); ctx.lineTo(W, map.finalY); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }
    ctx.fillStyle = C.track; ctx.fillRect(0, top, W, bot - top);
    // 은은한 격자
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1 / s;
    ctx.beginPath();
    for (let gy = Math.ceil(top / 2) * 2; gy < bot; gy += 2) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
    for (let gx = 2; gx < W; gx += 2) { ctx.moveTo(gx, top); ctx.lineTo(gx, bot); }
    ctx.stroke();
    // 트랙 테두리(금속 레일)
    const railTop = Math.max(map.topY - 0.5, y0 - 1), railBot = Math.min(map.goalY + 3, y1 + 1);
    drawBar(ctx, 0, railTop, 0, railBot, 0.16, [C.wallHi, C.wallMid, C.wallLo]);
    drawBar(ctx, W, railTop, W, railBot, 0.16, [C.wallHi, C.wallMid, C.wallLo]);
    const tt = performance.now() / 1000;

    // 출발 문
    if (race.state === 'ready') {
      ctx.fillStyle = 'rgba(91,128,255,0.12)'; ctx.fillRect(0, map.gateY - 0.15, W, 0.3);
      ctx.strokeStyle = C.gate; ctx.lineWidth = 0.14; ctx.setLineDash([0.5, 0.3]); ctx.lineDashOffset = -tt * 1.5;
      ctx.beginPath(); ctx.moveTo(0, map.gateY); ctx.lineTo(W, map.gateY); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    }

    // 결승선(체커 무늬 + 빛기둥 + 글자)
    if (map.goalY > y0 && map.goalY - 3 < y1) {
      const gx0 = W / 2 - 1.15, gw = 2.3, sq = gw / 6;
      const beam = ctx.createLinearGradient(0, map.goalY - 3, 0, map.goalY + 3);
      beam.addColorStop(0, 'rgba(255,200,61,0)'); beam.addColorStop(0.5, 'rgba(255,200,61,0.22)'); beam.addColorStop(1, 'rgba(255,200,61,0)');
      ctx.fillStyle = beam; ctx.fillRect(gx0 - 0.4, map.goalY - 3, gw + 0.8, 6);
      for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? C.goal : C.checker;
        ctx.fillRect(gx0 + i * sq, map.goalY + j * sq, sq, sq);
      }
      ctx.fillStyle = 'rgba(255,200,61,0.12)'; ctx.fillRect(0, map.goalY + 0.9, W, 2.1);
      ctx.save(); ctx.translate(W / 2, map.goalY + 1.9); ctx.scale(0.05, 0.05);   // 작은 월드 글꼴 대신 확대 후 축소해 선명하게
      ctx.fillStyle = 'rgba(255,200,61,0.8)'; ctx.font = '800 15px Pretendard, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
      ctx.fillText('FINISH', 0, 0); if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
      ctx.restore();
      // 결승 기둥 불빛
      [gx0, gx0 + gw].forEach(x => {
        const k = 0.5 + 0.5 * Math.sin(tt * 6);
        ctx.fillStyle = `rgba(255,209,102,${0.5 + 0.5 * k})`; ctx.beginPath(); ctx.arc(x, map.goalY - 2.3, 0.2, 0, TAU); ctx.fill();
      });
    }

    // 벽
    for (const w of map.walls) {
      if (Math.max(w.ay, w.by) < y0 || Math.min(w.ay, w.by) > y1) continue;
      drawBar(ctx, w.ax, w.ay, w.bx, w.by, w.t, [C.wallHi, C.wallMid, C.wallLo], { rivets: true });
    }
    // 핀
    for (const p of map.pegs) { if (p.y > y0 && p.y < y1) drawPeg(ctx, p); }
    // 범퍼
    for (const b of map.bumpers) { if (b.y > y0 - 2 && b.y < y1 + 2) drawBumper(ctx, b, tt); }
    // 회전 막대
    for (const r of map.rotors) { if (r.cy + r.len > y0 && r.cy - r.len < y1) drawRotor(ctx, r); }
    // 움직이는 막대·플리퍼
    for (const o of map.movers) {
      if (Math.max(o.ay, o.by) < y0 - 1 || Math.min(o.ay, o.by) > y1 + 1) continue;
      if (o.type === 'slider') drawSlider(ctx, o); else drawFlipper(ctx, o);
    }
    // 포털(입구 → 출구)
    for (const p of map.portals) {
      if (p.ay > y0 - 2 && p.ay < y1 + 2) drawPortal(ctx, p.ax, p.ay, p.r, tt, true);
      if (p.by > y0 - 2 && p.by < y1 + 2) drawPortal(ctx, p.bx, p.by, p.r * 0.75, tt, false);
    }

    // 효과
    for (const e of race.effects) {
      const k = Math.min(1, e.t / (this.reduced ? 1.2 : 0.8));
      if (k >= 1) continue;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = e.color; ctx.lineWidth = 0.12;
      const rad = e.type === 'impact' ? e.R * k : e.type === 'goal' ? 0.6 + k * 2.5 : 0.5 + k * 1.4;
      const ex = e.m && !e.m.done ? e.m.x : e.x, ey = e.m && !e.m.done ? e.m.y : e.y;
      ctx.beginPath(); ctx.arc(ex, ey, rad, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 구슬
    const act = [];
    let lead = null;
    for (const m of race.marbles) {
      if (m.done) continue;
      if (!lead || m.y > lead.y) lead = m;
      if (m.y < y0 || m.y > y1) continue;
      act.push(m);
    }
    ctx.fillStyle = C.shadow;
    for (const m of act) { ctx.beginPath(); ctx.arc(m.x + 0.08, m.y + 0.13, m.r, 0, TAU); ctx.fill(); }
    for (const m of act) {
      const g = ctx.createRadialGradient(m.x - m.r * 0.35, m.y - m.r * 0.4, m.r * 0.1, m.x, m.y, m.r);
      g.addColorStop(0, m.light); g.addColorStop(0.55, m.color); g.addColorStop(1, m.dark);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(20,26,43,0.35)'; ctx.lineWidth = 1.2 / s; ctx.stroke();
    }
    if (race.state === 'running' && lead && lead.y > y0 && lead.y < y1) {
      ctx.strokeStyle = '#ffc83d'; ctx.lineWidth = 2 / s;
      ctx.beginPath(); ctx.arc(lead.x, lead.y, lead.r + 4 / s, 0, TAU); ctx.stroke();
    }

    // 이름표(화면 좌표, CSS px)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const showAll = act.length <= 60 && s >= 10;
    const fs = Math.max(11, Math.min(14, s * 0.42));
    ctx.font = `600 ${fs}px Pretendard, "Noto Sans KR", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineJoin = 'round';
    for (const m of act) {
      if (!showAll && m !== lead) continue;
      const sx = this.offX + m.x * s, sy = (m.y - camY) * s - m.r * s - 3;
      ctx.lineWidth = 3; ctx.strokeStyle = C.labelStroke; ctx.strokeText(m.label, sx, sy);
      ctx.fillStyle = C.label; ctx.fillText(m.label, sx, sy);
    }

    if (focus) this.drawFinale(focus, lead);
    this.drawMinimap(lead);
    this.drawConfetti(dt);
  };

  // 결승 연출 오버레이: 붉은 비네트(심장 박동에 맞춰 짙어짐) + 상단 배너
  Renderer.prototype.drawFinale = function (focus, lead) {
    const ctx = this.ctx, dpr = this.dpr, w = this.cssW, h = this.cssH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(255,40,40,0)'); vg.addColorStop(1, `rgba(255,40,40,${0.22 + 0.3 * this.pulse})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    const map = this.race.map, left = Math.max(0, map.goalY - focus.y), txt = `🔥 마지막 한 자리  ${focus.label}  · 결승까지 ${left.toFixed(1)}m`;
    const fs = Math.max(14, Math.min(22, w / 32)); ctx.font = `800 ${fs}px Pretendard, "Noto Sans KR", system-ui, sans-serif`;
    const tw = ctx.measureText(txt).width + fs * 1.6, bx = (w - tw) / 2, by = h - fs * 2 - 18 - (this.pulse > 0.6 ? (this.pulse - 0.6) * 10 : 0);
    ctx.fillStyle = `rgba(190,20,30,${0.85 + 0.15 * this.pulse})`;
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, tw, fs * 2, fs) : ctx.rect(bx, by, tw, fs * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, w / 2, by + fs);
  };

  Renderer.prototype.drawMinimap = function (lead) {
    const ctx = this.ctx, race = this.race, map = race.map;
    if (this.cssW < 520 || this.mode === 'overview') { this.mini = null; return; }
    const pad = 12, w = 44, total = map.goalY + 3 - map.topY;
    const h = Math.min(this.cssH - pad * 2, w / W * total * 1.0 + 0);
    const k = h / total, kx = w / W, x0 = pad, yTop = pad;
    this.mini = { x: x0, y: yTop, w, h, k, top: map.topY };
    ctx.fillStyle = C.miniBg; ctx.fillRect(x0 - 4, yTop - 4, w + 8, h + 8);
    ctx.strokeStyle = C.trackEdge; ctx.lineWidth = 1; ctx.strokeRect(x0 - 3.5, yTop - 3.5, w + 7, h + 7);
    ctx.strokeStyle = C.miniWall; ctx.lineWidth = 1; ctx.beginPath();
    for (const wl of map.walls) {
      ctx.moveTo(x0 + wl.ax * kx, yTop + (wl.ay - map.topY) * k);
      ctx.lineTo(x0 + wl.bx * kx, yTop + (wl.by - map.topY) * k);
    }
    ctx.stroke();
    // 현재 보이는 범위
    ctx.fillStyle = 'rgba(59,99,246,0.12)'; ctx.strokeStyle = 'rgba(59,99,246,0.8)';
    const vy = yTop + (this.camY - map.topY) * k, vh = this.viewH * k;
    ctx.fillRect(x0, vy, w, vh); ctx.strokeRect(x0 + 0.5, vy + 0.5, w - 1, vh - 1);
    for (const m of race.marbles) {
      if (m.done) continue;
      ctx.fillStyle = m.color;
      ctx.fillRect(x0 + m.x * kx - 1.5, yTop + (m.y - map.topY) * k - 1.5, 3, 3);
    }
    ctx.fillStyle = C.goal; ctx.fillRect(x0, yTop + (map.goalY - map.topY) * k, w, 2);
  };

  Renderer.prototype.miniHit = function (x, y) {
    const m = this.mini; if (!m) return null;
    if (x < m.x - 4 || x > m.x + m.w + 4 || y < m.y - 4 || y > m.y + m.h + 4) return null;
    return m.top + (y - m.y) / m.k;
  };

  Renderer.prototype.drawConfetti = function (dt) {
    if (!this.confetti.length) return;
    const ctx = this.ctx;
    for (const p of this.confetti) {
      p.life += dt; p.vy += 900 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - p.life / 3);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    this.confetti = this.confetti.filter(p => p.life < 3 && p.y < this.cssH + 40);
  };

  window.MR.Renderer = Renderer;
})();
