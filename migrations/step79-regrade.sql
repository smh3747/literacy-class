-- step79: AI 재평가 기능
-- 선생님이 과거 글을 새 기준으로 다시 채점 가능
-- 이전 점수/피드백은 별도 컬럼에 백업

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS re_graded_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS re_graded_by UUID,
  ADD COLUMN IF NOT EXISTS previous_scores JSONB,
  ADD COLUMN IF NOT EXISTS previous_total_score INTEGER,
  ADD COLUMN IF NOT EXISTS previous_max_score INTEGER,
  ADD COLUMN IF NOT EXISTS previous_feedback_overall TEXT,
  ADD COLUMN IF NOT EXISTS previous_feedback_good TEXT,
  ADD COLUMN IF NOT EXISTS previous_feedback_improve TEXT;

COMMENT ON COLUMN submissions.re_graded_at IS 'AI 재평가 시각 (선생님이 다시 채점한 경우)';
COMMENT ON COLUMN submissions.re_graded_by IS '재평가를 실행한 선생님 ID';
COMMENT ON COLUMN submissions.previous_scores IS '재평가 전 점수 배열 백업';
COMMENT ON COLUMN submissions.previous_total_score IS '재평가 전 총점 백업';
COMMENT ON COLUMN submissions.previous_max_score IS '재평가 전 만점 백업';
COMMENT ON COLUMN submissions.previous_feedback_overall IS '재평가 전 종합의견 백업';
COMMENT ON COLUMN submissions.previous_feedback_good IS '재평가 전 잘한점 백업';
COMMENT ON COLUMN submissions.previous_feedback_improve IS '재평가 전 발전점 백업';
