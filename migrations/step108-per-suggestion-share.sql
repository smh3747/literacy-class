-- ============================================
-- step108 마이그레이션: 추천 개별(카드 단위) 공유
-- ============================================
-- 기존: is_shared 토글이 로그(묶음) 단위 → 3개 추천이 통째로 공유됨
-- 변경: shared_indexes (JSONB 배열)로 개별 추천만 공유
-- 예: 추천 3개 중 1번만 공유 → shared_indexes = [0]
-- ============================================

ALTER TABLE topic_suggestion_logs
  ADD COLUMN IF NOT EXISTS shared_indexes JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN topic_suggestion_logs.shared_indexes IS
  '명시적으로 공유된 추천의 인덱스 배열. 예: [0, 2]. 빈 배열이면 명시 공유 없음.';

-- 기존 is_shared = true 로그 → 모든 추천 인덱스를 shared_indexes로 변환
UPDATE topic_suggestion_logs
SET shared_indexes = (
  SELECT COALESCE(jsonb_agg(idx), '[]'::jsonb)
  FROM generate_series(0, jsonb_array_length(suggestions) - 1) AS idx
)
WHERE is_shared = true
  AND (shared_indexes IS NULL OR shared_indexes = '[]'::jsonb);

-- RLS 정책 갱신: shared_indexes에 하나라도 있으면 공유로 취급
DROP POLICY IF EXISTS "Teachers see own suggestion logs" ON topic_suggestion_logs;
DROP POLICY IF EXISTS "Teachers see own and shared suggestion logs" ON topic_suggestion_logs;

CREATE POLICY "Teachers see own and shared suggestion logs" ON topic_suggestion_logs
  FOR SELECT TO authenticated
  USING (
    teacher_id = auth.uid()
    OR (resulting_topic_id IS NOT NULL)
    OR (is_shared = true)
    OR (jsonb_array_length(COALESCE(shared_indexes, '[]'::jsonb)) > 0)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 인덱스 (shared_indexes 비어있지 않은 것)
CREATE INDEX IF NOT EXISTS idx_topic_sug_partial_shared
  ON topic_suggestion_logs(created_at DESC)
  WHERE jsonb_array_length(shared_indexes) > 0;
