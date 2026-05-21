-- step83: 채점에 사용된 AI 모델 정보 저장
-- 메인 모델(gemini-3.1-flash-lite) 한도 도달 시 폴백된 채점에 표시

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS graded_with_model TEXT,
  ADD COLUMN IF NOT EXISTS is_fallback_graded BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN submissions.graded_with_model IS '채점에 사용된 AI 모델명';
COMMENT ON COLUMN submissions.is_fallback_graded IS '메인 모델 한도 도달로 폴백 채점됐는지 (true면 재평가 권장)';
