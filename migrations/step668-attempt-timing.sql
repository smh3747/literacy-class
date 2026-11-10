-- step668: 채점 구간별 시간 계측 — grading_attempts에 구간 4개를 따로 기록한다.
-- 배경: 혼잡 오류가 없는 날에도 글의 약 10%가 15초를 넘는데, 호출 횟수·글 길이·동시 제출로 설명되지 않는다(11/10 분석). DB에는 합계만 있어 어느 구간이 늘어지는지 알 수 없었다.
-- 적용: Supabase SQL Editor에서 수동 실행. 멱등(여러 번 실행해도 안전). 기존 행은 네 컬럼 모두 null로 남는다.
-- 순서: 코드가 먼저 배포돼도 안전하다. 컬럼이 없으면 기록 API가 기존 값만 저장한다. 이 SQL을 적용한 뒤의 제출부터 구간 값이 쌓인다.
-- 개인정보: 시간(ms) 숫자뿐이다.

-- 분당 한도 보호(쓰로틀)에서 기다린 시간(ms). 맞춤법 검사 호출과 채점 호출의 합.
alter table grading_attempts add column if not exists queue_ms integer;
-- 맞춤법 전용 검사 구간(ms). 가드 조회와 검사 호출을 합친 값. 피크로 건너뛰면 0에 가깝고 수정본은 0이다.
alter table grading_attempts add column if not exists strict_ms integer;
-- 채점 호출 구간(ms). 재시도와 모델 전환을 포함하고 쓰로틀 대기는 뺀 값.
alter table grading_attempts add column if not exists grade_ms integer;
-- 서버(/api/ai)가 요청 하나를 처리한 전체 시간(ms). wait_ms에서 이 값을 빼면 네트워크·함수 기동·제출 전 조회 시간이 나온다.
alter table grading_attempts add column if not exists server_ms integer;

-- 검증 1: select column_name from information_schema.columns where table_name = 'grading_attempts' and column_name in ('queue_ms', 'strict_ms', 'grade_ms', 'server_ms');  → 4행
-- 검증 2: select count(*) from information_schema.columns where table_name = 'grading_attempts';  → 17
-- 검증 3(배포 뒤 새 제출이 생긴 다음): select count(*), count(grade_ms), count(server_ms) from grading_attempts where finished_at > now() - interval '1 day';  → 세 수가 같아야 한다(배포 전 탭에서 낸 글은 grade_ms가 비어 있을 수 있다)
