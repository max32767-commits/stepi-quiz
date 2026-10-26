/* 마블 룰렛 — 효과음(Web Audio로 실시간 합성, 음원 파일 없음) */
(function () {
  'use strict';
  const S = {
    ctx: null, out: null, noise: null, enabled: true,
    last: {}, budget: 0, budgetAt: 0
  };

  S.unlock = function () {
    if (!S.enabled) return;
    try {
      if (!S.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        S.ctx = new AC();
        const comp = S.ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 6;
        S.out = S.ctx.createGain(); S.out.gain.value = 0.55;
        S.out.connect(comp); comp.connect(S.ctx.destination);
        const len = S.ctx.sampleRate * 0.6, buf = S.ctx.createBuffer(1, len, S.ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        S.noise = buf;
      }
      if (S.ctx.state === 'suspended') S.ctx.resume();
    } catch (e) { S.ctx = null; }
  };

  function voice(pan) {
    const g = S.ctx.createGain();
    if (S.ctx.createStereoPanner) { const p = S.ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan || 0)); g.connect(p); p.connect(S.out); }
    else g.connect(S.out);
    return g;
  }
  function tone(type, f0, f1, dur, vol, pan, delay) {
    const t = S.ctx.currentTime + (delay || 0), o = S.ctx.createOscillator(), g = voice(pan);
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(fType, f0, f1, q, dur, vol, pan) {
    const t = S.ctx.currentTime, src = S.ctx.createBufferSource(), f = S.ctx.createBiquadFilter(), g = voice(pan);
    src.buffer = S.noise; f.type = fType; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); src.start(t); src.stop(t + dur + 0.02);
  }

  // 종류별 최소 간격(초)과 초당 전체 상한으로 소리가 뭉개지지 않게 한다
  const GAP = { heart: 0.3, peg: 0.03, wall: 0.05, rotor: 0.06, slider: 0.08, flipper: 0.08, bumper: 0.07, portal: 0.15, goal: 0.06, shock: 0.2, boost: 0.15 };
  S.play = function (kind, v, pan) {
    if (!S.enabled || !S.ctx || S.ctx.state !== 'running') return;
    const now = S.ctx.currentTime;
    if (now - (S.last[kind] || 0) < (GAP[kind] || 0.05)) return;
    if (now - S.budgetAt > 1) { S.budgetAt = now; S.budget = 0; }
    if (++S.budget > 28 && kind !== 'goal' && kind !== 'win') return;
    S.last[kind] = now;
    const k = Math.min(1, (v || 10) / 30);
    switch (kind) {
      case 'peg': tone('sine', 1300 + Math.random() * 900, 0, 0.05, 0.05 + 0.1 * k, pan); break;
      case 'wall': tone('triangle', 420 + Math.random() * 120, 300, 0.06, 0.06 + 0.1 * k, pan); break;
      case 'rotor': tone('square', 520, 260, 0.05, 0.03 + 0.05 * k, pan); break;
      case 'slider': case 'flipper': tone('sine', 180, 90, 0.12, 0.2 + 0.15 * k, pan); noise('lowpass', 900, 200, 1, 0.08, 0.08, pan); break;
      case 'bumper': tone('square', 240, 620, 0.13, 0.1, pan); tone('sine', 480, 900, 0.1, 0.08, pan); break;
      case 'portal': noise('bandpass', 300, 2600, 4, 0.35, 0.35, pan); tone('sine', 400, 1400, 0.3, 0.08, pan); break;
      case 'shock': tone('sine', 120, 40, 0.35, 0.45, pan); noise('lowpass', 1200, 120, 1, 0.3, 0.25, pan); break;
      case 'boost': tone('sawtooth', 300, 1200, 0.22, 0.06, pan); break;
      case 'goal': tone('triangle', 880 * (v || 1), 0, 0.25, 0.18, pan); tone('sine', 1320 * (v || 1), 0, 0.3, 0.1, pan, 0.07); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => { tone('triangle', f, 0, 0.35 + i * 0.1, 0.22, 0, i * 0.11); tone('sine', f * 2, 0, 0.3, 0.06, 0, i * 0.11); }); break;
      case 'start': noise('highpass', 2000, 6000, 1, 0.08, 0.15, 0); tone('sine', 300, 900, 0.35, 0.15, 0); break;
      case 'tension': tone('sine', 110, 0, 0.6, 0.18, 0); break;
      case 'heart': tone('sine', 62, 40, 0.16, 0.22 + 0.25 * k, 0); tone('sine', 56, 38, 0.14, 0.16 + 0.2 * k, 0, 0.17); break;
    }
  };

  window.MR.Sound = S;
})();
