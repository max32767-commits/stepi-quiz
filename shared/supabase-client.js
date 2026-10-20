/* supabase-js 로드 + 설정 확인. 설정이 없으면 화면에 안내를 띄우고 window.sb = null */
(function () {
  var cfg = window.STEPI_SUPABASE || {};
  var ok = cfg.url && cfg.anonKey && /^https:\/\//.test(cfg.url) && window.supabase;
  if (ok) { window.sb = window.supabase.createClient(cfg.url, cfg.anonKey); return; }
  window.sb = null;
  var css = '.stepi-nodb{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(55,50,130,.92);color:#fff;font-family:Pretendard,"Noto Sans KR",sans-serif;text-align:center}'
    + '.stepi-nodb div{max-width:520px;background:#fff;color:#1b2230;border-radius:20px;padding:28px 24px;line-height:1.6}'
    + '.stepi-nodb h2{margin:0 0 10px;color:#373282}.stepi-nodb code{background:#f1f2f8;padding:2px 6px;border-radius:6px}'
    + '.stepi-nodb a{display:inline-block;margin-top:14px;padding:10px 18px;border-radius:999px;background:#ED911A;color:#fff;text-decoration:none;font-weight:700}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var d = document.createElement('div'); d.className = 'stepi-nodb';
  d.innerHTML = '<div><h2>멀티플레이 설정이 아직 없어요</h2>'
    + '이 게임은 여러 사람이 같이 접속해서 하는 게임이라 Supabase 연결이 필요합니다.<br>'
    + '<code>shared/supabase-config.js</code> 에 프로젝트 URL과 anon 키를 넣고, <code>supabase/schema.sql</code> 을 실행해 주세요.'
    + '<br><a href="../../">랜덤 게임 홈으로</a></div>';
  document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(d); });
})();
