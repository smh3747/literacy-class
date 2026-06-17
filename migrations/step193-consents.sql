-- ============================================
-- step193: 부모 동의 + 학급 동의비밀번호 (consents / classes.consent_password)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 실행 순서: 이 SQL을 먼저 실행 → 그다음 이를 사용하는 코드(부모 동의 페이지·API)를 배포.
--
-- 사전 조건:
--   - step146 헬퍼 함수(is_admin)가 이미 적용돼 있어야 함 (RLS 정책이 public.is_admin() 참조).
--   - step187(pending_names)이 적용돼 있어야 함 — 부모 동의 완료 시 서버(service_role)가
--     pending_names.enc_name 을 복호화해 profiles.realname 을 채우고, 이 consents 에 동의기록을 남긴다.
--
-- 배경: C방식(학급링크 + 자녀번호 + 학급 동의비밀번호 + 부모 서명)으로 부모 동의를 받는다.
--   비로그인 부모는 세션이 없으므로 /api/parent-consent (service_role) 경유로만 INSERT 한다.
--   따라서 consents 에는 INSERT 정책을 두지 않고(기본 deny), service_role 이 RLS 를 우회해 기록한다.
--   classes.consent_password 는 학급 단위 공유 비밀(login_default_password 패턴)로, 서버가 검증에만 사용.
--
-- 목표:
--   classes.consent_password : 학급 동의비밀번호 (평문 text, 교사·admin 만 RLS로 접근 — classes step149 정책).
--   consents : 부모 동의 이력(복수 허용). 소유 교사 + admin 만 SELECT. 부모는 직접 못 읽고/못 넣음.
--
-- 롤백: step193-rollback.sql
-- ============================================

-- 1) classes 에 학급 동의비밀번호 컬럼 (멱등)
alter table classes add column if not exists consent_password text;

-- 2) consents 테이블 생성 (멱등) — 이력 보존(복수 허용, student_id unique 아님)
create table if not exists consents (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid references profiles(id) on delete cascade,
  class_id      uuid references classes(id) on delete cascade,
  parent_name   text,
  signature     text,            -- base64 PNG 데이터URL (부모 서명 이미지)
  consent_items jsonb,           -- 동의 항목 배열 (예: ["terms","privacy","ai_processing"])
  consented_at  timestamptz default now()
);

-- 2.1) 컬럼 보강 (테이블이 이미 일부만 존재할 때 대비 — 멱등)
alter table consents add column if not exists student_id    uuid;
alter table consents add column if not exists class_id      uuid;
alter table consents add column if not exists parent_name   text;
alter table consents add column if not exists signature     text;
alter table consents add column if not exists consent_items jsonb;
alter table consents add column if not exists consented_at  timestamptz default now();

-- 2.2) 조회용 인덱스 (unique 아님 — 자녀당 복수 동의 이력 허용)
create index if not exists idx_consents_student on consents(student_id);
create index if not exists idx_consents_class   on consents(class_id);

-- 3) RLS 활성화
alter table consents enable row level security;

-- 4) 정책 (step153 class_secrets 구조 그대로 — classes.teacher_id 조인으로 소유 교사 판정)
drop policy if exists "consents_select" on consents;
drop policy if exists "consents_delete" on consents;

-- SELECT: admin 전체 / 소유 교사 본인 학급
create policy "consents_select" on consents for select to authenticated using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = consents.class_id and c.teacher_id = auth.uid()
  )
);

-- INSERT: 정책 없음 (의도적) — 부모(anon)는 직접 못 넣고, service_role API(/api/parent-consent)가 RLS 우회로만 기록.
--   RLS 기본 deny 이므로 authenticated 사용자의 직접 INSERT 도 차단된다.

-- DELETE: admin 만
create policy "consents_delete" on consents for delete to authenticated using (
  (select public.is_admin())
);

-- ============================================
-- 적용 확인:
-- select column_name from information_schema.columns
--   where table_name='classes' and column_name='consent_password';   -- 1행
-- select policyname, cmd from pg_policies where tablename='consents'; -- consents_select / consents_delete 2행
-- select relrowsecurity from pg_class where relname='consents';       -- t (RLS on)
-- ============================================
