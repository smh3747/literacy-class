-- step681: submissions 조회용 인덱스
-- 배경(11/18 표 통계): submissions 23,716행 · 152MB인데 전체 훑기(seq_scan) 137,680회,
--   읽은 행 27.9억(1회당 약 20,268행 = 매번 표 전체). 인덱스는 pkey와 부분 인덱스 4개뿐이라
--   user_id·topic_id·created_at 조건이 전부 전체 훑기였다. 동시 제출 때 훑기가 겹쳐 몇 초씩 멈춘 것으로 본다.
-- 실행: Supabase SQL Editor에서 수업 시간(09~15시) 밖에, 위에서부터 한 줄씩. 다시 실행해도 안전(if not exists).
-- 되돌리기: step681-rollback.sql

-- ① 학생 한 명의 글 / 학생+주제 / 학급 학생 묶음(user_id in ...)
create index if not exists idx_submissions_user_topic on submissions (user_id, topic_id);

-- ② 주제 하나의 글 / 주제 묶음(topic_id in ...) / 주제별 시간순 정렬
create index if not exists idx_submissions_topic_created on submissions (topic_id, created_at);

-- ③ 기간 조회와 최신순(관리자 표·채점 건수 세기·대기 검사)
create index if not exists idx_submissions_created on submissions (created_at desc);

-- ④ (추가 제안) 채점 대기 선점 수 세기: pages/api/grade-backfill.js가 대기 글을 볼 때마다
--    grade_claimed_at >= (최근) 조건으로 센다. 값이 있는 행만 담아 아주 작다.
create index if not exists idx_submissions_grade_claimed on submissions (grade_claimed_at) where grade_claimed_at is not null;

-- 통계 갱신(새 인덱스를 바로 고르게)
analyze submissions;
