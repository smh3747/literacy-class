-- ============================================
-- step153: 학급 API 키 서버 격리 (class_secrets 분리)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 실행 순서: 이 SQL을 먼저 실행 → 그다음 코드(step153) 배포.
--   (테이블·데이터가 있는 상태에서 새 서버 코드가 올라와야 안전.
--    코드가 먼저 올라가도 서버는 classes.api_key 폴백이 있어 안 끊김.)
--
-- 사전 조건: step146 헬퍼 함수(is_admin 등)가 이미 적용돼 있어야 함.
--
-- 배경: Gemini API 키가 classes.api_key에 있고 step149 RLS상 같은 학급 학생도
--   SELECT 가능 + ApiKeyManager가 localStorage에도 저장 → 학생 브라우저에 키 노출.
--   이를 막기 위해 키를 교사·admin만 접근 가능한 class_secrets로 분리한다.
--
-- 목표:
--   class_secrets: 학급당 1행. 소유 교사(classes.teacher_id=auth.uid())와 admin만 접근.
--   학생은 어떤 작업도 불가. AI 호출은 /api/ai가 service_role로 키를 조회해 사용.
--
-- 2단계 배포: 이번 step153은 class_secrets 생성·이관까지만.
--   classes.api_key는 "폴백용 동결 데이터"로 남겨둔다 (NULL로 비우지 않음).
--   classes.api_key 비우기 + 서버 폴백 제거는 안정화 후 step154에서 수행.
-- 롤백: step153-rollback.sql
-- ============================================

-- 1) 테이블 생성 (멱등)
create table if not exists class_secrets (
  class_id uuid primary key references classes(id) on delete cascade,
  api_key text,
  updated_at timestamptz default now()
);

-- 2) RLS 활성화
alter table class_secrets enable row level security;

-- 3) 정책: 소유 교사 + admin만 전 작업. 학생은 0행/거부.
drop policy if exists "csec_select" on class_secrets;
drop policy if exists "csec_insert" on class_secrets;
drop policy if exists "csec_update" on class_secrets;
drop policy if exists "csec_delete" on class_secrets;

-- SELECT: admin 전체 / 소유 교사 본인 학급
create policy "csec_select" on class_secrets for select to authenticated using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = class_secrets.class_id and c.teacher_id = auth.uid()
  )
);

-- INSERT: 본인이 소유한 학급의 행만 (admin은 무제한)
create policy "csec_insert" on class_secrets for insert to authenticated with check (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = class_secrets.class_id and c.teacher_id = auth.uid()
  )
);

-- UPDATE: 소유 교사 + admin
create policy "csec_update" on class_secrets for update to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = class_secrets.class_id and c.teacher_id = auth.uid()
  )
)
with check (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = class_secrets.class_id and c.teacher_id = auth.uid()
  )
);

-- DELETE: 소유 교사 + admin
create policy "csec_delete" on class_secrets for delete to authenticated using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = class_secrets.class_id and c.teacher_id = auth.uid()
  )
);

-- 4) 데이터 이관: 기존 classes.api_key → class_secrets (중복 실행 안전)
insert into class_secrets (class_id, api_key)
select id, api_key from classes
where api_key is not null
on conflict (class_id) do update set api_key = excluded.api_key, updated_at = now();

-- ⚠️ classes.api_key는 이번 step에서 비우지 않는다 (폴백용으로 동결 유지).
--    step154에서 update classes set api_key = null 수행 예정.

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'class_secrets';
--   → csec_select / csec_insert / csec_update / csec_delete 4행이어야 함
-- select count(*) from class_secrets;        -- 키 등록된 학급 수와 일치해야 함
-- select count(*) from classes where api_key is not null;  -- 위와 같아야 함
-- ============================================
