-- ============================================
-- step205 검증: step205-feedback-reply.sql 적용 확인
-- ============================================
-- 이 파일 전체 복붙 → Run. 아래 4개 결과를 한 번에 확인한다.
-- ============================================

-- ① feedback 답변 4컬럼 생겼는지 (4행이어야 함)
select 'feedback reply cols' as check, column_name, data_type
from information_schema.columns
where table_name = 'feedback'
  and column_name in ('reply_text','replied_at','reply_by','reply_read_at')
order by column_name;

-- ② fb_select 정책이 admin OR user_id=auth.uid() 로 바뀌었는지
--    (qual 에 is_admin() 와 (user_id = auth.uid()) 가 함께 보여야 함)
select 'fb_select policy' as check, policyname, cmd, qual
from pg_policies
where tablename = 'feedback' and policyname = 'fb_select';

-- ③ feedback 정책이 4개(insert/select/update/delete) 그대로인지
--    (fb_insert / fb_select / fb_update / fb_delete 4행, write 정책 보존 확인)
select 'feedback policies' as check, policyname, cmd
from pg_policies
where tablename = 'feedback'
order by cmd, policyname;

-- ④ classes 학생 노출 토글 컬럼 생겼는지 (1행, default false)
select 'classes toggle' as check, column_name, column_default
from information_schema.columns
where table_name = 'classes' and column_name = 'feedback_reply_visible_to_students';
