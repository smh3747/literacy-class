-- ============================================
-- step151: feedback 정밀 RLS + user_id 컬럼 (step87 미적용분 포함)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 사전 조건: step146 헬퍼 함수. 동반 코드 수정 없음.
--
-- 🐛 버그 수정 포함: FeedbackModal이 로그인 시 user_id를 INSERT에 포함하는데
--    실제 DB에 user_id 컬럼이 없어(step87 마이그레이션 미적용 확인됨)
--    로그인 사용자의 "의견 보내기"가 실패하고 있었음. 컬럼 추가로 해결.
--
-- 목표 (feedback):
--   INSERT: 로그인 사용자 전원 (user_id는 본인 또는 null)
--   SELECT/UPDATE/DELETE: admin만
--
-- 나머지 테이블은 검토 결과 변경 불필요 (스냅샷 기준):
--   password_reset_requests: 익명 INSERT + admin SELECT/UPDATE 이미 적절
--   topic_suggestion_logs: step92.1+108 정책 적절 (DELETE 코드 없음 확인)
--   school_records / tutor_chat_usage: 기존 정책 적절
-- 롤백: step151-rollback.sql
-- ============================================

-- 1) user_id 컬럼 추가 (step87 내용 — 실제 DB에 미적용이었음)
alter table feedback
  add column if not exists user_id uuid references profiles(id) on delete set null;
create index if not exists idx_feedback_user_id on feedback(user_id);
comment on column feedback.user_id is '의견 작성자 (NULL이면 익명/구버전 의견)';

-- 2) RLS 정책
alter table feedback enable row level security;

drop policy if exists "feedback_all" on feedback;

-- INSERT: 로그인 사용자만, user_id는 본인 것(또는 미첨부)만
create policy "fb_insert" on feedback for insert to authenticated with check (
  user_id is null or user_id = auth.uid()
);

-- SELECT: admin만 (의견함)
create policy "fb_select" on feedback for select to authenticated using (
  (select public.is_admin())
);

-- UPDATE: admin만 (숨김/복원 처리)
create policy "fb_update" on feedback for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- DELETE: admin만 (현재 코드엔 없지만 관리용)
create policy "fb_delete" on feedback for delete to authenticated using (
  (select public.is_admin())
);

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'feedback';
--   → fb_insert / fb_select / fb_update / fb_delete 4행이어야 함
-- select column_name from information_schema.columns
--   where table_name = 'feedback' and column_name = 'user_id';
--   → 1행이어야 함
-- ============================================
