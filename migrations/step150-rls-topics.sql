-- ============================================
-- step150: topics 정밀 RLS (4순위)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 사전 조건: step146 헬퍼 함수. 동반 코드 수정 없음 (SQL만 적용하면 됨).
--
-- 목표:
--   SELECT: 소유 교사 / 내 학급 담임의 주제(학생) / admin   ※ 익명 0행
--   INSERT/UPDATE/DELETE: 소유 교사 / admin
--
-- 알려진 경미한 표시 저하 (의도된 수용):
--   공유 주제 추천 카드에서 타 교사 topic으로의 resulting_topic 조인이
--   null이 되어 "사용된 날짜" 배지만 안 보임. 카드 제목·내용은 로그
--   자체의 suggestions JSON에서 렌더링되므로 정상 표시됨.
-- 롤백: step150-rollback.sql
-- ============================================

alter table topics enable row level security;

-- 기존 정책 제거 (스냅샷 기준 topics_all / 방어적으로 step144 명칭도)
drop policy if exists "topics_all"    on topics;
drop policy if exists "topics_select" on topics;
drop policy if exists "topics_write"  on topics;
drop policy if exists "topics_update" on topics;
drop policy if exists "topics_delete" on topics;

-- SELECT: 소유 교사 + 내 학급 담임의 주제(학생용) + admin
create policy "top_select" on topics for select to authenticated using (
  teacher_id = auth.uid()
  or teacher_id = (select public.my_class_teacher_id())
  or (select public.is_admin())
);

-- INSERT: 본인 소유 주제만 (admin은 학급 정리 등 관리 작업용)
create policy "top_insert" on topics for insert to authenticated with check (
  teacher_id = auth.uid()
  or (select public.is_admin())
);

-- UPDATE: 소유 교사 + admin
create policy "top_update" on topics for update to authenticated
using (teacher_id = auth.uid() or (select public.is_admin()))
with check (teacher_id = auth.uid() or (select public.is_admin()));

-- DELETE: 소유 교사 + admin (admin은 학급 영구삭제 시 일괄 정리)
create policy "top_delete" on topics for delete to authenticated using (
  teacher_id = auth.uid()
  or (select public.is_admin())
);

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'topics';
--   → top_select / top_insert / top_update / top_delete 4행이어야 함
-- ============================================
