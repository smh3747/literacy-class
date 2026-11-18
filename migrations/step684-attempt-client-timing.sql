-- step684: 채점 시도 기록에 학생 화면이 잰 두 구간 추가
--   precheck_ms: [제출]을 누른 뒤 "이미 낸 글이 있는지" 확인 조회에 걸린 시간(이 조회는 시도 기록의 시작 시각보다 앞이라 wait_ms에 들어 있지 않다)
--   save_ms    : 채점 결과를 받은 뒤 글을 저장(insert)하는 데 걸린 시간(wait_ms 안에 들어 있다)
-- 실행: Supabase SQL Editor. 다시 실행해도 안전. 컬럼이 없어도 제출은 그대로 된다(서버가 이 두 값만 빼고 저장).
-- 되돌리기: alter table grading_attempts drop column if exists precheck_ms, drop column if exists save_ms;

alter table grading_attempts add column if not exists precheck_ms integer;
alter table grading_attempts add column if not exists save_ms integer;
