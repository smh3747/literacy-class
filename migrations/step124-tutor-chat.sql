-- ============================================
-- step124: AI 글쓰기 도우미 챗봇
-- ============================================
-- 교사가 학급별로 켜고 끄는 학생 글쓰기 도우미.
-- 글을 대신 써주지 않고 생각을 이끄는 질문·힌트만 제공.
-- 학생당 하루 사용 횟수 제한 (Gemini 무료 한도 보호).
-- ============================================

-- 학급별 챗봇 on/off (기본 off — 교사가 명시적으로 켜야 함)
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS tutor_chat_enabled BOOLEAN DEFAULT false;

COMMENT ON COLUMN classes.tutor_chat_enabled IS
  'AI 글쓰기 도우미 챗봇 사용 여부. 교사가 학급 설정에서 켜고 끔. 기본 off.';

-- 학생별 일일 사용 횟수 추적
CREATE TABLE IF NOT EXISTS tutor_chat_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  used_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER DEFAULT 0,
  UNIQUE (user_id, used_date)
);

ALTER TABLE tutor_chat_usage ENABLE ROW LEVEL SECURITY;

-- 학생 본인 사용량만 조회·갱신
DROP POLICY IF EXISTS "Students manage own tutor usage" ON tutor_chat_usage;
CREATE POLICY "Students manage own tutor usage" ON tutor_chat_usage
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_tutor_usage_user_date
  ON tutor_chat_usage(user_id, used_date);
