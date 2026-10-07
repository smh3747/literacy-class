-- step606: AI 안전 필터 차단 글을 "점수 없이" 저장 — 점수·피드백 컬럼의 NOT NULL 해제(보험).
--   표식은 기존 컬럼만 사용: total_score IS NULL + graded_with_model = 'safety_blocked' (+ is_fallback_graded=false).
--   submissions의 CREATE TABLE이 리포에 없어 제약 유무를 파일로 확인할 수 없다. DROP NOT NULL은
--   이미 nullable이면 no-op이므로 중복 실행해도 안전(멱등). Supabase SQL Editor에서 수동 실행.
--   미실행 상태에서 실제로 NOT NULL이면 클라이언트 insert가 실패 → 학생에게 전용 안내 모달(기기 초안은 유지)로 안전 강등.

ALTER TABLE submissions ALTER COLUMN total_score DROP NOT NULL;
ALTER TABLE submissions ALTER COLUMN scores DROP NOT NULL;
ALTER TABLE submissions ALTER COLUMN feedback_overall DROP NOT NULL;
ALTER TABLE submissions ALTER COLUMN feedback_good DROP NOT NULL;
ALTER TABLE submissions ALTER COLUMN feedback_improve DROP NOT NULL;

COMMENT ON COLUMN submissions.graded_with_model IS '채점 모델명. ''safety_blocked''=AI 안전 필터 차단으로 점수 없이 저장(step606). 재평가 성공 시 실제 모델명으로 덮임';

-- 검증:
-- select id, user_id, topic_id, attempt, total_score, graded_with_model, created_at
--   from submissions where graded_with_model = 'safety_blocked' order by created_at desc limit 20;
