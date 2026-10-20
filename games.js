/* ==========================================================
 * 게임 목록 — 새 게임을 추가할 때는 여기에 한 줄만 더하면 됩니다.
 *   id      : 폴더 이름 (games/<id>/)
 *   cat     : team | quiz | luck | activity | party | etc
 *   mode    : 'host'  진행자가 큰 화면에서 혼자 진행
 *             'multi' 참가자가 휴대폰으로 같이 접속 (Supabase 필요)
 *   players : 표시용 인원 문구
 * ========================================================== */
window.GAMES = [
  { id: 'teams', title: '두근두근 조 추첨', emoji: '🎈', cat: 'team', mode: 'host', players: '최대 100명',
    desc: '참가자 이름을 넣으면 버블 풀에서 한 명씩 뽑아 조에 배정해요. 카운트다운, 스포트라이트 연출, 속도 조절.',
    tags: ['조편성', '연찬회', '큰 화면'] },
  { id: 'marble', title: '마블 룰렛', emoji: '🎱', cat: 'luck', mode: 'host', players: '1명~',
    desc: '이름을 넣으면 구슬이 생기고, 맵을 굴러 내려와 결승선에 닿는 순서로 당첨자를 뽑아요. 3D 그래픽·슬로모션 연출.',
    tags: ['추첨', '순서 정하기', '큰 화면'] },
  { id: 'zoom', title: '확대 사진 퀴즈', emoji: '🔍', cat: 'quiz', mode: 'host', players: '여럿이 외치기',
    desc: '사진의 아주 작은 부분부터 보여주고 단계마다 조금씩 넓혀요. 진행자가 "더 보기"를 누르며 진행, 빨리 맞힐수록 높은 점수.',
    tags: ['사진', '진행자 모드', '큰 화면'] },
  { id: 'ox', title: '서바이벌 퀴즈 (OX·주관식)', emoji: '⭕', cat: 'quiz', mode: 'multi', players: '2~200명',
    desc: '진행자가 큰 화면에 문제를 내면 참가자가 휴대폰으로 O·X를 고르거나 글자로 답해요. 실시간 집계, 틀리면 탈락, 최후의 1인!',
    tags: ['휴대폰 참가', '실시간', 'QR 입장', '진행자 PIN'] },
  { id: 'kkomentle', title: '꼬멘틀', emoji: '🧠', cat: 'team', mode: 'multi', players: '여럿이 함께',
    desc: '정답 단어와의 의미 유사도만 보고 단어를 맞혀요. 모두의 추측이 한 표에 실시간으로 쌓여서 같이 좁혀 가는 협동 게임. 진행자가 정답을 직접 정할 수 있어요.',
    tags: ['휴대폰 참가', '협동', 'QR 입장', '진행자 PIN'] },
];
window.CATEGORIES = [
  { id: 'team',     name: '팀 빌딩 게임',    sub: '함께하는 즐거움,\n팀워크를 더 강하게!',    color: '#f5a623', bg: '#fff4e5' },
  { id: 'quiz',     name: '퀴즈 게임',       sub: '지식도 재미있게!\n두뇌를 깨워보세요.',     color: '#3b82f6', bg: '#e9f2ff' },
  { id: 'luck',     name: '행운의 랜덤 게임', sub: '운도 실력이다!\n랜덤으로 즐기는 깜짝 게임!', color: '#ec4899', bg: '#fde8f1' },
  { id: 'activity', name: '액티비티 게임',    sub: '움직이면 더 즐겁다!\n신체 활동으로 활력 충전!', color: '#16a34a', bg: '#e7f7ec' },
  { id: 'party',    name: '파티 게임',       sub: '웃음이 끊이지 않는\n신나는 시간!',          color: '#7c3aed', bg: '#efe9fb' },
  { id: 'etc',      name: '기타 게임',       sub: '이것저것 다 모였다!\n다양한 게임을 즐겨보세요.', color: '#2563eb', bg: '#e8f1fb' },
];
