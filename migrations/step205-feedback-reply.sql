-- ============================================
-- step205: 피드백 답변 컬럼 + SELECT 완화(작성자 본인 열람) + 학생 노출 토글
-- ============================================
-- 이 파일 전체 복붙 → Run → "Success" 확인. 그다음 step205-verify.sql 실행.
-- (앱 코드 변경은 별도 step. 이 파일은 스키마/정책만.)
--
-- 사전 조건: step146 헬퍼(is_admin), step151(feedback.user_id + fb_select 정책).
-- 보존: reply_* 4컬럼 nullable(기존 row 영향 0), classes 토글 default false(기존 학급 영향 0),
--       INSERT/UPDATE/DELETE 정책(admin write) 불변 — SELECT만 "admin → admin OR 본인" 완화.
-- 롤백: step205-rollback.sql
-- ============================================

-- 1) feedback 답변 컬럼 (멱등, nullable)
alter table feedback add column if not exists reply_text    text;
alter table feedback add column if not exists replied_at    timestamptz;
alter table feedback add column if not exists reply_by      uuid references profiles(id) on delete set null;
alter table feedback add column if not exists reply_read_at timestamptz;

-- 2) SELECT 완화 — admin 전체 + 작성자 본인(user_id=auth.uid())
--    ※ step151의 기존 정책명 'fb_select' 확인됨. INSERT/UPDATE/DELETE는 불변.
drop policy if exists "fb_select" on feedback;
create policy "fb_select" on feedback for select to authenticated using (
  (select public.is_admin())
  or user_id = auth.uid()
);

-- 3) 학생 노출 토글 (학급 단위, 기본 꺼짐)
alter table classes add column if not exists feedback_reply_visible_to_students boolean default false;
