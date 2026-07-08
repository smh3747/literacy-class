-- step415: 다음 걸음 카드(교사 온보딩 설문) 응답 테이블 — ⚠️ 이미 Supabase에 적용됨(기록용, 실행 불필요)
-- 교사 홈에서 막힌 지점별 카드(card_type별 평생 1회)에 대한 응답을 저장한다.
-- card_type: review(후기) | no_students(학생 등록 벽) | no_topics(주제 시작 벽) | no_class_run(첫 수업 벽)
-- response 코드: good·soso·bad(후기) / roster_hassle·consent_burden·just_looking(학생 등록) / clicked(버튼 클릭) / dismissed(✕ 닫음)

create table if not exists onboarding_responses (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  card_type text not null,
  response text not null,
  comment text,
  created_at timestamptz not null default now(),
  unique (teacher_id, card_type)   -- card_type별 평생 1회
);

alter table onboarding_responses enable row level security;

-- 본인 insert만 (수정·삭제는 정책 없음 = 차단. 카드가 단일 insert 원칙인 이유)
drop policy if exists onboarding_insert_own on onboarding_responses;
create policy onboarding_insert_own on onboarding_responses
  for insert with check (auth.uid() = teacher_id);

-- 본인 + admin select
drop policy if exists onboarding_select_own_or_admin on onboarding_responses;
create policy onboarding_select_own_or_admin on onboarding_responses
  for select using (
    auth.uid() = teacher_id
    or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- 검증: select card_type, response, count(*) from onboarding_responses group by 1, 2;
