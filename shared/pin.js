/* 진행자 PIN 게이트 (window.sb 필요)
 *   const pin = await STEPI_PIN.require();   // 올바른 PIN 입력 때까지 모달. 반환값을 RPC 의 p_pin 으로 넘긴다
 *   STEPI_PIN.clear();                        // 로그아웃
 * PIN 은 sessionStorage 에만 두고(탭 닫으면 사라짐), 검증은 서버 RPC verify_pin 으로 한다. */
window.STEPI_PIN = (function () {
  const KEY = 'stepi:host-pin';
  const css = '.pin-ov{position:fixed;inset:0;z-index:9990;background:rgba(55,50,130,.9);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Pretendard,"Noto Sans KR",sans-serif}'
    + '.pin-box{background:#fff;color:#1b2230;border-radius:20px;padding:28px 24px;width:min(380px,100%);text-align:center}'
    + '.pin-box h2{margin:0 0 6px;color:#373282;font-size:20px}.pin-box p{margin:0 0 14px;color:#6b7280;font-size:14px}'
    + '.pin-box input{width:100%;font:inherit;font-size:28px;letter-spacing:.3em;text-align:center;padding:12px;border:1.5px solid #e3e6ef;border-radius:12px;margin-bottom:10px}'
    + '.pin-box button{width:100%;padding:13px;border:0;border-radius:12px;background:#373282;color:#fff;font:inherit;font-weight:700;font-size:16px;cursor:pointer}'
    + '.pin-box .msg{min-height:1.4em;color:#d6453d;font-size:14px;margin-top:8px}.pin-box a{display:block;margin-top:12px;color:#6b7280;font-size:13px}';
  function modal(role) {
    return new Promise(resolve => {
      const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
      const ov = document.createElement('div'); ov.className = 'pin-ov';
      ov.innerHTML = '<div class="pin-box"><h2>🔒 진행자 PIN</h2><p>' + (role === 'setup'
        ? 'PIN이 아직 설정되지 않았어요. 슈퍼관리자 페이지에서 먼저 설정하세요.'
        : '관리자에게 받은 PIN을 입력하세요') + '</p>'
        + '<input type="password" inputmode="numeric" placeholder="••••" autocomplete="off"><button>입장</button><div class="msg"></div>'
        + '<a href="' + base() + 'admin/">슈퍼관리자 (PIN 변경)</a><a href="' + base() + '">랜덤 게임 홈으로</a></div>';
      document.body.appendChild(ov);
      const inp = ov.querySelector('input'), btn = ov.querySelector('button'), msg = ov.querySelector('.msg');
      inp.focus();
      async function go() {
        const pin = inp.value.trim(); if (!pin) return;
        btn.disabled = true; msg.textContent = '확인 중…';
        const { data, error } = await sb.rpc('verify_pin', { p_pin: pin });
        btn.disabled = false;
        if (error) { msg.textContent = error.message; return; }
        if (data === 'setup') { msg.textContent = 'PIN 미설정 — 슈퍼관리자 페이지에서 설정하세요'; return; }
        if (!data) { msg.textContent = 'PIN이 틀렸어요'; inp.value = ''; inp.focus(); return; }
        try { sessionStorage.setItem(KEY, pin); } catch (e) {}
        ov.remove(); resolve(pin);
      }
      btn.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') go(); };
    });
  }
  function base() { const s = document.querySelector('script[src*="shared/pin.js"]'); return s ? s.src.replace(/shared\/pin\.js.*$/, '') : '../../'; }
  return {
    async require() {
      let pin = null; try { pin = sessionStorage.getItem(KEY); } catch (e) {}
      if (pin) { const { data } = await sb.rpc('verify_pin', { p_pin: pin }); if (data === 'admin' || data === 'super') return pin; }
      const { data: role } = await sb.rpc('verify_pin', { p_pin: null });
      return modal(role);
    },
    clear() { try { sessionStorage.removeItem(KEY); } catch (e) {} }
  };
})();
