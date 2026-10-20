# STEPI 랜덤 게임

과학기술정책연구원(STEPI) 레크리에이션 게임 모음. 프레임워크·빌드 없이 HTML/CSS/JS만으로 만들어 **GitHub Pages에서 바로 동작**합니다.

- 허브: `https://max32767-commits.github.io/stepi-quiz/`
- 진행자는 노트북을 큰 화면에 띄워 진행하고, 참가자는 휴대폰으로 접속합니다.
- 단발성 게임이라 결과를 저장하지 않습니다. 여러 명이 동시에 접속하는 게임만 Supabase(무료)를 씁니다.

## 게임

| 게임 | 방식 | DB | 설명 |
|---|---|---|---|
| 🎈 두근두근 조 추첨 `games/teams` | 진행자 혼자 | 없음 | 버블 풀에서 한 명씩 뽑아 조 편성 (연찬회용) |
| 🎱 마블 룰렛 `games/marble` | 진행자 혼자 | 없음 | 구슬이 맵을 굴러 내려와 결승선 순서로 당첨자 추첨 (3D) |
| 🔍 확대 사진 퀴즈 `games/zoom` | 진행자 혼자 | 없음 | 사진을 단계별로 넓혀 보여주며 맞히기 |
| ⚡ 스피드 퀴즈 `games/ox` | 진행자 큰 화면 + 참가자 휴대폰 | Supabase | 주관식(또는 OX) 정답을 폰으로 제출, 빨리 맞힐수록 높은 점수, 총점 1위 우승 |
| 🧠 꼬멘틀 `games/kkomentle` | 여럿이 휴대폰 | Supabase | 단어 의미 유사도 추측 협동 게임 |

새 게임 추가: `games/<id>/index.html` 폴더를 만들고 `games.js` 배열에 한 줄 추가. 각 게임 페이지 끝에 `<script src="../../shared/home.js"></script>`를 넣으면 "랜덤 게임 홈" 버튼이 붙습니다.

## 배포 (GitHub Pages)

1. 저장소 Settings → Pages → Build and deployment: **Deploy from a branch**, Branch `main` / `(root)` → Save
2. 1~2분 뒤 위 주소로 접속

## 멀티플레이 설정 (OX 퀴즈·꼬멘틀) — 설정 완료

Supabase 프로젝트 `stepi-quiz`에 연결돼 있고(`shared/supabase-config.js`), 스키마와 꼬멘틀 단어 벡터(68,550단어 · 정답 후보 3,260개)까지 올라가 있어 바로 동작합니다.

다른 프로젝트로 옮길 때:
1. SQL Editor에 `supabase/schema.sql` 전체를 붙여넣고 Run
2. Project Settings → API의 **Project URL**과 **publishable(anon)** 키를 `shared/supabase-config.js`에 입력 후 커밋
   - 공개돼도 되는 키입니다. **service_role 키는 절대 넣지 마세요.**
3. (꼬멘틀만) 단어 벡터 업로드 — `supabase/upload_words.py` 상단 설명대로 한 번 실행

> 레크리에이션용이라 로그인 없이 누구나 쓰도록 DB 정책을 열어 두었습니다. 행사 후에는 Supabase 프로젝트를 Pause 해 두세요.

## 진행자 PIN (OX 퀴즈·꼬멘틀 공통)

- 진행자 화면(`games/ox/host.html`, `games/kkomentle/host.html`)은 **진행자 PIN**을 넣어야 열리고, 라운드 열기·방 운영 같은 동작은 서버(RPC)에서도 PIN을 검사합니다. URL만 안다고 정답을 보거나 게임을 조작할 수 없습니다.
- PIN 설정·변경: **`admin/`** (슈퍼관리자 페이지). 처음 한 번 슈퍼관리자 PIN과 진행자 PIN을 정하고, 이후엔 슈퍼관리자 PIN으로 언제든 바꿉니다. 배포 직후 반드시 먼저 설정하세요.

## 꼬멘틀 사용법

- 진행자: `games/kkomentle/host.html` (PIN) → 화면의 QR을 참가자에게 보여주고, **정답 단어를 넣어 새 라운드**를 엽니다 (사전 12.8만 단어 중에서만, 앞글자 찾기 지원). 비우면 랜덤 정답. 새 라운드를 열면 진행 중 라운드는 종료되고 그 정답이 공개됩니다.
- 참가자: QR 또는 `games/kkomentle/play.html` 에서 이름 입력 후 단어 추측. 모두 같은 라운드에 참여합니다.
- 사전에 없는 단어를 정답으로 쓰려면: fastText에 있는 단어는 `supabase/make_word_sql.py` 로 SQL을 만들어 SQL Editor에서 실행, 없는 신조어는 관련 단어 벡터의 평균으로 합성(예: 부캉이).

## 스피드 퀴즈 사용법

- 진행자: `games/ox/host.html` (PIN) → 문제 입력(한 줄에 `문제|정답`, 복수 정답은 `/`, OX 문제는 `|O`/`|X`) → 제한시간 설정 → **방 만들기** → QR/코드로 참가자 입장 → **게임 시작**
- 문제마다 제한시간이 돌고, 참가자는 폰으로 답을 제출합니다(틀리면 재시도 가능). 채점은 서버에서 하며 정답 키는 클라이언트에 내려가지 않습니다.
- 점수: 정답 50점 + 속도 보너스(남은 시간 비례, 최대 50) + 순위 보너스(1등 30·2등 20·3등 10). 시간이 끝나면 자동 공개, 모든 문제 후 총점 순위 발표.

## 로컬 실행

```
python3 -m http.server 8000   # http://localhost:8000
```
(`file://`로 열어도 되지만, Supabase를 쓰는 게임은 http(s)로 열어야 합니다.)
