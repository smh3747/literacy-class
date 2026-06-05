-- ============================================
-- step113 마이그레이션: 학생 알림 (코멘트 읽음 추적)
-- ============================================

-- 담임 코멘트를 학생이 확인했는지 추적
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS teacher_comment_read_at TIMESTAMPTZ;

COMMENT ON COLUMN submissions.teacher_comment_read_at IS
  '학생이 담임 코멘트를 확인한 시각. NULL이면 미확인 → 학생 홈에 알림 표시.';
