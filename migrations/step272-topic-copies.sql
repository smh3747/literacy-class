-- ============================================
-- step272 마이그레이션: 공유 주제 "가져오기" 출처 기록
-- ============================================
-- Supabase SQL Editor에서 수동 실행 (자동 적용 안 됨)
--
-- 교사 B가 교사 A의 공유 추천 주제를 가져와 자기 학급 주제로 등록하면
-- 그 출처를 기록한다. 가져온 주제는 B의 독립 주제로 유지(원본 재연결 X),
-- 여기엔 "출처"만 별도로 남긴다. (배지·인기순 정렬은 다음 단계에서 사용)
-- 멱등: IF NOT EXISTS / CREATE OR REPLACE 로 중복 실행 안전.
-- ============================================

CREATE TABLE IF NOT EXISTS topic_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 출처: 어느 추천 로그의 몇 번째 카드인지
  source_log_id UUID REFERENCES topic_suggestion_logs(id) ON DELETE CASCADE,
  source_index INTEGER NOT NULL,
  -- 누가 가져갔는지 (집계 전용 — 화면엔 노출 안 함)
  copied_by_teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- 가져와 새로 만든 주제 (독립 주제)
  copied_topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  copied_at TIMESTAMPTZ DEFAULT NOW(),
  -- 같은 교사가 같은 카드를 여러 번 가져와도 1명으로 (중복 방지)
  UNIQUE (source_log_id, source_index, copied_by_teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_copies_src
  ON topic_copies(source_log_id, source_index);

COMMENT ON TABLE topic_copies IS
  '공유 추천 주제를 다른 교사가 가져와 등록한 출처 기록 (집계용, 원작자/가져간이 식별은 비노출)';

-- ============================================
-- RLS: INSERT는 본인만, SELECT는 본인 행 + 관리자
-- ============================================
ALTER TABLE topic_copies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tc_insert_own" ON topic_copies;
CREATE POLICY "tc_insert_own" ON topic_copies
  FOR INSERT TO authenticated
  WITH CHECK (copied_by_teacher_id = auth.uid());

DROP POLICY IF EXISTS "tc_select_own_or_admin" ON topic_copies;
CREATE POLICY "tc_select_own_or_admin" ON topic_copies
  FOR SELECT TO authenticated
  USING (
    copied_by_teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- 사용수 집계: 카운트 전용 RPC (개인정보 미노출)
-- "이 주제 N명 사용"을 위해 (source_log_id, source_index)별
-- DISTINCT 교사 수만 반환. copied_by는 절대 노출하지 않음.
-- SECURITY DEFINER 이므로 RLS와 무관하게 집계 정수만 돌려준다.
-- (다음 단계 표시/정렬에서 사용)
-- ============================================
CREATE OR REPLACE FUNCTION topic_copy_counts()
RETURNS TABLE (source_log_id UUID, source_index INTEGER, n_teachers BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT source_log_id, source_index, COUNT(DISTINCT copied_by_teacher_id) AS n_teachers
  FROM topic_copies
  GROUP BY source_log_id, source_index;
$$;

GRANT EXECUTE ON FUNCTION topic_copy_counts() TO authenticated;

-- 확인 쿼리:
-- SELECT * FROM topic_copies ORDER BY copied_at DESC LIMIT 10;
-- SELECT * FROM topic_copy_counts();
