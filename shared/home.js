/* 모든 게임 페이지 공통: 왼쪽 아래 "랜덤 게임 홈" 버튼 + 허브에서 넘어온 경우 다음 랜덤 게임 버튼 */
(function () {
  var base = document.currentScript && document.currentScript.src
    ? document.currentScript.src.replace(/shared\/home\.js.*$/, '') : '../../';
  var params = new URLSearchParams(location.search);
  var css = '.stepi-home{position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;gap:6px;font-family:Pretendard,"Noto Sans KR",-apple-system,sans-serif}'
    + '.stepi-home a{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;background:#373282;color:#fff;font-size:13px;font-weight:700;text-decoration:none;box-shadow:0 4px 14px rgba(55,50,130,.35);opacity:.92}'
    + '.stepi-home a.alt{background:#ED911A;box-shadow:0 4px 14px rgba(237,145,26,.35)}'
    + '.stepi-home a:hover{opacity:1}'
    + '@media print{.stepi-home{display:none}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var box = document.createElement('div'); box.className = 'stepi-home';
  box.innerHTML = '<a href="' + base + '" title="STEPI 랜덤 게임 홈으로">🏠 랜덤 게임 홈</a>'
    + (params.get('from') === 'random' ? '<a class="alt" href="' + base + '?random=1" title="다른 게임 랜덤 뽑기">🎲 다른 게임</a>' : '');
  document.body.appendChild(box);
})();
