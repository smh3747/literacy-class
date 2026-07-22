-- ============================================
-- step541 마이그레이션: 공유 주제 ❤️ 좋아요 + 원작자 인기 알림 RPC
-- ============================================
-- Supabase SQL Editor에서 수동 실행 (자동 적용 안 됨)
--
-- ① topic_likes: 공유 주제 카드 좋아요. topic_copies(step272)와 동일 설계 원칙 —
--    (source_log_id, source_index, teacher_id) UNIQUE로 교사 1인 1회,
--    집계는 SECURITY DEFINER RPC로 수만 반환(누가 눌렀는지 절대 비노출).
--    copies와 달리 취소(unlike)가 필요해 DELETE 정책이 추가로 있다.
-- ② notify_topic_copied: 가져가기 발생 시 원작자 알림. 도배 방지(같은 주제
--    하루 1건, step530 패턴)를 클라이언트가 할 수 없어(알림 RLS는 수신자
--    본인만 조회) SECURITY DEFINER RPC 안에서 당일 중복 검사 후 insert.
--    type은 'message' 재사용(notifications_type_check 11종 고정 — 새 type 금지).
-- 멱등: IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE.
-- ============================================

CREATE TABLE IF NOT EXISTS topic_likes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 대상: 어느 추천 로그의 몇 번째 카드인지 (topic_copies와 같은 키 공간 — 원류 로그 기준)
  source_log_id UUID REFERENCES topic_suggestion_logs(id) ON DELETE CASCADE,
  source_index INTEGER NOT NULL,
  -- 누가 눌렀는지 (집계 전용 — 화면엔 절대 노출 안 함)
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- 교사 1인 1회
  UNIQUE (source_log_id, source_index, teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_likes_src
  ON topic_likes(source_log_id, source_index);

COMMENT ON TABLE topic_likes IS
  '공유 추천 주제 좋아요 (집계용 — 누른 교사 식별은 비노출, 취소 가능)';

-- ============================================
-- RLS: INSERT·DELETE는 본인 행만, SELECT는 본인 행 + 관리자
-- ============================================
ALTER TABLE topic_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tl_insert_own" ON topic_likes;
CREATE POLICY "tl_insert_own" ON topic_likes
  FOR INSERT TO authenticated
  WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "tl_delete_own" ON topic_likes;
CREATE POLICY "tl_delete_own" ON topic_likes
  FOR DELETE TO authenticated
  USING (teacher_id = auth.uid());

DROP POLICY IF EXISTS "tl_select_own_or_admin" ON topic_likes;
CREATE POLICY "tl_select_own_or_admin" ON topic_likes
  FOR SELECT TO authenticated
  USING (
    teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- 좋아요 수 집계 RPC (topic_copy_counts와 동일 원칙 — 수만 반환)
-- ============================================
CREATE OR REPLACE FUNCTION topic_like_counts()
RETURNS TABLE (source_log_id UUID, source_index INTEGER, n_teachers BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT source_log_id, source_index, COUNT(DISTINCT teacher_id) AS n_teachers
  FROM topic_likes
  GROUP BY source_log_id, source_index;
$$;

GRANT EXECUTE ON FUNCTION topic_like_counts() TO authenticated;

-- ============================================
-- 원작자 인기 알림 RPC — 같은 수신자·같은 제목이 KST 당일에 이미 있으면 skip
-- (제목이 주제별 고정 문자열이므로 "같은 주제당 하루 1건"이 성립.
--  누적 인원 같은 가변 문구는 body에만 넣을 것 — 제목에 넣으면 도배 방지가 깨짐.)
-- ============================================
CREATE OR REPLACE FUNCTION notify_topic_copied(
  p_recipient UUID, p_title TEXT, p_body TEXT, p_link TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  kst_day_start TIMESTAMPTZ;
BEGIN
  -- KST 오늘 0시 (UTC 저장 기준)
  kst_day_start := (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul')) AT TIME ZONE 'Asia/Seoul';
  IF EXISTS (
    SELECT 1 FROM notifications
    WHERE recipient_id = p_recipient AND type = 'message'
      AND title = p_title AND created_at >= kst_day_start
  ) THEN
    RETURN;   -- 같은 주제 당일 알림 이미 있음 — 도배 방지
  END IF;
  INSERT INTO notifications (recipient_id, type, title, body, link)
  VALUES (p_recipient, 'message', p_title, p_body, p_link);
END;
$$;

GRANT EXECUTE ON FUNCTION notify_topic_copied(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- 확인 쿼리:
-- SELECT * FROM topic_likes ORDER BY created_at DESC LIMIT 10;
-- SELECT * FROM topic_like_counts();
-- SELECT notify_topic_copied('<원작자uuid>', '테스트 제목', '본문', '/teacher/topics');  -- 두 번 실행해도 1건만
