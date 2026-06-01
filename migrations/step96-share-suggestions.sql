-- ============================================
-- step96 마이그레이션: 추천 주제 공유
-- ============================================
-- Supabase SQL Editor에서 실행
--
-- 와이프 피드백: "내가 추천 받은 주제를 다른 선생님도 보고 선택할 수 있게"
-- 단, 모든 추천을 공유하면 사적 요청까지 노출되니 — 실제로 학급에 
-- 등록한 추천(resulting_topic_id 있음)만 다른 선생님이 볼 수 있게 함.
-- ============================================

-- 기존 SELECT 정책 교체
DROP POLICY IF EXISTS "Teachers see own suggestion logs" ON topic_suggestion_logs;

-- 새 SELECT 정책: 본인 추천 + 다른 선생님이 학급에 등록한 추천 + 관리자
CREATE POLICY "Teachers see own and shared suggestion logs" ON topic_suggestion_logs
  FOR SELECT TO authenticated
  USING (
    -- 본인 추천은 모두 볼 수 있음
    teacher_id = auth.uid()
    -- 또는 다른 선생님이 실제로 학급에 등록한 추천 (resulting_topic_id 있음)
    OR (resulting_topic_id IS NOT NULL)
    -- 관리자는 다 봄
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- INSERT/UPDATE는 기존 정책 그대로 (본인만)
-- DROP POLICY IF EXISTS "Teachers insert own suggestion logs" ON topic_suggestion_logs;
-- DROP POLICY IF EXISTS "Teachers update own suggestion logs" ON topic_suggestion_logs;

-- 인덱스 추가: 공유 추천 빨리 가져오기 위해 resulting_topic_id 있는 것만
CREATE INDEX IF NOT EXISTS idx_topic_sug_shared
  ON topic_suggestion_logs(created_at DESC)
  WHERE resulting_topic_id IS NOT NULL;

-- 확인:
-- SELECT polname, polcmd, polqual FROM pg_policy WHERE polrelid = 'topic_suggestion_logs'::regclass;
