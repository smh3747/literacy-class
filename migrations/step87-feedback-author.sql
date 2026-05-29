-- ============================================
-- step87 마이그레이션: 의견 작성자 추적
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 와이프 피드백 2번: "의견을 누가 줬는지 알 수 있게"
-- feedback 테이블에 user_id 컬럼 추가하고, 이후 작성되는 의견은
-- 자동으로 로그인한 사용자의 ID가 함께 저장됩니다.
-- 기존 의견은 user_id가 NULL로 남아서 "익명"으로 표시돼요.
-- ============================================

-- 1) user_id 컬럼 추가 (profiles 테이블 참조)
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 2) 조회 성능을 위해 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);

COMMENT ON COLUMN feedback.user_id IS '의견 작성자 (NULL이면 익명/구버전 의견)';

-- ============================================
-- RLS 정책: 의견 작성 시 자기 user_id로만 가능
-- ============================================
-- 참고: 현재 feedback insert 정책이 어떻게 되어 있는지에 따라
-- 아래는 필요시에만 추가/수정. 보통 anon role도 insert 가능하게 열려있을 것.
-- 만약 RLS가 막힌다면 아래 정책을 참고:
--
-- CREATE POLICY "Anyone can submit feedback" ON feedback
--   FOR INSERT TO authenticated, anon
--   WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- ============================================
-- 확인 쿼리:
-- ============================================
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'feedback' ORDER BY ordinal_position;
