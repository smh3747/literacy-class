-- ============================================
-- step98 마이그레이션: 담임 코멘트
-- ============================================
-- 와이프 피드백: AI 피드백 외에 담임이 직접 코멘트 달 수 있게
-- 학생 글 1편당 코멘트 1개 (수정 가능)
-- 학생만 자기 글의 코멘트를 봄, 관리자는 다 봄
-- ============================================

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS teacher_comment TEXT,
  ADD COLUMN IF NOT EXISTS teacher_comment_at TIMESTAMPTZ;

COMMENT ON COLUMN submissions.teacher_comment IS '담임 선생님이 작성한 직접 코멘트 (AI 피드백 외 추가 메시지)';
COMMENT ON COLUMN submissions.teacher_comment_at IS '코멘트 마지막 작성/수정 시각';

-- ============================================
-- 기존 submissions RLS 정책을 확인해야 함:
-- - 학생 본인은 자기 submissions를 SELECT 가능 (이미 그럴 것)
-- - 담임은 자기 학급 학생 submissions를 SELECT/UPDATE 가능 (이미 그럴 것)
-- - 따라서 별도 정책 추가 필요 없음 (컬럼만 추가하면 됨)
-- ============================================

-- 확인:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'submissions'
--   AND column_name IN ('teacher_comment', 'teacher_comment_at');
