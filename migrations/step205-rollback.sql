-- ============================================
-- step205 롤백: 피드백 답변 컬럼 + SELECT 정책 원복 + 학생 토글 제거
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 주의: reply_text 등 작성된 답변 데이터가 함께 삭제됩니다(복구 불가). 롤백 전 백업 권장.
-- ============================================

-- 1) SELECT 정책을 step151 원형(admin만)으로 되돌림
drop policy if exists "fb_select" on feedback;
create policy "fb_select" on feedback for select to authenticated using (
  (select public.is_admin())
);

-- 2) feedback 답변 컬럼 제거 (답변 데이터 삭제됨)
alter table feedback drop column if exists reply_text;
alter table feedback drop column if exists replied_at;
alter table feedback drop column if exists reply_by;
alter table feedback drop column if exists reply_read_at;

-- 3) 학생 노출 토글 컬럼 제거
alter table classes drop column if exists feedback_reply_visible_to_students;

-- ============================================
-- 적용 확인:
-- select policyname, qual from pg_policies where tablename='feedback' and policyname='fb_select';
--   → qual 에 is_admin()만 (user_id 조건 없음)
-- select column_name from information_schema.columns
--   where table_name='feedback' and column_name like 'reply%';   -- 0행
-- select column_name from information_schema.columns
--   where table_name='classes' and column_name='feedback_reply_visible_to_students';  -- 0행
-- ============================================
