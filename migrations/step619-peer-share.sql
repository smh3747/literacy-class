-- step619: 우리 반 글 모음 1단계 — 학급 설정 2컬럼 + 교사 선택(추가/제외) 테이블
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run (멱등 — 중복 실행 안전)
--
-- 근거: 학부모 동의서 4조 "학생·교사가 공유를 선택한 글에 한해 익명(닉네임) 공유" — 교사의 켜기가 '선택'.
-- 동작: 주제별 학생 최고점(attempt ≤ 2) 상위 5편 + 교사 추가/제외를 서버(/api/peer-share)가 산출해
--       같은 학급 학생에게 닉네임·본문만 보여 준다(ON + 본인 제출 있을 때만). 선정 규칙은 lib/peerShareSelect.js.
-- 미적용 시: API가 enabled=false로 응답해 학생 화면은 그대로이고, 교사 켜기 버튼만 안내 오류가 난다.

-- 1) 학급 설정: 켜기/끄기(기본 OFF) + 친구 글에 점수 표시(기본 OFF)
alter table classes add column if not exists peer_share_enabled boolean not null default false;
alter table classes add column if not exists peer_share_show_score boolean not null default false;

-- 2) 교사 선택: 주제·제출 단위 add(추가) / exclude(자동 선정에서 제외). (topic_id, submission_id) 1행.
create table if not exists peer_share_overrides (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id) on delete cascade,
  submission_id uuid not null references submissions(id) on delete cascade,
  action text not null check (action in ('add', 'exclude')),
  teacher_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (topic_id, submission_id)
);
create index if not exists idx_peer_share_overrides_topic on peer_share_overrides(topic_id);

-- 3) RLS: 정책 없음 = 전 접근 차단(서버 전용). 읽기·쓰기 모두 /api/peer-share가 담임 검증 후 service role로 수행.
--    (supply_showcase step486과 같은 관행. 학생은 어떤 경로로도 이 표를 읽지 못한다.)
alter table peer_share_overrides enable row level security;

-- 검증:
--   select column_name from information_schema.columns where table_name='classes' and column_name like 'peer_share%';  → 2행
--   select count(*) from peer_share_overrides;  → 0
--   select policyname from pg_policies where tablename='peer_share_overrides';  → 0행(의도)
