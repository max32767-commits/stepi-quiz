/* 마블 룰렛 — UI · 입력 파싱 · 당첨 판정 · 기록 */
(function () {
  'use strict';
  const { MAPS, buildMap, Race, newSeed, Renderer, Renderer3D, Sound, STEP, W } = window.MR;
  const $ = s => document.querySelector(s);

  const el = {
    map: $('#map'), rule: $('#rule'), rankN: $('#rankN'), rankField: $('#rankField'), rankLabel: $('#rankLabel'),
    unit: $('#unit'), unitHelp: $('#unitHelp'), speed: $('#speed'), skills: $('#skills'), record: $('#record'), reduce: $('#reduce'),
    names: $('#names'), countInfo: $('#countInfo'), msgs: $('#msgs'),
    start: $('#startBtn'), shuffle: $('#shuffleBtn'), pause: $('#pauseBtn'), skip: $('#skipBtn'), reset: $('#resetBtn'),
    seedInfo: $('#seedInfo'), ranking: $('#ranking'), rankEmpty: $('#rankEmpty'), rankInfo: $('#rankInfo'),
    history: $('#history'), historyEmpty: $('#historyEmpty'),
    result: $('#result'), resultTitle: $('#resultTitle'), resultList: $('#resultList'), resultMeta: $('#resultMeta'),
    recLink: $('#recLink'), recBadge: $('#recBadge'),
    hudState: $('#hudState'), hudTime: $('#hudTime'), hudCount: $('#hudCount'), hudMap: $('#hudMap'),
    camFollow: $('#camFollow'), camOverview: $('#camOverview'), board: $('#board'), gl: $('#gl'), overlay: $('#overlay'),
    stage: $('.stage'), use3d: $('#use3d'), sound: $('#sound'), mute: $('#muteBtn'),
    toast: $('#toast'), sr: $('#sr-status'), settings: $('#settings'), toggleSettings: $('#toggleSettings')
  };

  /* ---------------------------------------------------------- 저장소(실패해도 동작) */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } }
  };

  /* ---------------------------------------------------------- 입력 파싱 */
  const MAX_PER = 100, MAX_TOTAL = 500, MAX_NAME = 24;
  function parseInput(text) {
    const errors = [], warnings = [], map = new Map();
    const tokens = text.split(/[,\n，]/).map(s => s.trim()).filter(Boolean);
    for (const tok of tokens) {
      let name = tok, count = 1;
      if (tok.includes('*')) {
        const m = tok.match(/^(.+?)\s*\*\s*(\d+)$/);
        if (!m) { errors.push(`"${tok}" — 구슬 수는 이름*숫자 형식으로 적어 주세요.`); continue; }
        name = m[1].trim(); count = parseInt(m[2], 10);
        if (count < 1) { errors.push(`"${tok}" — 구슬 수는 1 이상이어야 합니다.`); continue; }
        if (count > MAX_PER) { warnings.push(`"${name}"의 구슬 수를 ${MAX_PER}개로 줄였습니다.`); count = MAX_PER; }
      }
      if (!name) { errors.push(`"${tok}" — 이름이 비어 있습니다.`); continue; }
      if ([...name].length > MAX_NAME) { warnings.push(`"${name.slice(0, 10)}…" 이름이 길어 ${MAX_NAME}자로 줄였습니다.`); name = [...name].slice(0, MAX_NAME).join(''); }
      if (map.has(name)) { warnings.push(`"${name}"이(가) 여러 번 입력되어 구슬 수를 합쳤습니다.`); map.set(name, Math.min(MAX_PER, map.get(name) + count)); }
      else map.set(name, count);
    }
    let participants = [...map].map(([name, count]) => ({ name, count }));
    let total = participants.reduce((a, p) => a + p.count, 0);
    if (total > MAX_TOTAL) {
      errors.push(`구슬은 최대 ${MAX_TOTAL}개까지 만들 수 있습니다. (현재 ${total}개)`);
    }
    if (!participants.length) errors.push('참가자 이름을 1명 이상 입력해 주세요.');
    return { participants, total, errors, warnings };
  }

  function makeEntries(participants) {
    const entries = [];
    participants.forEach((p, pid) => {
      const hue = (pid * 137.508 + 215) % 360;
      for (let no = 1; no <= p.count; no++) {
        const l = p.count > 1 ? 50 + ((no - 1) % 3 - 1) * 7 : 52;
        entries.push({
          pid, name: p.name, no, of: p.count,
          label: p.count > 1 ? `${p.name} ${no}` : p.name,
          h: hue, s: 0.72, l: l / 100,
          color: `hsl(${hue.toFixed(1)} 72% ${l}%)`,
          light: `hsl(${hue.toFixed(1)} 90% ${Math.min(92, l + 30)}%)`,
          dark: `hsl(${hue.toFixed(1)} 70% ${Math.max(18, l - 20)}%)`
        });
      }
    });
    return entries;
  }

  /* ---------------------------------------------------------- 상태 */
  const r2d = new Renderer(el.board);
  let r3d = null;
  if (Renderer3D && Renderer3D.supported()) {
    try { r3d = new Renderer3D(el.gl, el.overlay); } catch (e) { r3d = null; }
  }
  let renderer = r2d;
  const S = {
    parsed: null, race: null, seed: newSeed(), paused: false, decided: null,
    acc: 0, evIdx: 0, recorder: null, recChunks: [], recUrl: null, history: store.get('mr.history.v1', [])
  };
  const reducedMQ = matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------------------------------------------------- 설정 UI */
  MAPS.forEach(m => {
    const o = document.createElement('option'); o.value = m.id; o.textContent = m.name; el.map.appendChild(o);
    const li = document.createElement('li'); li.innerHTML = `<b></b> — <span></span>`;
    li.querySelector('b').textContent = m.name; li.querySelector('span').textContent = m.desc;
    $('#mapGuide').appendChild(li);
  });
  const saved = store.get('mr.settings.v1', {});
  if (saved.map && MAPS.some(m => m.id === saved.map)) el.map.value = saved.map;
  if (saved.rule) el.rule.value = saved.rule;
  if (saved.rankN) el.rankN.value = saved.rankN;
  if (saved.unit) el.unit.value = saved.unit;
  if (saved.speed) el.speed.value = saved.speed;
  el.skills.checked = !!saved.skills;
  el.record.checked = !!saved.record;
  el.reduce.checked = saved.reduce != null ? saved.reduce : reducedMQ.matches;
  el.use3d.checked = r3d ? (saved.use3d != null ? saved.use3d : false) : false;   // 기본은 2D
  el.use3d.disabled = !r3d;
  el.sound.checked = saved.sound != null ? saved.sound : true;
  if (saved.names) el.names.value = saved.names;
  if (saved.settingsOpen === false || (saved.settingsOpen == null && innerWidth < 560)) setSettingsOpen(false);

  function saveSettings() {
    store.set('mr.settings.v1', {
      map: el.map.value, rule: el.rule.value, rankN: el.rankN.value, unit: el.unit.value, speed: el.speed.value,
      skills: el.skills.checked, record: el.record.checked, reduce: el.reduce.checked, names: el.names.value,
      use3d: el.use3d.checked, sound: el.sound.checked,
      settingsOpen: !el.settings.hidden
    });
  }
  function setSettingsOpen(open) {
    el.settings.hidden = !open;
    el.toggleSettings.setAttribute('aria-expanded', String(open));
  }
  el.toggleSettings.addEventListener('click', () => { setSettingsOpen(el.settings.hidden); saveSettings(); });

  function applyRenderer() {
    const want3d = !!(r3d && el.use3d.checked);
    const prevMode = renderer.mode;
    renderer = want3d ? r3d : r2d;
    el.gl.hidden = !want3d; el.overlay.hidden = !want3d; el.board.hidden = want3d;
    el.stage.classList.toggle('is3d', want3d);
    renderer.reduced = el.reduce.checked;
    renderer.mode = prevMode === 'manual' ? 'follow' : prevMode;
    if (S.race) renderer.setRace(S.race);
    window.__mr && (window.__mr.renderer = renderer);
  }
  function applySound() {
    Sound.enabled = el.sound.checked;
    el.mute.setAttribute('aria-pressed', String(!el.sound.checked));
    el.mute.querySelector('use').setAttribute('href', el.sound.checked ? '#i-sound' : '#i-mute');
    el.mute.title = el.sound.checked ? '효과음 끄기' : '효과음 켜기';
    if (el.sound.checked) Sound.unlock();
  }
  /* ---------------------------------------------------------- 테마(밝게/어둡게, 기본 어둡게) */
  const themeBtn = $('#themeBtn'), themeLabel = $('#themeLabel'), themeMeta = document.querySelector('meta[name="theme-color"]');
  function applyTheme(theme) {
    window.MR.theme = theme;
    document.documentElement.dataset.theme = theme;
    themeLabel.textContent = theme === 'dark' ? '밝게' : '어둡게';
    themeBtn.setAttribute('aria-label', theme === 'dark' ? '밝은 화면으로 바꾸기' : '어두운 화면으로 바꾸기');
    if (themeMeta) themeMeta.content = theme === 'dark' ? '#07090e' : '#f5f7fb';
    if (S.race && renderer === r3d) r3d.setRace(S.race);   // 3D 장면 색 다시 구성
  }
  applyTheme(store.get('mr.theme', 'dark'));
  themeBtn.addEventListener('click', () => {
    const t = window.MR.theme === 'dark' ? 'light' : 'dark';
    store.set('mr.theme', t); applyTheme(t);
  });

  function applyReduce() {
    r2d.reduced = el.reduce.checked; if (r3d) r3d.reduced = el.reduce.checked;
    document.documentElement.classList.toggle('reduce-motion', el.reduce.checked);
  }
  applyReduce();
  applyRenderer();
  applySound();

  function ruleN() { return Math.max(1, Math.min(500, parseInt(el.rankN.value, 10) || 1)); }
  function syncRuleUI() {
    const r = el.rule.value;
    el.rankField.hidden = !(r === 'rank' || r === 'multi');
    el.rankLabel.textContent = r === 'rank' ? '몇 번째' : '인원';
    const u = el.unit.value === 'participant';
    el.unitHelp.textContent = u
      ? '순위 단위 “참가자”: 각 참가자의 가장 먼저 도착한 구슬로 순위를 매깁니다. 한 사람이 두 번 당첨되지 않으며, 구슬이 많을수록 일찍 도착할 확률이 높습니다.'
      : '순위 단위 “구슬”: 구슬 하나하나가 순위를 가집니다. 복수 당첨 시 같은 참가자가 여러 번 당첨될 수 있습니다.';
  }
  syncRuleUI();

  /* ---------------------------------------------------------- 준비/리셋 */
  function prepare(opts) {
    opts = opts || {};
    stopRecording(true);
    const parsed = S.parsed = parseInput(el.names.value);
    renderMessages(parsed);
    if (opts.newSeed) S.seed = newSeed();
    const entries = makeEntries(parsed.errors.length ? parsed.participants.slice(0, 0) : parsed.participants);
    S.race = new Race(buildMap(el.map.value), entries, { seed: S.seed, skills: el.skills.checked });
    S.paused = false; S.decided = null; S.acc = 0; S.evIdx = 0; S.crit = null;
    renderer.setRace(S.race);
    el.ranking.innerHTML = ''; el.rankEmpty.hidden = false; el.rankInfo.textContent = '';
    hideResult();
    el.seedInfo.textContent = `시드 ${S.seed.toString(16).toUpperCase().padStart(8, '0')}`;
    el.hudMap.textContent = S.race.map.name;
    updateControls(); updateHud(true);
  }

  function renderMessages(p) {
    const ppl = p.participants.length;
    el.countInfo.textContent = `${ppl}명 · 구슬 ${p.total}개`;
    el.msgs.innerHTML = '';
    const add = (cls, t) => { const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = t; el.msgs.appendChild(d); };
    p.errors.slice(0, 4).forEach(t => add('err', t));
    p.warnings.slice(0, 3).forEach(t => add('warn', t));
    const v = validateRule(); if (v && !p.errors.length) add('err', v);
  }

  function unitTotal() {
    const p = S.parsed; if (!p) return 0;
    return el.unit.value === 'participant' ? p.participants.length : p.total;
  }
  function validateRule() {
    const r = el.rule.value, n = ruleN(), total = unitTotal();
    if (!total) return '';
    if ((r === 'rank' || r === 'multi') && n > total) {
      return `${el.unit.value === 'participant' ? '참가자' : '구슬'} 수(${total})보다 큰 값(${n})은 고를 수 없습니다.`;
    }
    if (r === 'last' && total < 2) return '꼴등을 뽑으려면 2개 이상의 ' + (el.unit.value === 'participant' ? '참가자가' : '구슬이') + ' 필요합니다.';
    return '';
  }
  function canStart() {
    return S.race && S.race.state === 'ready' && S.parsed && !S.parsed.errors.length && !validateRule() && S.race.marbles.length > 0;
  }

  function updateControls() {
    const st = S.race ? S.race.state : 'ready';
    const running = st === 'running' && !S.decided;
    const locked = st !== 'ready';
    el.start.disabled = !canStart();
    el.shuffle.disabled = locked;
    el.pause.disabled = !(st === 'running');
    el.skip.disabled = !(canStart() || running);
    el.pause.querySelector('span').textContent = S.paused ? '재개' : '일시정지';
    el.pause.querySelector('use').setAttribute('href', S.paused ? '#i-play' : '#i-pause');
    el.names.readOnly = locked;
    [el.map, el.rule, el.rankN, el.unit, el.skills, el.record].forEach(x => { x.disabled = locked; });
    $('#shuffleNames').disabled = locked; $('#clearNames').disabled = locked;
  }

  /* ---------------------------------------------------------- 실행 */
  function start() {
    if (!canStart()) { if (S.parsed && S.parsed.errors.length) el.names.focus(); return false; }
    S.race.start();
    S.evIdx = 0; S.paused = false;
    Sound.unlock(); Sound.play('start');
    if (el.record.checked) startRecording();
    announce('추첨을 시작했습니다.');
    updateControls(); updateHud(true);
    return true;
  }

  function togglePause() {
    if (!S.race || S.race.state !== 'running') return;
    S.paused = !S.paused; S.acc = 0;
    if (S.recorder && S.recorder.state !== 'inactive') { try { S.paused ? S.recorder.pause() : S.recorder.resume(); } catch (e) { /* 무시 */ } }
    announce(S.paused ? '일시정지했습니다.' : '다시 진행합니다.');
    updateControls(); updateHud(true);
  }

  // 결과 바로 보기: 같은 시뮬레이션을 화면 갱신 없이 빠르게 진행해 실제 결과를 얻는다
  function skipToResult() {
    if (S.race.state === 'ready' && !start()) return;
    S.paused = false;
    let guard = 0;
    S.skipping = true;
    while (!S.decided && S.race.state === 'running' && guard < 120 * 600) { S.race.step(); guard++; if (guard % 60 === 0) { S.race.impacts.length = 0; processEvents(); } }
    S.race.impacts.length = 0;
    processEvents();
    S.skipping = false;
    updateControls(); updateHud(true);
  }

  /* ---------------------------------------------------------- 당첨 판정 */
  // 도착한 구슬 → 순위 단위(구슬/참가자) 목록
  function rankedUnits() {
    const race = S.race, byP = el.unit.value === 'participant';
    if (!byP) return { order: race.finished.slice(), total: race.marbles.length, pending: () => race.marbles.filter(m => !m.done) };
    const seen = new Set(), order = [];
    for (const m of race.finished) if (!seen.has(m.pid)) { seen.add(m.pid); order.push(m); }
    const total = new Set(race.marbles.map(m => m.pid)).size;
    return {
      order, total,
      pending: () => {
        const left = new Map();
        for (const m of race.marbles) if (!seen.has(m.pid) && (!left.has(m.pid) || m.y > left.get(m.pid).y)) left.set(m.pid, m);
        return [...left.values()];
      }
    };
  }

  function decide() {
    const rule = el.rule.value, n = ruleN();
    const u = rankedUnits(), o = u.order;
    if (rule === 'first' && o.length >= 1) return { winners: [{ m: o[0], rank: 1 }] };
    if (rule === 'rank' && o.length >= n) return { winners: [{ m: o[n - 1], rank: n }] };
    if (rule === 'multi' && o.length >= n) return { winners: o.slice(0, n).map((m, i) => ({ m, rank: i + 1 })) };
    if (rule === 'last') {
      if (o.length >= u.total) return { winners: [{ m: o[u.total - 1], rank: u.total }] };
      if (o.length === u.total - 1) {
        const left = u.pending()[0];
        if (left) return { winners: [{ m: left, rank: u.total, unfinished: true }] };
      }
    }
    return null;
  }

  function ruleText() {
    const r = el.rule.value, n = ruleN(), unit = el.unit.value === 'participant' ? '참가자' : '구슬';
    return { first: '1등', last: '꼴등', rank: `${n}번째 도착`, multi: `먼저 도착한 ${n}명` }[r] + ` · ${unit} 기준`;
  }
  const nameOf = m => el.unit.value === 'participant' ? m.name : m.label;

  // 다음 도착 한 번으로 당첨이 확정되는 상황이면, 결승에 가장 가까운 후보 구슬을 돌려준다(슬로모션·줌인용)
  // 결승 구간 안에서 마지막 한 자리를 다투는 구슬들(선두 포함, 최대 3개) — 특정 구슬을 '예정 당첨자'처럼 보이게 하지 않기 위해 함께 보여 준다
  function contenders(lead) {
    const race = S.race, byP = el.unit.value === 'participant', u = rankedUnits();
    const seen = byP ? new Set(u.order.map(m => m.pid)) : null, taken = new Set();
    return race.marbles.filter(m => !m.done && !(byP && seen.has(m.pid)) && m.y > race.map.finalY)
      .sort((a, b) => b.y - a.y).filter(m => { const k = byP ? m.pid : m.id; if (taken.has(k)) return false; taken.add(k); return true; }).slice(0, 3);
  }
  function criticalMarble() {
    const race = S.race;
    if (!race || race.state !== 'running' || S.decided) return null;
    const rule = el.rule.value, n = ruleN(), u = rankedUnits();
    const target = rule === 'first' ? 1 : rule === 'last' ? u.total - 1 : n;
    if (target - u.order.length !== 1) return null;
    const byP = el.unit.value === 'participant';
    const seen = byP ? new Set(u.order.map(m => m.pid)) : null;
    let best = null;
    for (const m of race.marbles) {
      if (m.done || (byP && seen.has(m.pid))) continue;
      if (!best || m.y > best.y) best = m;
    }
    return best && best.y > race.map.finalY ? best : null;
  }

  function processEvents() {
    const race = S.race, ev = race.events;
    let finishedChanged = false;
    for (; S.evIdx < ev.length; S.evIdx++) {
      const e = ev[S.evIdx];
      if (e.type === 'finish') {
        appendRanking(e.m); finishedChanged = true;
        if (!S.skipping) Sound.play('goal', e.m.rank <= 3 ? 1.5 - e.m.rank * 0.15 : 0.75, (e.m.x / W) * 1.4 - 0.7);
      }
      if (e.type === 'timeout') toast('제한 시간이 지나 남은 구슬은 현재 위치 순서로 확정했습니다.');
    }
    if (finishedChanged && !S.decided) {
      const d = decide();
      if (d) onDecided(d);
    }
  }

  function appendRanking(m) {
    el.rankEmpty.hidden = true;
    const li = document.createElement('li');
    li.dataset.id = m.id;
    li.innerHTML = '<span class="num"></span><span class="dot"></span><span class="nm"></span><span class="t"></span>';
    li.querySelector('.num').textContent = m.rank;
    li.querySelector('.dot').style.background = m.color;
    li.querySelector('.nm').textContent = m.label;
    li.querySelector('.t').textContent = m.finishTime.toFixed(1) + 's';
    if (S.decided && S.decided.ids.has(m.id)) li.classList.add('win');
    el.ranking.appendChild(li);
    el.rankInfo.textContent = `${S.race.finished.length} / ${S.race.marbles.length}`;
    if (!el.reduce.checked) li.scrollIntoView({ block: 'nearest' }); else el.ranking.scrollTop = el.ranking.scrollHeight;
  }

  function onDecided(d) {
    const race = S.race;
    d.ids = new Set(d.winners.map(w => w.m.id));
    d.time = race.time; d.at = new Date(); d.rule = ruleText(); d.mapName = race.map.name; d.seed = S.seed;
    d.orderSnapshot = race.finished.map(m => m.label);
    S.decided = d;
    el.ranking.querySelectorAll('li').forEach(li => { if (d.ids.has(+li.dataset.id)) li.classList.add('win'); });
    renderer.celebrate(d.winners.map(w => w.m));
    Sound.play('win');
    showResult(d);
    pushHistory(d);
    announce('당첨: ' + d.winners.map(w => nameOf(w.m)).join(', '));
    if (S.recorder) setTimeout(() => stopRecording(false), 1800);
    updateControls();
  }

  function showResult(d) {
    el.resultTitle.textContent = d.rule;
    el.resultList.innerHTML = '';
    el.resultList.classList.toggle('many', d.winners.length > 1);
    d.winners.forEach(w => {
      const li = document.createElement('li');
      if (d.winners.length > 1) { const n = document.createElement('span'); n.className = 'num'; n.textContent = w.rank + '.'; li.appendChild(n); }
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = w.m.color;
      const nm = document.createElement('span'); nm.textContent = nameOf(w.m);
      li.append(dot, nm); el.resultList.appendChild(li);
    });
    const last = d.winners[0].unfinished ? ' · 마지막 남은 구슬' : '';
    el.resultMeta.textContent = `${d.mapName} · ${d.time.toFixed(1)}초${last} · 시드 ${d.seed.toString(16).toUpperCase().padStart(8, '0')}`;
    el.result.hidden = false;
    $('#againBtn').focus({ preventScroll: true });
  }
  function hideResult() { el.result.hidden = true; }

  /* ---------------------------------------------------------- 기록·복사 */
  function resultText(h) {
    const t = new Date(h.at);
    const pad = x => String(x).padStart(2, '0');
    const when = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
    return [
      `[마블 룰렛] ${when}`,
      `맵: ${h.map} · 방식: ${h.rule} · 참가 ${h.people}명/구슬 ${h.marbles}개`,
      `당첨: ${h.winners.join(', ')}`,
      h.order && h.order.length ? `도착 순서: ${h.order.slice(0, 30).map((x, i) => `${i + 1}.${x}`).join(' ')}${h.order.length > 30 ? ' …' : ''}` : '',
      `시드: ${h.seed}`
    ].filter(Boolean).join('\n');
  }
  function pushHistory(d) {
    const h = {
      at: d.at.getTime(), map: d.mapName, rule: d.rule, winners: d.winners.map(w => nameOf(w.m)),
      order: d.orderSnapshot, seed: d.seed.toString(16).toUpperCase().padStart(8, '0'),
      people: S.parsed.participants.length, marbles: S.parsed.total
    };
    S.history.unshift(h); S.history = S.history.slice(0, 30);
    store.set('mr.history.v1', S.history);
    renderHistory();
  }
  function renderHistory() {
    el.history.innerHTML = '';
    S.history.forEach(h => {
      const li = document.createElement('li');
      const t = new Date(h.at);
      li.innerHTML = '<div class="h-top"><span class="a"></span><span class="b"></span></div><div class="h-win"></div>';
      li.querySelector('.a').textContent = `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} · ${h.rule}`;
      li.querySelector('.b').textContent = h.map;
      li.querySelector('.h-win').textContent = h.winners.join(', ');
      el.history.appendChild(li);
    });
    el.historyEmpty.hidden = S.history.length > 0;
  }
  renderHistory();

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('클립보드에 복사했습니다.'); return; } catch (e) { /* 아래 대체 방식 */ }
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('클립보드에 복사했습니다.'); } catch (e) { toast('복사하지 못했습니다.'); }
    ta.remove();
  }

  /* ---------------------------------------------------------- 녹화 */
  function startRecording() {
    const recCanvas = renderer === r3d ? el.gl : el.board;
    if (!recCanvas.captureStream || typeof MediaRecorder === 'undefined') { toast('이 브라우저는 녹화를 지원하지 않습니다.'); return; }
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const type = types.find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
    try {
      const rec = new MediaRecorder(recCanvas.captureStream(60), type ? { mimeType: type, videoBitsPerSecond: 8e6 } : undefined);
      S.recChunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) S.recChunks.push(e.data); };
      rec.onstop = () => {
        if (rec._discard) return;
        const blob = new Blob(S.recChunks, { type: rec.mimeType || 'video/webm' });
        if (S.recUrl) URL.revokeObjectURL(S.recUrl);
        S.recUrl = URL.createObjectURL(blob);
        el.recLink.href = S.recUrl;
        el.recLink.download = `marble-roulette-${Date.now()}.${(rec.mimeType || '').includes('mp4') ? 'mp4' : 'webm'}`;
        el.recLink.hidden = false;
      };
      rec.start(500); S.recorder = rec; el.recBadge.hidden = false;
    } catch (e) { toast('녹화를 시작하지 못했습니다.'); }
  }
  function stopRecording(discard) {
    const rec = S.recorder; S.recorder = null; el.recBadge.hidden = true;
    if (discard) el.recLink.hidden = true;
    if (rec && rec.state !== 'inactive') { rec._discard = discard; try { rec.stop(); } catch (e) { /* 무시 */ } }
  }

  /* ---------------------------------------------------------- HUD */
  let hudAt = 0;
  function updateHud(force) {
    const now = performance.now();
    if (!force && now - hudAt < 120) return;
    hudAt = now;
    const race = S.race; if (!race) return;
    let st = '대기', cls = '';
    if (race.state === 'running') { st = S.paused ? '일시정지' : (S.decided ? '결과 확정 · 진행 중' : S.crit ? '결승 직전!' : '진행 중'); cls = S.crit ? 'hot' : 'live'; }
    if (race.state === 'done' || (S.decided && race.state !== 'running')) { st = '완료'; cls = 'done'; }
    if (S.decided && race.state === 'running') cls = 'done';
    el.hudState.textContent = st; el.hudState.className = 'chip ' + cls;
    el.hudTime.textContent = race.time.toFixed(1) + '초';
    el.hudCount.textContent = `도착 ${race.finished.length} / ${race.marbles.length}`;
  }

  /* ---------------------------------------------------------- 메인 루프 */
  let last = performance.now();
  S.heartAt = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const race = S.race;
    if (race && !S.paused) {
      const crit = criticalMarble();
      if (crit && !S.crit) { Sound.play('tension'); updateHud(true); }
      if (!crit && S.crit) updateHud(true);
      S.crit = crit;
      renderer.focusMarble = el.reduce.checked ? null : crit;
      renderer.contenders = crit ? contenders(crit) : null;
      // 결승 슬로모션(재생 속도만 바뀌고 결과는 같음): 결승 구간 입구 0.5배 → 결승선 앞 0.22배까지 점점 느려진다
      let slow = 1;
      if (crit && !el.reduce.checked) {
        const k = Math.max(0, Math.min(1, (crit.y - race.map.finalY) / (race.map.goalY - race.map.finalY)));
        slow = 0.6 - 0.3 * k;
        // 심장 박동: 결승선에 가까울수록 빨라진다
        if (now - S.heartAt > 950 - 600 * k) { S.heartAt = now; Sound.play('heart', 10 + 20 * k); renderer.pulse = 1; }
      }
      const speed = race.state === 'running' ? (+el.speed.value || 1) * slow : 1;
      S.acc += dt * speed;
      let n = 0; const maxSteps = 40;
      while (S.acc >= STEP && n < maxSteps) { race.step(); S.acc -= STEP; n++; }
      if (n === maxSteps) S.acc = 0; // 느린 기기: 밀린 시간을 버리고 느리게 진행(결과에는 영향 없음)
      processEvents();
      const imps = race.impacts;
      if (imps.length) {
        if (Sound.enabled) {
          const y0 = renderer.camY - 3, y1 = renderer.camY + (renderer.viewH || 30) + 3;
          for (const im of imps) if (im.y > y0 && im.y < y1) Sound.play(im.kind, im.v, (im.x / W) * 1.4 - 0.7);
        }
        if (renderer.onImpacts) renderer.onImpacts(imps);
        if (crit && !el.reduce.checked) for (const im of imps) if (im.y > race.map.finalY && (im.kind === 'bumper' || im.kind === 'rotor' || im.kind === 'slider' || im.kind === 'goal')) renderer.shake = Math.max(renderer.shake || 0, im.kind === 'goal' ? 1 : 0.55);
        imps.length = 0;
      }
      if (race.state === 'done' && !el.pause.disabled) updateControls();
    }
    renderer.draw(dt);
    updateHud(false);
    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------- 이벤트 */
  let inputTimer = 0;
  el.names.addEventListener('input', () => {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => { if (S.race.state === 'ready') { prepare(); saveSettings(); } }, 220);
  });
  el.names.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); start(); } });
  [el.map, el.skills].forEach(x => x.addEventListener('change', () => { prepare(); saveSettings(); }));
  [el.rule, el.rankN, el.unit].forEach(x => x.addEventListener('input', () => { syncRuleUI(); renderMessages(S.parsed); updateControls(); saveSettings(); }));
  [el.speed, el.record].forEach(x => x.addEventListener('change', saveSettings));
  el.reduce.addEventListener('change', () => { applyReduce(); saveSettings(); });
  el.use3d.addEventListener('change', () => { applyRenderer(); setCamButtons(); saveSettings(); });
  el.sound.addEventListener('change', () => { applySound(); saveSettings(); });
  el.mute.addEventListener('click', () => { el.sound.checked = !el.sound.checked; applySound(); saveSettings(); });
  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });

  el.start.addEventListener('click', start);
  el.pause.addEventListener('click', togglePause);
  el.skip.addEventListener('click', skipToResult);
  el.shuffle.addEventListener('click', () => {
    const others = MAPS.filter(m => m.id !== el.map.value), pick = others[Math.floor(Math.random() * others.length)] || MAPS[0];
    el.map.value = pick.id; prepare({ newSeed: true }); saveSettings(); toast(`맵: ${pick.name} · 출발 배치도 새로 섞었습니다.`);
  });
  el.reset.addEventListener('click', () => prepare({ newSeed: true }));
  $('#againBtn').addEventListener('click', () => { prepare({ newSeed: true }); el.start.focus(); });
  $('#resultClose').addEventListener('click', () => { hideResult(); el.reset.focus(); });
  $('#copyBtn').addEventListener('click', () => { if (S.history[0]) copyText(resultText(S.history[0])); });
  $('#copyHistory').addEventListener('click', () => { if (S.history.length) copyText(S.history.map(resultText).join('\n\n')); else toast('복사할 기록이 없습니다.'); });
  $('#clearHistory').addEventListener('click', () => {
    if (!S.history.length) return;
    if (!confirm('추첨 기록을 모두 지울까요?')) return;
    S.history = []; store.set('mr.history.v1', []); renderHistory();
  });
  $('#shuffleNames').addEventListener('click', () => {
    const toks = el.names.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    for (let i = toks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [toks[i], toks[j]] = [toks[j], toks[i]]; }
    el.names.value = toks.join(', '); prepare(); saveSettings();
  });
  $('#clearNames').addEventListener('click', () => { el.names.value = ''; prepare(); saveSettings(); el.names.focus(); });

  // 카메라
  function setCam(mode) {
    renderer.setMode(mode);
    el.camFollow.setAttribute('aria-pressed', String(mode === 'follow'));
    el.camOverview.setAttribute('aria-pressed', String(mode === 'overview'));
  }
  el.camFollow.addEventListener('click', () => setCam('follow'));
  el.camOverview.addEventListener('click', () => setCam(renderer.mode === 'overview' ? 'follow' : 'overview'));
  const isCanvas = e => e.target && e.target.tagName === 'CANVAS';
  el.stage.addEventListener('wheel', e => {
    if (!isCanvas(e) || renderer.mode === 'overview') return;
    e.preventDefault(); renderer.scrollBy(e.deltaY * (e.deltaMode === 1 ? 16 : 1)); setCamButtons();
  }, { passive: false });
  let drag = null;
  el.stage.addEventListener('pointerdown', e => {
    if (!isCanvas(e)) return;
    const tgt = e.target;
    const r = tgt.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = renderer.miniHit(x, y);
    if (hit != null) { renderer.jumpTo(hit); setCamButtons(); drag = { mini: true, tgt }; tgt.setPointerCapture(e.pointerId); return; }
    if (renderer.mode === 'overview') return;
    drag = { y: e.clientY, tgt }; tgt.setPointerCapture(e.pointerId);
  });
  el.stage.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.mini) { const r = drag.tgt.getBoundingClientRect(); const h = renderer.miniHit(e.clientX - r.left, Math.max(r.top + 1, e.clientY) - r.top); if (h != null) renderer.jumpTo(h); return; }
    const dy = drag.y - e.clientY; drag.y = e.clientY;
    if (Math.abs(dy) > 0) { renderer.scrollBy(dy); setCamButtons(); }
  });
  const endDrag = () => { drag = null; };
  el.stage.addEventListener('pointerup', endDrag); el.stage.addEventListener('pointercancel', endDrag);
  function setCamButtons() {
    el.camFollow.setAttribute('aria-pressed', String(renderer.mode === 'follow'));
    el.camOverview.setAttribute('aria-pressed', String(renderer.mode === 'overview'));
  }

  // 키보드
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !el.result.hidden) { hideResult(); return; }
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select', 'button', 'a'].includes(tag) || e.target.isContentEditable) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (S.race.state === 'ready') start(); else togglePause();
    }
  });

  /* ---------------------------------------------------------- 알림 */
  let toastTimer = 0;
  function toast(t) {
    el.toast.textContent = t; el.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }
  function announce(t) { el.sr.textContent = t; }

  prepare();
  requestAnimationFrame(frame);
  window.__mr = { S, renderer, r2d, r3d }; // 디버깅용
})();
