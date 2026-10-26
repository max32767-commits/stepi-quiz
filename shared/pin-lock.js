/* 진행자 화면 가림막 — <head> 안에서 동기적으로 실행되어, PIN 확인(pin.js)이 끝나기 전에는 화면 내용이 한 프레임도 그려지지 않게 한다.
 * 정답·문제가 들어 있는 진행자 페이지는 반드시 <head>에 이 스크립트를 넣는다. pin.js 의 require() 가 끝나면 잠금을 푼다. */
(function () {
  document.documentElement.classList.add('stepi-locked');
  var st = document.createElement('style');
  st.textContent = 'html.stepi-locked{background:#373282}html.stepi-locked body>*:not(.pin-ov):not(.stepi-nodb){visibility:hidden!important}'
    + 'html.stepi-locked body::before{content:"🔒 진행자 확인 중…";position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:700 18px Pretendard,"Noto Sans KR",sans-serif;background:#373282;z-index:9980}';
  document.head.appendChild(st);
  window.STEPI_UNLOCK = function () { document.documentElement.classList.remove('stepi-locked'); };
  // 안전장치: 예전 버전 pin.js 가 캐시돼 unlock 을 안 부르더라도, PIN 모달(.pin-ov)이 닫히면 잠금을 푼다
  document.addEventListener('DOMContentLoaded', function () {
    var seen = false;
    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        m.addedNodes.forEach(function (n) { if (n.classList && n.classList.contains('pin-ov')) seen = true; });
        m.removedNodes.forEach(function (n) { if (n.classList && n.classList.contains('pin-ov') && seen) window.STEPI_UNLOCK(); });
      });
    }).observe(document.body, { childList: true });
  });
})();
