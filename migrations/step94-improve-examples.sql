-- ============================================
-- step94 마이그레이션: 피드백 친절·자세함 강화
-- ============================================
-- Supabase SQL Editor에서 실행
--
-- 와이프 피드백: 학생이 피드백 보고 글을 더 잘 쓰게 하려면
-- "왜 감점됐는지", "어떻게 고치면 좋은지" 구체적으로 알아야 함.
-- 발전점에 대한 구체 예시(학생 글의 어느 부분을 어떻게 고치면 좋을지)를
-- 저장하기 위한 컬럼 추가.
-- ============================================

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS improve_examples JSONB;

COMMENT ON COLUMN submissions.improve_examples IS
  '발전점에 대한 구체 예시 배열. 각 항목: {original: "학생 글의 부분", suggested: "이렇게 바꿔보세요", reason: "왜"}';

-- 확인:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'submissions' AND column_name = 'improve_examples';
