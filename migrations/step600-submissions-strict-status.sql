-- step600: 첫 채점 이중 호출(전용 맞춤법 검사 선행·주입) 상태 컬럼
-- Supabase SQL Editor에서 수동 실행. 멱등(IF NOT EXISTS)이라 중복 실행 안전.
--
-- strict_status 의미
--   null     : 이중 호출 도입 전 글(또는 컬럼 미적용 상태에서 저장된 글)
--   'done'   : 전용 검사 결과가 corrections에 반영됨
--   'pending': 교사 60초 가드(분당 피크)·429·타임아웃으로 전용 검사를 보류 → 보완 대상
--   'skipped': 전용 검사가 일반 실패해 보완하지 않음(error_logs에 원인)
--
-- ⚠️ 배포 순서 무관: 서버(pages/api/ai.js)가 컬럼 존재를 확인한 뒤에만 이중 호출을 켠다.
--    이 SQL을 적용하기 전에는 기능이 꺼진 채 기존 채점이 그대로 동작한다.

alter table submissions
  add column if not exists strict_status text
  check (strict_status is null or strict_status in ('done', 'pending', 'skipped'));

alter table submissions
  add column if not exists strict_at timestamptz;

-- 보완 큐 조회용(pending만 작게): 폴링·일일 스윕이 created_at 순으로 읽는다
create index if not exists idx_submissions_strict_pending
  on submissions (created_at)
  where strict_status = 'pending';

-- 확인
-- select strict_status, count(*) from submissions group by 1;
