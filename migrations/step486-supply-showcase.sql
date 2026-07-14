-- step486: 전국 공통 주제 3차(상위 글 공개) — ⚠️ 이미 Supabase에 적용됨(기록용, 실행 불필요)
-- 원칙: AI 검토(approved)만 본문 공개 / 본인 제출 후에만 열람 / 닉네임 표기 / 신고 즉시 비공개.
-- RLS는 ENABLE만 하고 정책을 만들지 않는다(전 접근 차단) — 읽기·쓰기 모두 서버 API(service role) 전용:
--   pages/api/supply-ranking.js(집계·검토), supply-report.js(신고), supply-showcase-admin.js(관리자).
-- unique(supply_topic_id, submission_id): 학생의 최고 제출이 바뀌면 새 submission_id로
--   새 pending 행이 생겨 자연스럽게 재검토된다(구 행은 잔존, 조회는 현재 최고 제출 행만 사용).

create table if not exists supply_showcase (
  id uuid primary key default gen_random_uuid(),
  supply_topic_id uuid not null references topics(id) on delete cascade,
  submission_id uuid not null references submissions(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  rank int not null,
  score int not null,
  review_status text not null default 'pending',  -- pending | approved | rejected
  review_reason text,
  hidden boolean not null default false,
  reported_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (supply_topic_id, submission_id)
);

alter table supply_showcase enable row level security;  -- 정책 없음 = 전 접근 차단(서버 전용)

-- 학급별 "우리 반 글 전국 소개 허용" 토글(기본 켬)
alter table classes add column if not exists showcase_enabled boolean not null default true;
