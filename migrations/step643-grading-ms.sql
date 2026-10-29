-- step643: 채점 대기 시간 실측 컬럼 2개 (선택 적용 — 미적용이어도 앱은 정상, 측정값만 안 쌓임)
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run (멱등)
--
-- 배경: 학생이 제출 버튼을 누른 뒤 AI 결과를 받기까지 실제로 몇 초 기다렸는지 어디에도 남지 않았다
--       (Vercel 로그 1시간 보존, [perf] 로그는 콘솔). 클라이언트가 측정해 제출 행에 별도 update로 적는다.
--       코드는 이 두 컬럼 update를 insert와 분리해 시도하고 실패(컬럼 없음)는 무시한다.
--   grading_ms   : 제출 확인 통과 → AI 결과 수신까지 ms (중복 확인·수정 횟수 조회 포함, 확인 대화상자 시간 제외)
--   grading_path : 'inline' | 'pending'(피크로 전용 검사 보류) | 'fallback'(보조 모델) | 'retry_N'(서버 재시도 N회)
--                  | 'error_then_retry'(실패 뒤 학생이 다시 눌러 성공). 한 값만, 우선순위 error_then_retry>fallback>retry>pending>inline
alter table submissions add column if not exists grading_ms integer;
alter table submissions add column if not exists grading_path text;

-- 검증: select column_name from information_schema.columns where table_name='submissions' and column_name in ('grading_ms','grading_path');  → 2행
-- 집계 예: select (created_at at time zone 'Asia/Seoul')::date d, count(*) n,
--             percentile_cont(0.5) within group (order by grading_ms) p50,
--             percentile_cont(0.95) within group (order by grading_ms) p95, max(grading_ms) mx,
--             count(*) filter (where grading_ms > 60000) over60
--           from submissions where grading_ms is not null and deleted_at is null group by 1 order by 1 desc;
