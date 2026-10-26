/* 마블 룰렛 — Three.js 3D 렌더러
 * 물리는 engine.js의 2D 시뮬레이션을 그대로 쓰고, 그 결과를 입체 장면으로 그린다(결과와 화면이 항상 일치).
 * 좌표 변환: 3D X = 월드 x - W/2, 3D Y = -월드 y, 뒤판 표면 z = 0, 구슬 중심 z = 반지름.
 * 글자(이름표)·미니맵·색종이는 위에 겹친 2D 캔버스에 CSS px 기준으로 그린다. */
(function () {
  'use strict';
  const T = window.THREE;
  if (T && T.ColorManagement) T.ColorManagement.legacyMode = false;   // 색상 값을 sRGB로 해석(물 빠진 색 방지)
  const { W } = window.MR;
  const TAU = Math.PI * 2;
  const DEPTH = 1.1;          // 벽 두께(z)
  const FOV = 38;

  const X = x => x - W / 2;
  const Y = y => -y;

  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new T.CanvasTexture(c); t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    return t;
  }

  // 반짝이는 구슬을 위한 간단한 환경맵(밝은 스튜디오 느낌)
  function makeEnv(renderer) {
    const s = new T.Scene();
    const geo = new T.SphereGeometry(10, 32, 16);
    const mat = new T.MeshBasicMaterial({ side: T.BackSide, vertexColors: true });
    const col = [], pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 10, k = 0.55 + 0.45 * Math.max(0, y);
      col.push(0.80 * k + 0.1, 0.85 * k + 0.1, 0.95 * k + 0.08);
    }
    geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    s.add(new T.Mesh(geo, mat));
    const panel = (x, y, z, w, h, c) => {
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: c, side: T.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
    };
    panel(-5, 6, 4, 6, 3, 0xffffff); panel(6, 4, 5, 4, 4, 0xfff3dc); panel(0, -2, -8, 10, 3, 0xdfe8ff);
    const pm = new T.PMREMGenerator(renderer);
    const tex = pm.fromScene(s, 0.02).texture;
    pm.dispose();
    return tex;
  }

  /* ------------------------------------------------------------------ 입체 도형 도우미 */
  // 둥근 끝을 가진 캡슐(가운데 정렬, 길이 L, 반지름 r)을 두께 depth로 돌출
  function capsuleGeo(L, r, depth, bevel) {
    const sh = new T.Shape(), h = L / 2;
    sh.moveTo(-h, -r); sh.lineTo(h, -r); sh.absarc(h, 0, r, -Math.PI / 2, Math.PI / 2, false);
    sh.lineTo(-h, r); sh.absarc(-h, 0, r, Math.PI / 2, Math.PI * 1.5, false);
    const b = bevel == null ? Math.min(0.05, r * 0.3) : bevel;
    const g = new T.ExtrudeGeometry(sh, { depth: depth - b * 2, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b * 0.8, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, b);
    return g;
  }
  // 축에서 끝으로 갈수록 가늘어지는 플리퍼 모양
  function flipperGeo(L, r0, r1, depth) {
    const sh = new T.Shape();
    sh.absarc(0, 0, r0, Math.PI / 2, Math.PI * 1.5, false);
    sh.lineTo(L, -r1); sh.absarc(L, 0, r1, -Math.PI / 2, Math.PI / 2, false); sh.lineTo(0, r0);
    const g = new T.ExtrudeGeometry(sh, { depth: depth - 0.08, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 12 });
    g.translate(0, 0, 0.04); return g;
  }
  function starGeo(R, r, n, depth) {
    const sh = new T.Shape();
    for (let i = 0; i < n * 2; i++) { const a = i * Math.PI / n - Math.PI / 2, rr = i % 2 ? r : R; i ? sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    return new T.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
  }
  function gearGeo(R, r, n, depth) {
    const sh = new T.Shape();
    for (let i = 0; i < n * 2; i++) { const a = i * Math.PI / n, rr = i % 2 ? r : R; i ? sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    return new T.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
  }

  /* ------------------------------------------------------------------ 파티클(불꽃·잔상) */
  function Particles(cap) {
    this.cap = cap; this.n = 0;
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 3);
    this.alpha = new Float32Array(cap); this.size = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3); this.life = new Float32Array(cap); this.max = new Float32Array(cap);
    this.base = new Float32Array(cap); this.grav = new Float32Array(cap);
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('color', new T.BufferAttribute(this.col, 3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('alpha', new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage));
    g.setAttribute('psize', new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage));
    this.geo = g;
    this.mat = new T.ShaderMaterial({
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float alpha; attribute float psize; attribute vec3 color; varying float vA; varying vec3 vC; uniform float scale;
        void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = psize * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); if (d > 0.5) discard; float k = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * (0.6 + 0.8 * k), vA * k); }`,
      transparent: true, depthWrite: false, blending: T.AdditiveBlending
    });
    this.points = new T.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }
  Particles.prototype.spawn = function (x, y, z, vx, vy, vz, life, size, color, grav) {
    if (this.n >= this.cap) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.life[i] = life; this.max[i] = life; this.base[i] = size; this.grav[i] = grav || 0;
  };
  Particles.prototype.update = function (dt) {
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i] - dt;
      if (l <= 0) continue;
      if (j !== i) {
        for (let k = 0; k < 3; k++) { this.pos[j * 3 + k] = this.pos[i * 3 + k]; this.vel[j * 3 + k] = this.vel[i * 3 + k]; this.col[j * 3 + k] = this.col[i * 3 + k]; }
        this.max[j] = this.max[i]; this.base[j] = this.base[i]; this.grav[j] = this.grav[i];
      }
      this.life[j] = l;
      this.vel[j * 3 + 1] -= this.grav[j] * dt;
      this.pos[j * 3] += this.vel[j * 3] * dt; this.pos[j * 3 + 1] += this.vel[j * 3 + 1] * dt; this.pos[j * 3 + 2] += this.vel[j * 3 + 2] * dt;
      const k = l / this.max[j];
      this.alpha[j] = k; this.size[j] = this.base[j] * (0.4 + 0.6 * k);
      j++;
    }
    this.n = j;
    this.geo.setDrawRange(0, j);
    ['position', 'color', 'alpha', 'psize'].forEach(a => { this.geo.attributes[a].needsUpdate = true; });
  };

  /* ------------------------------------------------------------------ 렌더러 */
  function Renderer3D(glCanvas, overlay) {
    this.canvas = glCanvas; this.overlay = overlay;
    this.gl = new T.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.outputEncoding = T.sRGBEncoding;
    this.gl.toneMapping = T.NoToneMapping;
    this.gl.shadowMap.enabled = true; this.gl.shadowMap.type = T.PCFSoftShadowMap;
    this.ctx = overlay.getContext('2d');

    const scene = this.scene = new T.Scene();
    scene.background = new T.Color(0xe9eef7);
    scene.fog = new T.Fog(0xe9eef7, 60, 150);
    this.pal = window.MR.PALETTES.light;
    this.env = makeEnv(this.gl);   // 구슬·핀에만 반사광 적용

    this.camera = new T.PerspectiveCamera(FOV, 1, 0.5, 400);
    scene.add(new T.HemisphereLight(0xffffff, 0xaab4cc, 0.6));
    const sun = this.sun = new T.DirectionalLight(0xffffff, 1.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
    scene.add(sun); scene.add(sun.target);

    this.particles = new Particles(2400);
    scene.add(this.particles.points);

    this.cssW = 1; this.cssH = 1; this.dpr = 1;
    this.mode = 'follow'; this.reduced = false;
    this.race = null; this.group = null;
    this.focusMarble = null;
    this.cam = { x: 0, y: 0, dist: 30, tilt: 0.3 };
    this.camY = 0; this.viewH = 20;
    this.shake = 0; this.time = 0;
    this.confetti = []; this.highlight = null; this.mini = null;
    this.tmpM = new T.Matrix4(); this.tmpQ = new T.Quaternion(); this.tmpV = new T.Vector3(); this.tmpS = new T.Vector3();
    this.axisZ = new T.Vector3(0, 0, 1);
    this.colorCache = new Map();

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(glCanvas);
    this.resize();
  }

  Renderer3D.prototype.resize = function () {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.cssW = w; this.cssH = h;
    const dpr = window.devicePixelRatio || 1;
    this.gl.setPixelRatio(Math.min(dpr, 2));               // WebGL은 성능을 위해 최대 2배
    this.gl.setSize(w, h, false);
    this.dpr = Math.min(dpr, 3);                            // 글자 오버레이는 최대 3배
    this.overlay.width = Math.round(w * this.dpr); this.overlay.height = Math.round(h * this.dpr);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.particles.mat.uniforms.scale.value = h * Math.min(dpr, 2) / (2 * Math.tan(FOV * Math.PI / 360));
  };

  Renderer3D.prototype.color = function (m) {
    let c = this.colorCache.get(m.id);
    if (!c) {
      c = m.h != null ? new T.Color().setHSL(m.h / 360, m.s, m.l) : new T.Color(0x3b63f6);
      this.colorCache.set(m.id, c);
    }
    return c;
  };

  /* ---------------- 장면 구성 */
  Renderer3D.prototype.setRace = function (race) {
    this.race = race; this.highlight = null; this.confetti = []; this.focusMarble = null;
    this.colorCache.clear(); this.particles.n = 0;
    if (this.group) { this.scene.remove(this.group); this.dispose(this.group); }
    const map = race.map, g = this.group = new T.Group();
    const pal = this.pal = window.MR.PALETTES[window.MR.theme] || window.MR.PALETTES.light;
    this.scene.background.setHex(pal.bg3d); this.scene.fog.color.setHex(pal.bg3d);
    this.scene.add(g);
    const H0 = map.topY - 1, H1 = map.goalY + 6, len = H1 - H0;

    // 뒤판(격자 무늬)
    const grid = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = pal.plate; c.fillRect(0, 0, w, h);
      c.strokeStyle = pal.plateLine; c.lineWidth = 2;
      c.strokeRect(0, 0, w, h);
      c.strokeStyle = pal.plateLine2; c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
    });
    grid.wrapS = grid.wrapT = T.RepeatWrapping; grid.repeat.set(W / 4, len / 4);
    const back = new T.Mesh(new T.PlaneGeometry(W, len), new T.MeshStandardMaterial({ map: grid, roughness: 0.92 }));
    back.position.set(0, Y(H0 + len / 2), 0); back.receiveShadow = true; g.add(back);
    // 바깥 받침(입체감)
    const base = new T.Mesh(new T.BoxGeometry(W + 3, len + 2, 0.8), new T.MeshStandardMaterial({ color: pal.base3d, roughness: 0.8 }));
    base.position.set(0, Y(H0 + len / 2), -0.42); base.receiveShadow = true; g.add(base);

    const wallMat = new T.MeshStandardMaterial({ color: pal.wall3d, roughness: 0.45, metalness: 0.15 });
    const dark = window.MR.theme === 'dark';
    const neonMat = new T.MeshBasicMaterial({ color: 0x6fd3ff, transparent: true, opacity: 0.85 });
    const addBar = (ax, ay, bx, by, t, mat, depth) => {
      const L = Math.hypot(bx - ax, by - ay);
      const m = new T.Mesh(capsuleGeo(L, t, depth || DEPTH), mat);
      m.position.set(X((ax + bx) / 2), Y((ay + by) / 2), 0);
      m.rotation.z = -Math.atan2(by - ay, bx - ax);
      m.castShadow = true; m.receiveShadow = true; g.add(m);
      if (dark && L > 0.6) {   // 어두운 테마: 윗면 가장자리 네온 줄
        const e = new T.Mesh(new T.BoxGeometry(L, t * 0.35, 0.03), neonMat);
        e.position.set(0, t * 0.45, (depth || DEPTH) + 0.005); m.add(e);
      }
      return m;
    };
    // 좌우 레일
    const railMat = new T.MeshStandardMaterial({ color: pal.rail3d, roughness: 0.4, metalness: 0.2 });
    [-0.3, W + 0.3].forEach(x => {
      const m = new T.Mesh(new T.BoxGeometry(0.6, len, DEPTH + 0.5), railMat);
      m.position.set(X(x), Y(H0 + len / 2), (DEPTH + 0.5) / 2 - 0.1); m.castShadow = true; m.receiveShadow = true; g.add(m);
    });
    map.walls.forEach(w => addBar(w.ax, w.ay, w.bx, w.by, w.t, wallMat));

    // 핀(인스턴스)
    if (map.pegs.length) {
      const pg = new T.CylinderGeometry(1, 1, 0.9, 18); pg.rotateX(Math.PI / 2); pg.translate(0, 0, 0.45);
      const pm = new T.MeshStandardMaterial({ color: 0xb4bccc, roughness: 0.22, metalness: 0.8, envMap: this.env, envMapIntensity: 0.9 });
      const im = new T.InstancedMesh(pg, pm, map.pegs.length);
      map.pegs.forEach((p, i) => {
        this.tmpM.compose(this.tmpV.set(X(p.x), Y(p.y), 0), this.tmpQ.identity(), this.tmpS.set(p.r, p.r, 1));
        im.setMatrixAt(i, this.tmpM);
      });
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; g.add(im);
    }
    // 범퍼
    this.bumpers = map.bumpers.map(b => {
      const grp = new T.Group();
      const body = new T.Mesh(new T.CylinderGeometry(b.r, b.r, 0.8, 32).rotateX(Math.PI / 2), new T.MeshStandardMaterial({ color: 0xfff1e6, roughness: 0.35 }));
      body.position.z = 0.4;
      const ring = new T.Mesh(new T.TorusGeometry(b.r * 0.92, 0.12, 12, 40), new T.MeshStandardMaterial({ color: 0xff7a2e, emissive: 0xff5a00, emissiveIntensity: 0.25, roughness: 0.3 }));
      ring.position.z = 0.85;
      const star = new T.Mesh(starGeo(b.r * 0.55, b.r * 0.24, 5, 0.18), new T.MeshStandardMaterial({ color: 0xffb347, emissive: 0xff7a00, emissiveIntensity: 0.45, roughness: 0.3 }));
      star.position.z = 0.8;
      const halo = new T.Mesh(new T.RingGeometry(b.r * 1.0, b.r * 1.7, 40), new T.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.25, depthWrite: false, blending: T.AdditiveBlending }));
      halo.position.z = 0.05;
      [body, ring, star].forEach(m => { m.castShadow = true; grp.add(m); });
      grp.add(halo);
      grp.position.set(X(b.x), Y(b.y), 0); g.add(grp);
      return { b, grp, ring, star, halo };
    });
    // 회전 막대
    const stripeTex = canvasTex(64, 64, (c, w) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, w);
      c.fillStyle = '#b9c6ff';
      for (let i = -1; i < 3; i++) { c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32 + 16, 0); c.lineTo(i * 32 + 16 + 64, 64); c.lineTo(i * 32 + 64, 64); c.closePath(); c.fill(); }
    });
    stripeTex.wrapS = stripeTex.wrapT = T.RepeatWrapping; stripeTex.repeat.set(1.6, 1.6);
    const rotMat = new T.MeshStandardMaterial({ color: 0x4f74ff, map: stripeTex, roughness: 0.3, metalness: 0.3, emissive: 0x1a2a80, emissiveIntensity: dark ? 0.5 : 0.1 });
    const hubMat = new T.MeshStandardMaterial({ color: 0xe8ecf5, roughness: 0.25, metalness: 0.6, envMap: this.env });
    const gearMat = new T.MeshStandardMaterial({ color: 0x2a46b8, roughness: 0.35, metalness: 0.4 });
    const finalMat = new T.MeshStandardMaterial({ color: 0xff9a2e, map: stripeTex, roughness: 0.3, metalness: 0.3, emissive: 0x8a4a00, emissiveIntensity: dark ? 0.6 : 0.15 });
    this.rotors = map.rotors.map(r => {
      const grp = new T.Group();
      const bar = new T.Mesh(capsuleGeo(r.len - r.t * 2, r.t, 0.9), r.final ? finalMat : rotMat); bar.castShadow = true;
      const gear = new T.Mesh(gearGeo(0.42, 0.33, 8, 1.0), gearMat); gear.castShadow = true;
      const hub = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 1.2, 20).rotateX(Math.PI / 2), hubMat); hub.position.z = 0.6; hub.castShadow = true;
      grp.add(bar, gear, hub); grp.position.set(X(r.cx), Y(r.cy), 0); g.add(grp);
      return { r, grp };
    });
    // 움직이는 장애물
    const sliderMat = new T.MeshStandardMaterial({ color: 0x10b3a3, emissive: 0x0a7f73, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.3 });
    const flipMat = new T.MeshStandardMaterial({ color: 0xff4f86, emissive: 0xc0154b, emissiveIntensity: 0.2, roughness: 0.3, metalness: 0.25 });
    this.movers = map.movers.map(o => {
      if (o.type === 'slider') {
        const m = new T.Mesh(capsuleGeo(o.len, o.t * 1.1, 0.95), sliderMat);
        m.castShadow = true; g.add(m);
        // 왕복 범위 레일과 끝 멈춤쇠
        const x0 = Math.max(0.3, o.cx - o.amp - o.len / 2), x1 = Math.min(W - 0.3, o.cx + o.amp + o.len / 2);
        const rail = new T.Mesh(new T.BoxGeometry(x1 - x0, 0.06, 0.04), new T.MeshBasicMaterial({ color: 0x19c7b5, transparent: true, opacity: 0.55 }));
        rail.position.set(X((x0 + x1) / 2), Y(o.cy), 0.03); g.add(rail);
        [x0, x1].forEach(x => { const st = new T.Mesh(new T.CylinderGeometry(0.14, 0.14, 0.3, 14).rotateX(Math.PI / 2), sliderMat); st.position.set(X(x), Y(o.cy), 0.15); g.add(st); });
        return { o, m };
      }
      const m = new T.Mesh(flipperGeo(o.len, o.t * 1.5, o.t * 0.75, 0.95), flipMat); m.castShadow = true;
      m.position.set(X(o.px), Y(o.py), 0); g.add(m);
      const pin = new T.Mesh(new T.CylinderGeometry(0.3, 0.3, 1.15, 20).rotateX(Math.PI / 2), hubMat);
      pin.position.set(X(o.px), Y(o.py), 0.58); g.add(pin);
      return { o, m };
    });
    // 포털
    const swirl = canvasTex(128, 128, (c, w) => {
      const gr = c.createRadialGradient(w / 2, w / 2, 2, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(190,150,255,0.9)'); gr.addColorStop(1, 'rgba(110,60,240,0)');
      c.fillStyle = gr; c.fillRect(0, 0, w, w);
      c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 3;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(w / 2, w / 2, 14 + i * 14, i, i + 2.2); c.stroke(); }
    });
    const ringMat = new T.MeshStandardMaterial({ color: 0x8b5cf6, emissive: 0x7c3aed, emissiveIntensity: 0.9, roughness: 0.2 });
    const exitMat = new T.MeshStandardMaterial({ color: 0xc4b5fd, emissive: 0x8b5cf6, emissiveIntensity: 0.5, roughness: 0.3 });
    this.portals = [];
    map.portals.forEach(p => {
      [[p.ax, p.ay, ringMat, p.r], [p.bx, p.by, exitMat, p.r * 0.75]].forEach(([x, y, mat, r]) => {
        const ring = new T.Mesh(new T.TorusGeometry(r, 0.1, 12, 48), mat); ring.position.set(X(x), Y(y), 0.5);
        const disc = new T.Mesh(new T.CircleGeometry(r, 40), new T.MeshBasicMaterial({ map: swirl, transparent: true, depthWrite: false, blending: T.AdditiveBlending }));
        disc.position.set(X(x), Y(y), 0.05);
        g.add(ring, disc); this.portals.push({ ring, disc, entry: mat === ringMat });
      });
    });
    // 출발 문
    this.gate = new T.Mesh(new T.BoxGeometry(W, 0.24, 0.9), new T.MeshStandardMaterial({ color: 0x3b63f6, transparent: true, opacity: 0.55, roughness: 0.2 }));
    this.gate.position.set(0, Y(map.gateY), 0.45); g.add(this.gate);
    this.gateOpen = 0;
    // 결승선(체커 무늬) + 도착 트레이
    const checker = canvasTex(128, 32, (c, w, h) => {
      for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? '#141a2b' : '#ffffff'; c.fillRect(i * 16, j * 16, 16, 16); }
    });
    const goal = new T.Mesh(new T.PlaneGeometry(2.3, 0.6), new T.MeshBasicMaterial({ map: checker }));
    goal.position.set(X(W / 2), Y(map.goalY + 0.3), 0.02); g.add(goal);
    const glow = new T.Mesh(new T.PlaneGeometry(W, 5.2), new T.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: pal.glowOpacity, depthWrite: false }));
    glow.position.set(0, Y(map.goalY + 3.2), 0.01); g.add(glow);
    const archMat = new T.MeshStandardMaterial({ color: 0xffc83d, emissive: 0xffa800, emissiveIntensity: 0.6, roughness: 0.3 });
    this.arch = new T.Mesh(new T.TorusGeometry(1.6, 0.13, 12, 40, Math.PI), archMat);
    this.arch.position.set(X(W / 2), Y(map.goalY + 0.6), 0.6); this.arch.rotation.z = Math.PI; g.add(this.arch);

    // 구슬
    const n = Math.max(1, race.marbles.length);
    const stripes = canvasTex(256, 128, (c, w, h) => {
      c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#c9c9c9'; c.fillRect(0, h * 0.44, w, h * 0.12);
      c.fillStyle = '#e4e4e4'; c.fillRect(w * 0.23, 0, w * 0.06, h); c.fillRect(w * 0.73, 0, w * 0.06, h);
    });
    const mg = new T.SphereGeometry(1, 32, 20);
    const mm = new T.MeshPhysicalMaterial({ map: stripes, roughness: 0.25, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.05, envMap: this.env, envMapIntensity: 0.8 });
    const marbles = this.marbles = new T.InstancedMesh(mg, mm, n);
    marbles.castShadow = true; marbles.receiveShadow = false; marbles.frustumCulled = false;
    marbles.instanceMatrix.setUsage(T.DynamicDrawUsage);
    race.marbles.forEach((m, i) => marbles.setColorAt(i, this.color(m)));
    if (!race.marbles.length) { this.tmpM.makeScale(0, 0, 0); marbles.setMatrixAt(0, this.tmpM); marbles.setColorAt(0, new T.Color(1, 1, 1)); }
    if (marbles.instanceColor) marbles.instanceColor.needsUpdate = true;
    g.add(marbles);
    // 당첨·선두 표시 고리
    const haloMat = new T.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.9, depthWrite: false });
    this.halos = [];
    for (let i = 0; i < 12; i++) {
      const h = new T.Mesh(new T.TorusGeometry(1, 0.07, 8, 40), haloMat); h.visible = false; g.add(h); this.halos.push(h);
    }

    this.cam.x = 0; this.cam.y = map.topY + 6; this.cam.dist = 30;
    if (this.mode === 'manual') this.mode = 'follow';
    this.time = 0; this.shake = 0;
  };

  Renderer3D.prototype.dispose = function (obj) {
    const seen = new Set();
    obj.traverse(o => {
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      mats.forEach(m => { if (seen.has(m)) return; seen.add(m); if (m.map) m.map.dispose(); m.dispose(); });
    });
  };

  /* ---------------- 카메라 */
  Renderer3D.prototype.setMode = function (mode) { this.mode = mode; };
  Renderer3D.prototype.scrollBy = function (dyCss) {
    this.mode = 'manual'; this.cam.y += dyCss * this.viewH / this.cssH; this.clampCam();
  };
  Renderer3D.prototype.jumpTo = function (worldY) { this.mode = 'manual'; this.cam.y = worldY; this.clampCam(); };
  Renderer3D.prototype.clampCam = function () {
    const map = this.race.map;
    this.cam.y = Math.max(map.topY + 2, Math.min(map.goalY + 1, this.cam.y));
  };

  Renderer3D.prototype.updateCamera = function (dt, lead) {
    const race = this.race, map = race.map, cam = this.cam;
    const vt = Math.tan(FOV * Math.PI / 360), aspect = this.cssW / this.cssH;
    const narrow = aspect < 0.9;
    const fitW = (narrow ? W + 0.6 : W + 3) / 2 / (vt * aspect);
    let tx = W / 2, ty, dist = Math.max(14, Math.min(60, fitW)), tilt = 0.26;
    if (this.mode === 'overview') {
      const total = map.goalY + 6 - map.topY;
      dist = Math.max(fitW, total / 2 / vt * 1.04); ty = (map.topY + map.goalY + 6) / 2; tilt = 0.02;
    } else if (this.focusMarble && !this.focusMarble.done && this.mode !== 'manual') {
      const f = this.focusMarble;
      ty = f.y + 1.5; tx = W / 2 + (f.x - W / 2) * 0.6; dist = Math.max(10, dist * 0.5); tilt = 0.32;
    } else if (this.mode === 'manual') {
      ty = cam.y;
    } else if (race.state === 'ready' || !lead) {
      ty = race.state === 'ready' ? map.topY + dist * vt * 0.95 : map.goalY - 2;
    } else {
      const ahead = Math.max(-1, Math.min(4, lead.vy * 0.12));
      ty = lead.y + ahead; tx = W / 2 + (lead.x - W / 2) * (narrow ? 0.08 : 0.3);
    }
    const k = this.reduced ? 1 : 1 - Math.exp(-dt * (this.focusMarble ? 3 : 4));
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.dist += (dist - cam.dist) * k; cam.tilt += (tilt - cam.tilt) * k;
    this.viewH = 2 * cam.dist * vt;
    this.camY = cam.y - this.viewH / 2;

    const sway = this.reduced ? 0 : Math.sin(this.time * 0.35) * (narrow ? 0.15 : 0.6);
    let sx = 0, sy = 0;
    if (this.shake > 0.001 && !this.reduced) { sx = (Math.random() - 0.5) * this.shake; sy = (Math.random() - 0.5) * this.shake; }
    this.shake *= Math.exp(-dt * 7);
    const c = this.camera;
    c.position.set(X(cam.x) + sway * 0.6 + sx, Y(cam.y) + cam.dist * Math.sin(cam.tilt) + sy, cam.dist * Math.cos(cam.tilt) + 1);
    c.lookAt(X(cam.x) + sx * 0.3, Y(cam.y) + sy * 0.3, 0.4);

    // 그림자 범위를 보이는 영역에 맞춘다
    const s = this.sun, half = Math.max(W, this.viewH) * 0.7;
    s.position.set(X(cam.x) - 8, Y(cam.y) + 12, 22); s.target.position.set(X(cam.x), Y(cam.y), 0); s.target.updateMatrixWorld();
    const sc = s.shadow.camera;
    if (Math.abs(sc.right - half) > 0.5) { sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.updateProjectionMatrix(); }
  };

  /* ---------------- 효과 */
  Renderer3D.prototype.onImpacts = function (list) {
    if (this.reduced) { list.length = 0; return; }
    const P = this.particles, y0 = this.camY - 4, y1 = this.camY + this.viewH + 4;
    let budget = 260;
    for (const im of list) {
      if (im.y < y0 || im.y > y1) continue;
      const big = im.kind === 'bumper' || im.kind === 'portal' || im.kind === 'goal' || im.kind === 'shock' || im.kind === 'boost';
      const cnt = big ? (im.kind === 'goal' || im.kind === 'shock' ? 26 : 16) : Math.min(5, Math.floor(im.v / 6));
      const col = im.kind === 'bumper' ? new T.Color(0xffa040) : im.kind === 'portal' ? new T.Color(0xa78bfa)
        : im.kind === 'goal' ? new T.Color(0xffd34d) : new T.Color().setStyle(this.styleColor(im.c));
      for (let i = 0; i < cnt && budget > 0; i++, budget--) {
        const a = Math.random() * TAU, sp = (big ? 6 : 3) * (0.4 + Math.random()) * Math.min(2, im.v / 12);
        P.spawn(X(im.x), Y(im.y), 0.5 + Math.random() * 0.5, Math.cos(a) * sp, Math.sin(a) * sp, Math.random() * 3, big ? 0.6 : 0.35, big ? 0.55 : 0.32, col, 10);
      }
      if (big) this.shake = Math.min(0.7, this.shake + (im.kind === 'shock' ? 0.45 : im.kind === 'goal' ? 0.25 : 0.18));
    }
    list.length = 0;
  };
  // 'hsl(h s% l%)' → 'hsl(h, s%, l%)' (구형 파서 호환)
  Renderer3D.prototype.styleColor = function (c) { return String(c || '#ffffff').replace(/hsl\(([\d.]+)\s+([\d.]+%)\s+([\d.]+%)\)/, 'hsl($1, $2, $3)'); };

  Renderer3D.prototype.celebrate = function (winners) {
    this.highlight = winners.map(m => m);
    if (this.reduced) return;
    const colors = winners.map(m => m.color).concat(['#ffc83d', '#3b63f6', '#ff6b8a', '#10b3a3']);
    for (let i = 0; i < 180; i++) {
      this.confetti.push({
        x: this.cssW / 2 + (Math.random() - 0.5) * 160, y: this.cssH * 0.4,
        vx: (Math.random() - 0.5) * 1000, vy: -Math.random() * 800 - 150,
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 12, s: 5 + Math.random() * 7, c: colors[i % colors.length], life: 0
      });
    }
    this.shake = 0.6;
  };

  /* ---------------- 그리기 */
  Renderer3D.prototype.draw = function (dt) {
    const race = this.race; if (!race) return;
    this.time += dt;
    const map = race.map;
    let lead = null;
    for (const m of race.marbles) if (!m.done && (!lead || m.y > lead.y)) lead = m;
    this.updateCamera(dt, lead);

    // 장애물 동기화
    this.rotors.forEach(({ r, grp }) => { grp.rotation.z = -r.angle; });
    this.movers.forEach(({ o, m }) => {
      if (o.type === 'slider') { m.position.set(X(o.x), Y(o.cy), 0); m.rotation.z = -o.ang; }
      else m.rotation.z = -o.angle;
    });
    this.bumpers.forEach(({ b, grp, ring, star, halo }) => {
      const s = 1 + b.hit * 0.18; grp.scale.set(s, s, 1); ring.material.emissiveIntensity = 0.25 + b.hit * 1.5;
      star.rotation.z = this.time * 0.8; star.material.emissiveIntensity = 0.45 + b.hit * 1.2;
      halo.material.opacity = 0.18 + b.hit * 0.6;
    });
    this.portals.forEach((p, i) => { p.disc.rotation.z = this.time * (p.entry ? -3 : 2) + i; const s = 1 + Math.sin(this.time * 4 + i) * 0.06; p.ring.scale.set(s, s, 1); });
    if (race.state !== 'ready') this.gateOpen = Math.min(1, this.gateOpen + dt * 3);
    this.gate.scale.x = Math.max(0.001, 1 - this.gateOpen); this.gate.visible = this.gateOpen < 1;
    this.arch.material.emissiveIntensity = 0.5 + 0.3 * Math.sin(this.time * 5);

    // 구슬 위치(도착한 구슬은 결승 아래 트레이에 순서대로 쌓는다)
    const im = this.marbles, ms = race.marbles;
    const trayCols = Math.max(1, Math.floor((W - 1) / (race.radius * 2.3)));
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i]; let x = m.x, y = m.y, sc = m.r;
      if (m.done) {
        const k = m.rank - 1;
        if (k < trayCols * 4) { x = 0.8 + race.radius + (k % trayCols) * race.radius * 2.3; y = map.goalY + 2.2 + Math.floor(k / trayCols) * race.radius * 2.3; }
        else sc = 0;
      }
      this.tmpQ.setFromAxisAngle(this.axisZ, -m.roll);
      this.tmpM.compose(this.tmpV.set(X(x), Y(y), m.r + 0.02), this.tmpQ, this.tmpS.set(sc, sc, sc));
      im.setMatrixAt(i, this.tmpM);
    }
    im.instanceMatrix.needsUpdate = true;

    // 선두 잔상·당첨 고리
    const P = this.particles;
    if (!this.reduced && race.state === 'running') {
      const tops = ms.filter(m => !m.done).sort((a, b) => b.y - a.y).slice(0, 3);
      tops.forEach((m, i) => { if (Math.hypot(m.vx, m.vy) > 4) P.spawn(X(m.x), Y(m.y), m.r, 0, 0, 0, 0.32, m.r * (1.5 - i * 0.3), this.color(m), 0); });
    }
    P.update(dt);
    const ringed = this.highlight ? this.highlight : (race.state === 'running' && lead ? [lead] : []);
    this.halos.forEach((h, i) => {
      const m = ringed[i];
      if (!m) { h.visible = false; return; }
      let x = m.x, y = m.y;
      if (m.done) {
        const k = m.rank - 1;
        if (k >= trayCols * 4) { h.visible = false; return; }
        x = 0.8 + race.radius + (k % trayCols) * race.radius * 2.3; y = map.goalY + 2.2 + Math.floor(k / trayCols) * race.radius * 2.3;
      }
      h.visible = true; const s = m.r * (1.45 + 0.12 * Math.sin(this.time * 6));
      h.scale.set(s, s, s); h.position.set(X(x), Y(y), m.r + 0.05);
    });

    this.gl.render(this.scene, this.camera);
    this.drawOverlay(dt, lead);
  };

  Renderer3D.prototype.project = function (x, y, z) {
    const v = this.tmpV.set(X(x), Y(y), z).project(this.camera);
    return [(v.x + 1) / 2 * this.cssW, (1 - v.y) / 2 * this.cssH, v.z];
  };

  Renderer3D.prototype.drawOverlay = function (dt, lead) {
    const ctx = this.ctx, race = this.race, d = this.dpr;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    const act = race.marbles.filter(m => !m.done && m.y > this.camY - 2 && m.y < this.camY + this.viewH + 2);
    const pxPerUnit = this.cssH / this.viewH;
    const showAll = act.length <= 60 && pxPerUnit >= 9;
    ctx.font = `600 ${Math.max(11, Math.min(15, pxPerUnit * 0.42))}px "Pretendard Variable", Pretendard, "Noto Sans KR", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineJoin = 'round';
    const focus = this.focusMarble;
    for (const m of act) {
      if (!showAll && m !== lead && m !== focus) continue;
      const [sx, sy, sz] = this.project(m.x, m.y - m.r - 0.15, m.r * 2);
      if (sz > 1) continue;
      ctx.lineWidth = 3.2; ctx.strokeStyle = this.pal.labelStroke; ctx.strokeText(m.label, sx, sy - 2);
      ctx.fillStyle = this.pal.label; ctx.fillText(m.label, sx, sy - 2);
    }
    this.drawMinimap();
    this.drawConfetti(dt);
  };

  Renderer3D.prototype.drawMinimap = function () {
    const ctx = this.ctx, race = this.race, map = race.map;
    if (this.cssW < 520 || this.mode === 'overview') { this.mini = null; return; }
    const pad = 12, w = 44, total = map.goalY + 3 - map.topY;
    const h = Math.min(this.cssH - pad * 2, w / W * total);
    const k = h / total, kx = w / W, x0 = pad, yTop = pad;
    this.mini = { x: x0, y: yTop, w, h, k, top: map.topY };
    ctx.fillStyle = this.pal.miniBg; ctx.fillRect(x0 - 4, yTop - 4, w + 8, h + 8);
    ctx.strokeStyle = this.pal.trackEdge; ctx.lineWidth = 1; ctx.strokeRect(x0 - 3.5, yTop - 3.5, w + 7, h + 7);
    ctx.strokeStyle = this.pal.miniWall; ctx.beginPath();
    for (const wl of map.walls) { ctx.moveTo(x0 + wl.ax * kx, yTop + (wl.ay - map.topY) * k); ctx.lineTo(x0 + wl.bx * kx, yTop + (wl.by - map.topY) * k); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(139,92,246,0.9)';
    for (const p of map.portals) { ctx.fillRect(x0 + p.ax * kx - 2, yTop + (p.ay - map.topY) * k - 2, 4, 4); }
    ctx.fillStyle = 'rgba(59,99,246,0.12)'; ctx.strokeStyle = 'rgba(59,99,246,0.8)';
    const vy = yTop + (this.camY - map.topY) * k, vh = this.viewH * k;
    ctx.fillRect(x0, vy, w, vh); ctx.strokeRect(x0 + 0.5, vy + 0.5, w - 1, vh - 1);
    for (const m of race.marbles) {
      if (m.done) continue;
      ctx.fillStyle = m.color; ctx.fillRect(x0 + m.x * kx - 1.5, yTop + (m.y - map.topY) * k - 1.5, 3, 3);
    }
    ctx.fillStyle = this.pal.goal; ctx.fillRect(x0, yTop + (map.goalY - map.topY) * k, w, 2);
  };
  Renderer3D.prototype.miniHit = function (x, y) {
    const m = this.mini; if (!m) return null;
    if (x < m.x - 4 || x > m.x + m.w + 4 || y < m.y - 4 || y > m.y + m.h + 4) return null;
    return m.top + (y - m.y) / m.k;
  };
  Renderer3D.prototype.drawConfetti = function (dt) {
    if (!this.confetti.length) return;
    const ctx = this.ctx;
    for (const p of this.confetti) {
      p.life += dt; p.vy += 900 * dt; p.vx *= 0.99; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - p.life / 3); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    this.confetti = this.confetti.filter(p => p.life < 3 && p.y < this.cssH + 40);
  };

  Renderer3D.supported = function () {
    if (!T) return false;
    try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
  };

  window.MR.Renderer3D = Renderer3D;
})();
