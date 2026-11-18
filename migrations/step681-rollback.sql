-- step681 되돌리기: 인덱스만 지운다(데이터·정책 불변)
drop index if exists idx_submissions_user_topic;
drop index if exists idx_submissions_topic_created;
drop index if exists idx_submissions_created;
drop index if exists idx_submissions_grade_claimed;
