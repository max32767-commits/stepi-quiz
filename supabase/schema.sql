-- ============================================================
-- STEPI 랜덤 게임 — Supabase 스키마 (멀티플레이 게임 공통)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다.
--
--  1) 꼬멘틀 (단어 유사도 추측)  : words / rounds / guesses + 함수 5개
--  2) OX 서바이벌 퀴즈           : ox_rooms / ox_players / ox_answers
--
-- 레크리에이션용이라 로그인 없이 anon 키로 읽고 쓰도록 정책을 열어 둡니다.
-- (외부에 URL이 알려지면 누구나 쓸 수 있으니, 행사 끝나면 Project를 Pause 하세요)
-- ============================================================

-- ------------------------------------------------------------
-- 1. 꼬멘틀
-- ------------------------------------------------------------
create extension if not exists vector;

create table if not exists words (
  word       text primary key,
  embedding  vector(300) not null,
  candidate  boolean not null default false     -- 정답 후보로 쓸 흔한 단어
);
create index if not exists words_embedding_idx on words using hnsw (embedding vector_cosine_ops);

create table if not exists rounds (
  id          bigserial primary key,
  answer      text not null references words(word),
  created_by  text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz,
  winner      text,
  gave_up     boolean not null default false
);

create table if not exists guesses (
  id          bigserial primary key,
  round_id    bigint not null references rounds(id) on delete cascade,
  player      text not null,
  word        text not null,
  similarity  real not null,
  rank        int,                               -- 0=정답, 1..999=순위, null=1000위 밖
  created_at  timestamptz not null default now(),
  unique (round_id, player, word)
);
create index if not exists guesses_round_idx on guesses(round_id);

-- 정답 단어는 클라이언트가 직접 못 읽게: rounds.answer 는 함수로만 공개
alter table words   enable row level security;
alter table rounds  enable row level security;
alter table guesses enable row level security;
do $$ begin if not exists (select 1 from pg_policies where tablename='words' and policyname='words_read') then
  create policy words_read on words for select to anon, authenticated using (true); end if; end $$;
do $$ begin if not exists (select 1 from pg_policies where tablename='rounds' and policyname='rounds_read') then
  create policy rounds_read on rounds for select to anon, authenticated using (true); end if; end $$;
do $$ begin if not exists (select 1 from pg_policies where tablename='guesses' and policyname='guesses_read') then
  create policy guesses_read on guesses for select to anon, authenticated using (true); end if; end $$;
-- answer 컬럼은 뷰 없이도 함수(reveal_answer)로만 노출하도록 컬럼 권한을 뺀다
revoke select (answer) on rounds from anon, authenticated;

