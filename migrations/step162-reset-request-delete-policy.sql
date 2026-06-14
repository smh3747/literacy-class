-- ============================================
-- step162: password_reset_requests 삭제(DELETE) 정책 — admin만
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 배경: step119는 password_reset_requests에 INSERT/SELECT/UPDATE 정책만 만들었다.
--   DELETE 정책이 없어 RLS가 켜진 상태에서는 admin도 행을 삭제할 수 없다.
--   요청함 "삭제" 기능을 위해 admin DELETE 정책을 추가한다.
--
-- ⚠️ 실행 순서: 이 SQL을 먼저 실행 → 그다음 코드(step162) 배포.
--   (정책이 없으면 삭제 버튼이 "삭제 실패"로 떨어진다. 다른 기능은 영향 없음.)
-- RLS: 추가만 함(SELECT/UPDATE 기존 정책 유지). 멱등.
-- 롤백: step162-rollback.sql
-- ============================================

alter table password_reset_requests enable row level security;

drop policy if exists "Admin can delete reset requests" on password_reset_requests;
create policy "Admin can delete reset requests" on password_reset_requests
  for delete to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'password_reset_requests';
--   → SELECT / UPDATE / DELETE(admin) 정책이 보여야 함 (INSERT는 step156에서 제거됨)
-- ============================================
