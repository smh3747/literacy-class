-- ============================================
-- step136: 생기부 평어 저장 테이블
-- ============================================
-- 생성된 평어를 저장해두고 다시 열 때 토큰 없이 불러오기 위함.
-- 학생당 1행(최신 생성 결과). 다시 생성하면 덮어씀.

create table if not exists school_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  teacher_id uuid not null references profiles(id) on delete cascade,
  sentences jsonb not null default '[]'::jsonb,   -- 생성된 평어 문장 배열
  level text,                                      -- 당시 수준
  standards text,                                  -- 당시 성취기준
  created_at timestamptz not null default now(),
  unique (student_id)                              -- 학생당 1행 (최신본 유지)
);

create index if not exists idx_school_records_teacher on school_records(teacher_id);

-- RLS: 교사는 본인이 만든 평어만 보고/쓰기
alter table school_records enable row level security;

drop policy if exists "teacher manages own records" on school_records;
create policy "teacher manages own records" on school_records
  for all
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());
