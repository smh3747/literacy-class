-- ============================================
-- step97 마이그레이션: 추천 명시적 공유 토글
-- ============================================
-- 와이프 피드백: 선택 안 한 추천도 공유하고 싶으면 공유할 수 있게
-- 기존 자동 공유(resulting_topic_id 있는 것) + 명시 공유 토글 둘 다 지원
-- ============================================

ALTER TABLE topic_suggestion_logs
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT false;

COMMENT ON COLUMN topic_suggestion_logs.is_shared IS
  '선생님이 명시적으로 공유한 추천. true면 등록 안 했어도 다른 선생님이 봄.';

-- SELECT 정책 갱신: 본인 + 등록된 추천 + 명시 공유 + 관리자
DROP POLICY IF EXISTS "Teachers see own suggestion logs" ON topic_suggestion_logs;
DROP POLICY IF EXISTS "Teachers see own and shared suggestion logs" ON topic_suggestion_logs;

CREATE POLICY "Teachers see own and shared suggestion logs" ON topic_suggestion_logs
  FOR SELECT TO authenticated
  USING (
    teacher_id = auth.uid()
    OR (resulting_topic_id IS NOT NULL)
    OR (is_shared = true)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 명시 공유 추천도 빠르게
CREATE INDEX IF NOT EXISTS idx_topic_sug_explicit_shared
  ON topic_suggestion_logs(created_at DESC)
  WHERE is_shared = true;
