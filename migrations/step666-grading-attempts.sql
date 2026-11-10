-- step666: 채점 대기 측정을 "제출 시작" 기준으로 — 학생이 [제출]을 누른 시도를 1행으로 기록한다.
-- 배경: submissions.grading_ms는 결과를 받은 시도만 재서, 실패하거나 포기한 시도가 어디에도 남지 않았다(11/10 신양초 6-3 미제출 10명이 채점 시간 칩에 0건).
-- 적용: Supabase SQL Editor에서 수동 실행. 멱등(여러 번 실행해도 안전).
-- 개인정보: 글 본문·실명·번호를 저장하지 않는다. id 3개(user_id·class_id·topic_id)와 시각·횟수만.
-- 쓰기·읽기: 서비스 롤 전용(pages/api/grading-attempt.js, 관리자 집계 API). RLS를 켜고 정책을 두지 않아 브라우저에서는 읽기·쓰기가 모두 막힌다.
-- 이어 붙이기 규칙(코드): 같은 user_id·topic_id·attempt의 미완료 행이 있고 last_try_at이 30분 안이면 새 행 대신 tries만 +1.
-- 원인 분류는 이 표에 쓰지 않는다. 집계할 때 error_logs(같은 user_id, started_at~last_try_at 사이 서버 오류)와 맞춘다.

create table if not exists grading_attempts (
  id uuid primary key default gen_random_uuid(),
  -- 누른 학생(profiles.id). 실명·번호는 저장하지 않는다.
  user_id uuid not null,
  -- 학생의 학급(classes.id). 반별 집계용.
  class_id uuid,
  -- 글쓰기 주제(topics.id).
  topic_id uuid not null,
  -- 단계. 'first'는 첫 글, 'rewrite'는 수정본.
  phase text not null check (phase in ('first', 'rewrite')),
  -- submissions.attempt와 같은 번호(첫 글 1, 수정본 2 이상).
  attempt integer not null default 1,
  -- 첫 누름 시각(서버 시각).
  started_at timestamptz not null default now(),
  -- 마지막 누름 시각(서버 시각). 다시 누를 때마다 갱신.
  last_try_at timestamptz not null default now(),
  -- 누른 횟수. 처음 1, 이어 붙을 때마다 +1.
  tries integer not null default 1,
  -- 결과 수신 시각. null이면 결과를 못 받은 시도.
  finished_at timestamptz,
  -- 진짜 대기(ms). finished_at - started_at.
  wait_ms integer,
  -- 채점 경로. submissions.grading_path와 같은 값.
  path text,
  -- 성공해서 만들어진 제출 행(submissions.id).
  submission_id uuid
);

-- 관리자 집계(최근 14일)용.
create index if not exists idx_grading_attempts_started on grading_attempts (started_at desc);
-- 미완료 행 찾기(이어 붙이기·성공 시 채우기)용.
create index if not exists idx_grading_attempts_open on grading_attempts (user_id, topic_id, attempt) where finished_at is null;

alter table grading_attempts enable row level security;

-- 검증 1: select count(*) from grading_attempts;  → 0
-- 검증 2: select column_name from information_schema.columns where table_name = 'grading_attempts' order by ordinal_position;  → 13행
-- 검증 3: select relrowsecurity from pg_class where relname = 'grading_attempts';  → true
-- 검증 4: select count(*) from pg_policies where tablename = 'grading_attempts';  → 0
