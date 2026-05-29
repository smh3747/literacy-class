-- ============================================
-- step86 마이그레이션: 평가기준별 점수 근거 저장
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 학생이 점수에 납득할 수 있도록, 각 평가기준 옆에
-- "왜 이 점수가 나왔는지" 한 줄 설명을 함께 저장합니다.
-- 예) ["상상력 18/20점 — 외계인 학교라는 설정은 신선...",
--      "표현력 14/20점 — 비유가 좋았지만 ..."]
-- ============================================

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS rubric_reasons JSONB;

COMMENT ON COLUMN submissions.rubric_reasons IS '평가기준별 점수 근거 (배열, 각 한 문장)';

-- 확인 쿼리:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'submissions' AND column_name = 'rubric_reasons';
