(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const catOf = id => CATEGORIES.find(c => c.id === id);
  const href = g => `games/${g.id}/`;
  const modeBadge = g => g.mode === 'multi'
    ? '<span class="badge multi">📱 휴대폰으로 함께</span>' : '<span class="badge host">🖥️ 진행자 혼자</span>';

  // ---- 카테고리 ----
  let filterCat = 'all', filterMode = null, query = '';
  $('cat-grid').innerHTML = CATEGORIES.map(c => {
    const n = GAMES.filter(g => g.cat === c.id).length;
    return `<button class="cat" data-cat="${c.id}" style="--c:${c.color};background:${c.bg}">
      <span class="n">${n ? n + '개' : '준비 중'}</span>
      <img src="assets/cat-${c.id}.png" alt="">
      <b>${c.name}</b><p>${c.sub}</p><span class="arrow">→</span></button>`;
  }).join('');
  $('cat-grid').addEventListener('click', e => {
    const b = e.target.closest('.cat'); if (!b) return;
    filterCat = filterCat === b.dataset.cat ? 'all' : b.dataset.cat; filterMode = null;
    render(); $('games').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // ---- 필터 ----
  $('filters').addEventListener('click', e => {
    const b = e.target.closest('.chip'); if (!b) return;
    if (b.dataset.cat) { filterCat = 'all'; filterMode = null; }
    else filterMode = filterMode === b.dataset.mode ? null : b.dataset.mode;
    render();
  });
  $('search-btn').onclick = () => { $('search-bar').classList.toggle('open'); if ($('search-bar').classList.contains('open')) $('search').focus(); };
  $('search').oninput = e => { query = e.target.value.trim().toLowerCase(); render(); if (query) $('games').scrollIntoView({ block: 'start' }); };

  // ---- 게임 목록 ----
  function list() {
    return GAMES.filter(g => (filterCat === 'all' || g.cat === filterCat) && (!filterMode || g.mode === filterMode)
      && (!query || [g.title, g.desc, ...g.tags, catOf(g.cat).name].join(' ').toLowerCase().includes(query)));
  }
  function render() {
    document.querySelectorAll('.cat').forEach(b => b.classList.toggle('on', b.dataset.cat === filterCat));
    document.querySelectorAll('.chip').forEach(b => b.classList.toggle('on', b.dataset.cat ? (filterCat === 'all' && !filterMode) : b.dataset.mode === filterMode));
    const rows = list();
    $('games-sub').textContent = filterCat === 'all' ? '지금 바로 할 수 있는 게임들이에요.' : catOf(filterCat).name + ' · ' + rows.length + '개';
    $('games-empty').hidden = rows.length > 0;
    $('game-grid').innerHTML = rows.map(g => `
      <a class="game" href="${href(g)}">
        <div class="head"><div class="emoji" style="background:${catOf(g.cat).bg}">${g.emoji}</div>
          <div><div class="cat-name">${catOf(g.cat).name}</div><h3>${esc(g.title)}</h3></div></div>
        <p>${esc(g.desc)}</p>
        <div class="tags">${g.tags.map(t => `<span>#${esc(t)}</span>`).join('')}</div>
        <div class="bottom">${modeBadge(g)}<span class="go">${esc(g.players)} · 시작 →</span></div>
      </a>`).join('');
  }
  render();

  // ---- 오늘의 추천 ----
  const pick = GAMES[Math.floor(Math.random() * GAMES.length)];
  $('event-card').innerHTML = `<div class="emoji">${pick.emoji}</div><div style="flex:1"><h3>${esc(pick.title)}</h3><p>${esc(pick.desc)}</p>
    ${modeBadge(pick)} <a class="cta" style="margin-left:8px" href="${href(pick)}">바로 시작</a></div>`;

  // ---- 랜덤 룰렛 ----
  let chosen = null, timer = null;
  function openRoulette() {
    $('roulette').hidden = false; spin();
  }
  function spin() {
    const slot = $('slot'); const span = slot.querySelector('span');
    $('slot-go').disabled = true; $('slot-name').textContent = '두구두구…'; slot.classList.add('spin');
    let i = 0, n = 0, total = 18 + Math.floor(Math.random() * 10);
    clearInterval(timer);
    timer = setInterval(() => {
      i = (i + 1) % GAMES.length; span.textContent = GAMES[i].emoji; n++;
      if (n >= total) {
        clearInterval(timer); slot.classList.remove('spin');
        chosen = GAMES[i]; $('slot-name').textContent = chosen.emoji + ' ' + chosen.title; $('slot-go').disabled = false;
        $('slot-go').focus();
      }
    }, 90 + n * 2);
  }
  $('slot-go').onclick = () => { if (chosen) location.href = href(chosen) + '?from=random'; };
  $('slot-again').onclick = spin;
  $('slot-close').onclick = () => { clearInterval(timer); $('roulette').hidden = true; };
  $('roulette').addEventListener('click', e => { if (e.target === $('roulette')) $('slot-close').click(); });
  document.querySelectorAll('[data-random]').forEach(b => b.onclick = openRoulette);
  if (new URLSearchParams(location.search).get('random')) { history.replaceState(null, '', location.pathname); openRoulette(); }

  // ---- 내비 활성 표시 ----
  const secs = ['home', 'games', 'howto', 'event'].map(id => $(id));
  const links = [...$('nav').querySelectorAll('a')];
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id));
  }), { rootMargin: '-40% 0px -50% 0px' });
  secs.forEach(s => io.observe(s));
})();
