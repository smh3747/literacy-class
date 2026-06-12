-- ============================================
-- step148: profiles 정밀 RLS (2순위 — 개인정보)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 사전 조건: step146 헬퍼 함수. 적용 전 상태: profiles_all (전면 개방).
--
-- 목표:
--   SELECT: 본인 / 같은 학급 구성원 / admin   ※ 비로그인 0행
--   INSERT: 본인 행(id=auth.uid())만 (가입 직후 자기 프로필 생성)
--   UPDATE: 본인 / 담임(대상이 내 학급 student) / admin
--   DELETE: admin만 (교사는 숨김 처리, 영구삭제는 admin·cron)
--
-- ⚠️ 동반 코드 수정 필요 (같은 커밋에 포함):
--   1. student/login.js — 닉네임 중복확인을 profile INSERT 후로 이동
--      (INSERT 전엔 my_class_id()가 null이라 동급생 조회가 빈 결과)
--   2. api/verify-code.js — admin 중복가입 확인을 서버로 이동
--      (비로그인 클라이언트의 profiles SELECT가 차단되므로)
--
-- 롤백: step148-rollback.sql
-- ============================================

alter table profiles enable row level security;

-- 기존 정책 제거 (스냅샷 기준 profiles_all / 방어적으로 step144 명칭도)
drop policy if exists "profiles_all"    on profiles;
drop policy if exists "profiles_select" on profiles;
drop policy if exists "profiles_write"  on profiles;
drop policy if exists "profiles_update" on profiles;
drop policy if exists "profiles_delete" on profiles;

-- SELECT: 본인 + 같은 학급 + admin
create policy "prof_select" on profiles for select to authenticated using (
  id = auth.uid()
  or (select public.is_admin())
  or (class_id is not null and class_id = (select public.my_class_id()))
);

-- INSERT: 본인 행만 (가입 직후)
create policy "prof_insert" on profiles for insert to authenticated with check (
  id = auth.uid()
);

-- UPDATE: 본인 + 담임(내 학급 학생만) + admin
create policy "prof_update" on profiles for update to authenticated
using (
  id = auth.uid()
  or (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and role = 'student'
      and class_id is not null and class_id = (select public.my_class_id()))
)
with check (
  id = auth.uid()
  or (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and role = 'student'
      and class_id is not null and class_id = (select public.my_class_id()))
);

-- DELETE: admin만
create policy "prof_delete" on profiles for delete to authenticated using (
  (select public.is_admin())
);

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'profiles';
--   → prof_select / prof_insert / prof_update / prof_delete 4행이어야 함
-- ============================================
