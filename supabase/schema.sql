-- ============================================================
-- STEPI 랜덤 게임 — Supabase 스키마 (멀티플레이 게임 공통)
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다.
--
--  1) 꼬맨틀 (단어 유사도 추측)  : words / rounds / guesses + 함수 5개
--  2) OX 서바이벌 퀴즈           : ox_rooms / ox_players / ox_answers
--
-- 레크리에이션용이라 로그인 없이 anon 키로 읽고 쓰도록 정책을 열어 둡니다.
-- (외부에 URL이 알려지면 누구나 쓸 수 있으니, 행사 끝나면 Project를 Pause 하세요)
-- ============================================================

-- ------------------------------------------------------------
-- 1. 꼬맨틀
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

-- ------------------------------------------------------------
-- 3. 꼬맨틀 진행자 — 정답 직접 지정 (games/kkomentle/host.html)
--    PIN 을 걸고 싶으면 SQL Editor 에서:
--      insert into private_settings(key,value) values ('kkomentle_pin','1234') on conflict (key) do update set value=excluded.value;
-- ------------------------------------------------------------
create table if not exists private_settings (key text primary key, value text not null);
alter table private_settings enable row level security;   -- 정책 없음: 클라이언트에서 읽기·쓰기 불가

create or replace function start_round(p_word text, p_pin text default null, p_player text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare w text := trim(p_word); pin text; r bigint;
begin
  select value into pin from private_settings where key = 'kkomentle_pin';
  if pin is not null and (p_pin is null or p_pin <> pin) then raise exception 'PIN이 틀렸습니다'; end if;
  if w is null or w = '' then
    select word into w from words where candidate order by random() limit 1;
  elsif not exists (select 1 from words where word = w) then
    raise exception '사전에 없는 단어라 정답으로 쓸 수 없습니다: %', w;
  end if;
  update rounds set finished_at = now(), gave_up = true where finished_at is null;
  insert into rounds(answer, created_by) values (w, p_player) returning id into r;
  return r;
end $$;

create or replace function round_status()
returns json language sql security definer set search_path = public as $$
  select json_build_object('id', r.id, 'created_at', r.created_at, 'guesses', (select count(*) from guesses g where g.round_id = r.id),
                           'players', (select count(distinct player) from guesses g where g.round_id = r.id),
                           'has_pin', exists(select 1 from private_settings where key = 'kkomentle_pin'))
  from rounds r where r.finished_at is null order by r.id desc limit 1;
$$;
grant execute on function start_round(text, text, text), round_status() to anon, authenticated;

-- ------------------------------------------------------------
-- 4. 진행자 PIN 체계 + 진행자용 RPC (2026-10-21)
--    PIN 은 admin/ 페이지(슈퍼관리자)에서 설정·변경. 진행자 동작은 RPC 에서 PIN 검사.
--    OX 테이블은 anon 직접 쓰기 금지(RPC 로만), 읽기 허용, 답 제출만 insert 허용.
-- ------------------------------------------------------------
alter table ox_rooms add column if not exists qtype text not null default 'ox';   -- 'ox' | 'text'
alter table ox_answers drop constraint if exists ox_answers_choice_check;       -- 글자 정답 허용

create or replace function verify_pin(p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare s text; a text;
begin
  select value into s from private_settings where key = 'super_pin';
  select value into a from private_settings where key = 'admin_pin';
  if s is null and a is null then return 'setup';
  elsif p_pin is not null and p_pin = s then return 'super';
  elsif p_pin is not null and p_pin = a then return 'admin';
  else return null; end if;
end $$;

create or replace function set_pins(p_current_super text, p_new_admin text, p_new_super text default null)
returns text language plpgsql security definer set search_path = public as $$
declare s text;
begin
  select value into s from private_settings where key = 'super_pin';
  if s is not null and (p_current_super is null or p_current_super <> s) then raise exception '슈퍼관리자 PIN이 틀렸습니다'; end if;
  if p_new_admin is not null and length(trim(p_new_admin)) >= 4 then
    insert into private_settings(key, value) values ('admin_pin', trim(p_new_admin)) on conflict (key) do update set value = excluded.value;
  end if;
  if p_new_super is not null and length(trim(p_new_super)) >= 4 then
    insert into private_settings(key, value) values ('super_pin', trim(p_new_super)) on conflict (key) do update set value = excluded.value;
  elsif s is null then
    raise exception '최초 설정 시 슈퍼관리자 PIN(4자리 이상)이 필요합니다';
  end if;
  return 'ok';
end $$;

create or replace function require_host(p_pin text) returns void language plpgsql security definer set search_path = public as $$
declare r text := verify_pin(p_pin);
begin
  if r is null then raise exception 'PIN이 틀렸습니다'; end if;
  if r = 'setup' then raise exception 'PIN이 아직 설정되지 않았습니다. 슈퍼관리자 페이지(admin/)에서 먼저 설정하세요'; end if;
end $$;

create or replace function start_round(p_word text, p_pin text default null, p_player text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare w text := trim(p_word); r bigint;
begin
  perform require_host(p_pin);
  if w is null or w = '' then
    select word into w from words where candidate order by random() limit 1;
  elsif not exists (select 1 from words where word = w) then
    raise exception '사전에 없는 단어라 정답으로 쓸 수 없습니다: %', w;
  end if;
  update rounds set finished_at = now(), gave_up = true where finished_at is null;
  insert into rounds(answer, created_by) values (w, p_player) returning id into r;
  perform round_benchmarks(r);
  return r;
end $$;

create or replace function round_status()
returns json language sql security definer set search_path = public as $$
  select json_build_object('id', r.id, 'created_at', r.created_at,
     'guesses', (select count(*) from guesses g where g.round_id = r.id),
     'players', (select count(distinct player) from guesses g where g.round_id = r.id),
     'best', (select json_agg(json_build_object('player', player, 'word', word, 'similarity', similarity, 'rank', rank) order by similarity desc)
              from (select * from guesses g where g.round_id = r.id order by similarity desc limit 10) b))
  from rounds r where r.finished_at is null order by r.id desc limit 1;
$$;

create or replace function ox_create_room(p_pin text) returns text language plpgsql security definer set search_path = public as $$
declare c text; i int := 0;
begin
  perform require_host(p_pin);
  perform ox_cleanup();
  loop
    c := lpad((floor(random()*9000)+1000)::int::text, 4, '0');
    exit when not exists (select 1 from ox_rooms where code = c);
    i := i + 1; if i > 20 then raise exception '방 코드 생성 실패'; end if;
  end loop;
  insert into ox_rooms(code) values (c);
  return c;
end $$;

create or replace function ox_set_room(p_pin text, p_code text, p_phase text, p_q_index int, p_question text, p_answer text, p_qtype text default 'ox')
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_host(p_pin);
  update ox_rooms set phase = p_phase, q_index = p_q_index, question = p_question, answer = p_answer, qtype = coalesce(p_qtype,'ox'), updated_at = now() where code = p_code;
end $$;

create or replace function ox_set_alive(p_pin text, p_code text, p_ids bigint[], p_alive boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_host(p_pin);
  if p_ids is null then update ox_players set alive = p_alive where room_code = p_code;
  else update ox_players set alive = p_alive where room_code = p_code and id = any(p_ids); end if;
end $$;

create or replace function ox_join(p_code text, p_name text, p_pid bigint default null)
returns json language plpgsql security definer set search_path = public as $$
declare p ox_players; n text := left(trim(p_name), 12);
begin
  if not exists (select 1 from ox_rooms where code = p_code) then raise exception '그 코드의 방이 없어요'; end if;
  if n = '' then raise exception '이름을 입력하세요'; end if;
  if p_pid is not null then
    update ox_players set name = n where id = p_pid and room_code = p_code returning * into p;
    if found then return row_to_json(p); end if;
  end if;
  insert into ox_players(room_code, name) values (p_code, n) returning * into p;
  return row_to_json(p);
end $$;

grant execute on function verify_pin(text), set_pins(text,text,text), start_round(text,text,text), round_status(),
  ox_create_room(text), ox_set_room(text,text,text,int,text,text,text), ox_set_alive(text,text,bigint[],boolean), ox_join(text,text,bigint)
  to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='ox_rooms' and policyname='ox_rooms_read') then
    create policy ox_rooms_read on ox_rooms for select to anon, authenticated using (true); end if;
  if not exists (select 1 from pg_policies where tablename='ox_players' and policyname='ox_players_read') then
    create policy ox_players_read on ox_players for select to anon, authenticated using (true); end if;
  if not exists (select 1 from pg_policies where tablename='ox_answers' and policyname='ox_answers_read') then
    create policy ox_answers_read on ox_answers for select to anon, authenticated using (true); end if;
  if not exists (select 1 from pg_policies where tablename='ox_answers' and policyname='ox_answers_insert') then
    create policy ox_answers_insert on ox_answers for insert to anon, authenticated with check (true); end if;
end $$;
alter policy ox_rooms_all on ox_rooms using (false) with check (false);
alter policy ox_players_all on ox_players using (false) with check (false);
alter policy ox_answers_all on ox_answers using (false) with check (false);

-- ------------------------------------------------------------
-- 5. 스피드 퀴즈 (서바이벌 → 점수제): 서술형 답, 제한시간, 서버 채점, 정답 키는 비공개 ox_keys
-- ------------------------------------------------------------
alter table ox_rooms add column if not exists time_limit int not null default 30;
alter table ox_rooms add column if not exists q_started_at timestamptz;
alter table ox_players add column if not exists score int not null default 0;
alter table ox_answers add column if not exists correct boolean;
alter table ox_answers add column if not exists points int not null default 0;
alter table ox_answers add column if not exists elapsed_ms int;
alter table ox_answers drop constraint if exists ox_answers_room_code_q_index_player_id_key;   -- 재시도 허용
create index if not exists ox_answers_player_q_idx on ox_answers(room_code, q_index, player_id);
create table if not exists ox_keys (room_code text not null references ox_rooms(code) on delete cascade, q_index int not null, accept text not null, primary key (room_code, q_index));
alter table ox_keys enable row level security;
create or replace function ox_norm(t text) returns text language sql immutable as $$ select lower(regexp_replace(coalesce(t,''), '\s+', '', 'g')); $$;

drop function if exists ox_set_room(text,text,text,int,text,text,text);
create or replace function ox_set_room(p_pin text, p_code text, p_phase text, p_q_index int, p_question text, p_answer text, p_qtype text default 'text', p_accept text default null, p_time_limit int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform require_host(p_pin);
  update ox_rooms set phase = p_phase, q_index = p_q_index, question = p_question, answer = p_answer, qtype = coalesce(p_qtype,'text'),
    time_limit = coalesce(p_time_limit, time_limit),
    q_started_at = case when p_phase = 'question' then now() else q_started_at end,
    updated_at = now() where code = p_code;
  if p_phase = 'question' and p_accept is not null then
    insert into ox_keys(room_code, q_index, accept) values (p_code, p_q_index, p_accept)
      on conflict (room_code, q_index) do update set accept = excluded.accept;
  end if;
  if p_phase = 'lobby' then update ox_players set score = 0 where room_code = p_code; end if;
end $$;

create or replace function ox_submit(p_code text, p_q_index int, p_player_id bigint, p_answer text)
returns json language plpgsql security definer set search_path = public as $$
declare r ox_rooms; k text; ok boolean; el int; rk int; pts int := 0; sc int; prev ox_answers; a text := left(trim(p_answer), 40);
begin
  select * into r from ox_rooms where code = p_code;
  if r is null then raise exception '방이 없어요'; end if;
  if r.phase <> 'question' or r.q_index <> p_q_index then raise exception '지금은 답을 받지 않아요'; end if;
  el := extract(epoch from (now() - r.q_started_at)) * 1000;
  if el > (r.time_limit + 2) * 1000 then raise exception '시간이 끝났어요'; end if;
  select * into prev from ox_answers where room_code = p_code and q_index = p_q_index and player_id = p_player_id and correct order by id limit 1;
  if prev is not null then
    select score into sc from ox_players where id = p_player_id;
    return json_build_object('correct', true, 'points', prev.points, 'elapsed_ms', prev.elapsed_ms, 'already', true, 'score', sc);
  end if;
  select accept into k from ox_keys where room_code = p_code and q_index = p_q_index;
  ok := ox_norm(a) = any (select ox_norm(x) from unnest(string_to_array(coalesce(k,''), '/')) x);
  if ok then
    select count(*) + 1 into rk from ox_answers where room_code = p_code and q_index = p_q_index and correct;
    pts := 50 + round(50 * greatest(0, 1 - el::numeric / (r.time_limit * 1000))) + case rk when 1 then 30 when 2 then 20 when 3 then 10 else 0 end;
    update ox_players set score = score + pts where id = p_player_id returning score into sc;
  else
    select score into sc from ox_players where id = p_player_id;
  end if;
  insert into ox_answers(room_code, q_index, player_id, choice, correct, points, elapsed_ms) values (p_code, p_q_index, p_player_id, a, ok, pts, el);
  return json_build_object('correct', ok, 'points', pts, 'rank', case when ok then rk end, 'elapsed_ms', el, 'score', sc);
end $$;
grant execute on function ox_set_room(text,text,text,int,text,text,text,text,int), ox_submit(text,int,bigint,text) to anon, authenticated;
alter policy ox_answers_insert on ox_answers with check (false);   -- 제출은 RPC 로만

-- ------------------------------------------------------------
-- 6. 실시간 로또 (lotto_rooms / lotto_players + RPC) — 실제 정의는 Supabase migrations 참고
--    lotto_create_room(pin,n1,n2,n3) → code / lotto_join / lotto_pick / lotto_set_phase / lotto_draw_next(서버 난수) / lotto_finish(순위 확정)
-- ------------------------------------------------------------

-- ---------------------------------------------------------------- 공통점 찾기 (cm_*)
-- 테이블: cm_rooms(code, phase lobby|q|reveal|done, q_no, questions jsonb [{q,a,b}]) / cm_players(id, room_code, name) / cm_answers(room_code, q_no, player_id, choice a|b, unique)
-- RPC: cm_create_room(pin, questions) → code / cm_join(code, name, pid) / cm_answer(code, q, pid, choice) (phase='q'·q_no 일치할 때만)
--      cm_set_phase(pin, code, phase, q) (lobby면 답 초기화) / cm_tally(code, q) → {a:[names], b:[names], answered, players}
--      cm_matches(code, pid, limit) → 나와 일치 수 많은 순 / cm_top_pairs(code, limit) → 전체 짝 중 일치 수 많은 순
-- 전체 정의는 Supabase 마이그레이션 common_ground_game 참고

-- 꼬맨틀 성능: words_embedding_idx(HNSW, 201MB)가 shared_buffers(224MB)에서 밀려나면 첫 검색이 10초+ → 타임아웃.
--   warm_up() : pg_prewarm 으로 인덱스를 미리 읽어 둠 (host.html 이 열릴 때·4분마다 호출), start_round 도 벤치마크 전에 prewarm
--   anon 역할 statement_timeout 45s (기본 8s)
--   words_h(word, emb halfvec(300)) 84MB + words_h_emb_idx(HNSW halfvec) 113MB : 검색 전용. make_guess/round_benchmarks 는 이 테이블만 읽고,
--   words(float 벡터 169MB)는 후보 추첨(candidate)·진행자 단어 찾기에만 쓴다. warm_up() 은 words_h 힙+인덱스를 prewarm.
--   부하 테스트: 200회 연속 추측 avg 16ms / p95 17ms / max 29ms (캐시 적중 시). 50명이 3초마다 추측해도 CPU 30% 수준.

-- 스피드 퀴즈 채점 정규화 ox_norm(t): 소문자화 + 공백·문장부호·기호 제거(한글/영문/숫자만 남김) + 전각 영숫자 → 반각. 정답 후보(/ 구분)와 제출 답 양쪽에 적용.

-- ---------------------------------------------------------------- 눈치 게임 (nz_*) / 인간 스톱워치 (sw_*)
-- nz_rooms(code, phase lobby|round|result|done, round_no, total_rounds, window_ms) / nz_players / nz_presses(ts 서버시각, unique round·player) / nz_results(number, status ok|collide|last|silent, points)
-- RPC nz_create_room(pin, rounds, window) / nz_join / nz_start_round(pin, code) / nz_press(code, round, pid) → {number, ts} / nz_end_round(pin, code) → 결과 / nz_round_results / nz_set_phase
-- sw_rooms(code, phase, round_no, total_rounds, mode fixed|random, target_ms, started_at) / sw_players / sw_results(elapsed_ms, error_ms, points)
-- RPC sw_create_room(pin, rounds, mode, target) / sw_join / sw_start_round(pin, code) → {round_no, target_ms} / sw_submit(code, round, pid, elapsed_ms) / sw_end_round / sw_round_results / sw_set_phase
-- 전체 정의는 마이그레이션 nunchi_and_stopwatch 참고