-- 현재 진행 중 라운드 id (없거나 끝났으면 새로 만든다)
create or replace function current_round(p_player text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare r bigint; w text;
begin
  select id into r from rounds where finished_at is null order by id desc limit 1;
  if r is not null then return r; end if;
  select word into w from words where candidate order by random() limit 1;
  if w is null then raise exception '단어 벡터가 아직 없습니다. supabase/upload_words.py 를 먼저 실행하세요.'; end if;
  insert into rounds(answer, created_by) values (w, p_player) returning id into r;
  return r;
end $$;

-- 정답과 1·10·1000번째로 가까운 단어의 유사도
create or replace function round_benchmarks(p_round bigint)
returns json language plpgsql security definer set search_path = public as $$
declare a vector(300); t1 real; t10 real; t1000 real;
begin
  perform set_config('enable_indexscan', 'off', true);  -- 정확한 순위를 위해 전체 스캔(수만 단어, 수십 ms)
  select w.embedding into a from rounds r join words w on w.word = r.answer where r.id = p_round;
  if a is null then return null; end if;
  select max(case when rn=1 then s end), max(case when rn=10 then s end), max(case when rn=1000 then s end)
    into t1, t10, t1000
  from (select 1 - (embedding <=> a) as s, row_number() over (order by embedding <=> a) as rn
        from (select embedding from words where embedding <=> a > 0 order by embedding <=> a limit 1000) k) x;
  return json_build_object('top1', t1, 'top10', t10, 'top1000', t1000);
end $$;

-- 추측 등록: 유사도·순위 계산, 정답이면 라운드 종료
create or replace function make_guess(p_round bigint, p_player text, p_word text)
returns json language plpgsql security definer set search_path = public as $$
declare a vector(300); ans text; e vector(300); sim real; rk int; fin timestamptz; w text := trim(p_word);
begin
  perform set_config('enable_indexscan', 'off', true);
  select answer, finished_at into ans, fin from rounds where id = p_round;
  if ans is null then raise exception '라운드가 없습니다'; end if;
  if fin is not null then raise exception '이미 끝난 라운드입니다.'; end if;
  select embedding into e from words where word = w;
  if e is null then raise exception '사전에 없는 단어입니다: %', w; end if;
  select embedding into a from words where word = ans;
  sim := 1 - (e <=> a);
  if w = ans then rk := 0;
  else
    select rn into rk from (
      select word, row_number() over (order by embedding <=> a) as rn
      from (select word, embedding from words where word <> ans order by embedding <=> a limit 1000) k) x
    where x.word = w;
  end if;
  insert into guesses(round_id, player, word, similarity, rank) values (p_round, p_player, w, sim, rk)
    on conflict (round_id, player, word) do nothing;
  if w = ans then
    update rounds set finished_at = now(), winner = p_player where id = p_round and finished_at is null;
  end if;
  return json_build_object('word', w, 'similarity', sim, 'rank', rk, 'correct', w = ans);
end $$;

-- 끝난 라운드의 정답 공개 (진행 중이면 null)
create or replace function reveal_answer(p_round bigint)
returns text language sql security definer set search_path = public as $$
  select answer from rounds where id = p_round and finished_at is not null;
$$;

-- 포기: 모두의 라운드 종료
create or replace function give_up(p_round bigint, p_player text)
returns text language plpgsql security definer set search_path = public as $$
declare ans text;
begin
  update rounds set finished_at = now(), gave_up = true, winner = null where id = p_round and finished_at is null;
  select answer into ans from rounds where id = p_round;
  return ans;
end $$;

grant execute on function current_round(text), round_benchmarks(bigint), make_guess(bigint,text,text),
  reveal_answer(bigint), give_up(bigint,text) to anon, authenticated;

-- ------------------------------------------------------------
-- 2. OX 서바이벌 퀴즈 (진행자 큰화면 + 참가자 모바일)
-- ------------------------------------------------------------
create table if not exists ox_rooms (
  code        text primary key,                 -- 4자리 방 코드
  phase       text not null default 'lobby',    -- lobby | question | reveal | end
  q_index     int  not null default -1,
  question    text,
  answer      text,                             -- 'O' | 'X' (공개 전엔 null)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists ox_players (
  id          bigserial primary key,
  room_code   text not null references ox_rooms(code) on delete cascade,
  name        text not null,
  alive       boolean not null default true,
  joined_at   timestamptz not null default now()
);
create index if not exists ox_players_room_idx on ox_players(room_code);
create table if not exists ox_answers (
  id          bigserial primary key,
  room_code   text not null references ox_rooms(code) on delete cascade,
  q_index     int  not null,
  player_id   bigint not null references ox_players(id) on delete cascade,
  choice      text not null check (choice in ('O','X')),
  created_at  timestamptz not null default now(),
  unique (room_code, q_index, player_id)
);
create index if not exists ox_answers_room_idx on ox_answers(room_code, q_index);

alter table ox_rooms   enable row level security;
alter table ox_players enable row level security;
alter table ox_answers enable row level security;
do $$ begin if not exists (select 1 from pg_policies where tablename='ox_rooms' and policyname='ox_rooms_all') then
  create policy ox_rooms_all on ox_rooms for all to anon, authenticated using (true) with check (true); end if; end $$;
do $$ begin if not exists (select 1 from pg_policies where tablename='ox_players' and policyname='ox_players_all') then
  create policy ox_players_all on ox_players for all to anon, authenticated using (true) with check (true); end if; end $$;
do $$ begin if not exists (select 1 from pg_policies where tablename='ox_answers' and policyname='ox_answers_all') then
  create policy ox_answers_all on ox_answers for all to anon, authenticated using (true) with check (true); end if; end $$;

-- 하루 지난 방 정리 (진행자가 "방 만들기" 할 때 호출)
create or replace function ox_cleanup() returns void language sql security definer set search_path = public as $$
  delete from ox_rooms where created_at < now() - interval '1 day';
$$;
grant execute on function ox_cleanup() to anon, authenticated;

-- Realtime 켜기 (이미 추가돼 있으면 오류 없이 넘어감)
do $$
begin
  begin alter publication supabase_realtime add table guesses;    exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table rounds;     exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table ox_rooms;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table ox_players; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table ox_answers; exception when duplicate_object then null; end;
end $$;
alter table ox_rooms replica identity full;
alter table ox_players replica identity full;
