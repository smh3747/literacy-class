-- step668: 채점 보류 표식 — 구글 혼잡·한도 초과로 채점이 안 될 때 글을 먼저 제출하고 나중에 자동 채점한다.
-- 배경: 11/10 신양초 6-3에서 503이 40분 넘게 이어져 10명이 끝내 제출하지 못했다. 지금은 채점이 실패하면 제출 행 자체가 안 생긴다.
-- 번호 안내: 이 SQL은 11/10에 적용 완료됐다(기존 22,908행 변동 없음). 그 뒤 계측이 step668을 써서, 이 표식을 쓰는 코드는 step669(표시 정리)·670(전환과 접속 시 채점)·671(새벽 안전망)이다.
-- 적용: Supabase SQL Editor에서 수동 실행. 멱등(여러 번 실행해도 안전). 기존 행은 건드리지 않는다(네 컬럼 모두 null 또는 0).
-- 순서: 이 SQL을 먼저 적용한 뒤 step669 코드를 배포한다. step669는 표시만 정리하고 보류 행을 만들지 않는다. 보류 행은 step670부터 생긴다.
-- 개인정보: 새로 저장하는 개인정보 없음.
-- 알림 유형은 추가하지 않는다. step541 규칙(notifications_type_check 11종 고정)에 따라 채점 완료·실패 알림은 기존 'message' 유형을 다시 쓴다.

-- 채점 상태. null은 기존 방식으로 바로 채점된 글. 'pending'은 점수 없이 먼저 제출된 글. 'done'은 나중에 채점이 끝난 글. 'failed'는 기한 안에 채점하지 못한 글.
alter table submissions add column if not exists grade_status text;
-- 보류된 이유. 'busy503'은 구글 혼잡, 'limit'은 한도 초과(429), 'timeout'은 응답 지연.
alter table submissions add column if not exists grade_reason text;
-- 나중 채점을 시도한 횟수.
alter table submissions add column if not exists grade_tries integer not null default 0;
-- 나중 채점을 잡은 시각. 학생 화면·교사 화면·새벽 크론이 같은 글을 동시에 채점하지 않게 하는 선점 표시.
alter table submissions add column if not exists grade_claimed_at timestamptz;

-- 허용 값 제약. 이미 있으면 건너뛴다.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'submissions_grade_status_check') then
    alter table submissions add constraint submissions_grade_status_check check (grade_status is null or grade_status in ('pending', 'done', 'failed'));
  end if;
end $$;

-- 보류 글 찾기용 부분 인덱스. 보류 글은 항상 소수라 작다.
create index if not exists idx_submissions_grade_pending on submissions (created_at) where grade_status = 'pending';

-- 검증 1: select column_name from information_schema.columns where table_name = 'submissions' and column_name in ('grade_status', 'grade_reason', 'grade_tries', 'grade_claimed_at');  → 4행
-- 검증 2: select grade_status, count(*) from submissions group by 1;  → null 1행만(전체 건수)
-- 검증 3: select count(*) from pg_constraint where conname = 'submissions_grade_status_check';  → 1
-- 검증 4: select count(*) from pg_indexes where indexname = 'idx_submissions_grade_pending';  → 1
