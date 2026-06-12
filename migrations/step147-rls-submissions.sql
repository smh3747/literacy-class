-- ============================================
-- step147: submissions 정밀 RLS (1순위 — 가장 민감한 학생 글)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 사전 조건: step146 헬퍼 함수 5개가 먼저 적용되어 있어야 합니다.
-- 적용 전 상태(스냅샷 확인됨): submissions_all (ALL, true/true) = 전면 개방.
--
-- 목표:
--   SELECT: 본인 / 같은 학급 구성원(랭킹용) / admin   ※ 비로그인 0행
--   INSERT: 본인(user_id=auth.uid())만
--   UPDATE: 본인 / 담임(교사 + 글쓴이가 내 학급) / admin
--   DELETE: 담임 / admin (학생은 소프트삭제=UPDATE만)
--
-- 알려진 트레이드오프: 같은 학급 학생끼리는 서로 행 전체를 읽을 수 있음
-- (랭킹 기능 때문. 추후 집계 RPC로 보강 예정 — RLS-POLICY-PLAN.md 6번)
-- 롤백: step147-rollback.sql
-- ============================================

-- RLS 활성화 (이미 켜져 있어도 안전)
alter table submissions enable row level security;

-- 기존 정책 제거 (스냅샷 기준 submissions_all / 방어적으로 step144 명칭도)
drop policy if exists "submissions_all"    on submissions;
drop policy if exists "submissions_select" on submissions;
drop policy if exists "submissions_write"  on submissions;
drop policy if exists "submissions_update" on submissions;
drop policy if exists "submissions_delete" on submissions;

-- SELECT: 본인 + 같은 학급(교사·학생 모두 커버) + admin
create policy "sub_select" on submissions for select to authenticated using (
  user_id = auth.uid()
  or (select public.is_admin())
  or public.is_my_classmate(user_id)
);

-- INSERT: 본인 글만
create policy "sub_insert" on submissions for insert to authenticated with check (
  user_id = auth.uid()
);

-- UPDATE: 본인(수정본·예시 저장) + 담임 + admin
create policy "sub_update" on submissions for update to authenticated
using (
  user_id = auth.uid()
  or (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and public.is_my_classmate(user_id))
)
with check (
  user_id = auth.uid()
  or (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and public.is_my_classmate(user_id))
);

-- DELETE: 담임 + admin (휴지통 영구삭제)
create policy "sub_delete" on submissions for delete to authenticated using (
  (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and public.is_my_classmate(user_id))
);

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'submissions';
--   → sub_select / sub_insert / sub_update / sub_delete 4행이어야 함
-- ============================================
