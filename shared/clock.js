/* 서버 시계 동기화: server_time() RPC 를 여러 번 호출해 왕복 지연의 절반을 뺀 오차(ms)를 구한다.
 *   await STEPI_CLOCK.sync();          // 입장 시 한 번 (약 1초)
 *   STEPI_CLOCK.now()                   // 서버 기준 현재 시각(ms)
 *   STEPI_CLOCK.offset, STEPI_CLOCK.rtt // 진단용 */
window.STEPI_CLOCK = {
  offset: 0, rtt: null,
  async sync(n = 6) {
    const samples = [];
    for (let i = 0; i < n; i++) {
      const t0 = Date.now();
      const { data } = await sb.rpc('server_time');
      const t1 = Date.now();
      if (!data) continue;
      const rtt = t1 - t0, server = new Date(data).getTime();
      samples.push({ rtt, off: server - (t0 + rtt / 2) });
    }
    if (!samples.length) return;
    samples.sort((a, b) => a.rtt - b.rtt);
    const best = samples.slice(0, Math.max(1, Math.ceil(samples.length / 2)));   // 왕복이 짧은 절반만 사용
    this.offset = best.reduce((s, x) => s + x.off, 0) / best.length;
    this.rtt = samples[0].rtt;
  },
  now() { return Date.now() + this.offset; }
};
