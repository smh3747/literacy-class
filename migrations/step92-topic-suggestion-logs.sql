-- ============================================
-- step92 마이그레이션: AI 주제 추천 로그
-- ============================================
-- Supabase SQL Editor에서 실행
--
-- 와이프 피드백: 어떤 주제를 AI가 추천했는지, 어떤 걸 골랐는지
-- 선생님이 나중에 볼 수 있게.
-- ============================================

CREATE TABLE IF NOT EXISTS topic_suggestion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,

  -- 요청 정보
  request_category TEXT,         -- AI에 넘긴 카테고리
  request_level TEXT,            -- 난이도 (쉬움/보통/어려움)
  request_user_message TEXT,     -- 선생님이 추가로 적은 요청 (있으면)

  -- 결과: 추천된 주제들 (배열, 최대 3개)
  -- 형태: [{ title, description, category }]
  suggestions JSONB NOT NULL,

  -- 선생님이 어떤 걸 골랐는지 (인덱스 0..2)
  -- null이면 아직 고르지 않음 / 다시 추천을 받음
  selected_index INTEGER,

  -- 결과적으로 등록된 주제 (선택 → 평가기준 만들고 → 등록)
  -- null이면 등록까지 가지 않음
  resulting_topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,

  -- 어떤 모델이 답했는지 (디버깅용)
  model_used TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topic_sug_teacher ON topic_suggestion_logs(teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topic_sug_class ON topic_suggestion_logs(class_id, created_at DESC);

COMMENT ON TABLE topic_suggestion_logs IS '교사가 받은 AI 주제 추천 로그 (선택/미선택 모두 기록)';

-- ============================================
-- RLS: 본인 + 관리자만
-- ============================================
ALTER TABLE topic_suggestion_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers see own suggestion logs" ON topic_suggestion_logs;
CREATE POLICY "Teachers see own suggestion logs" ON topic_suggestion_logs
  FOR SELECT TO authenticated
  USING (
    teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Teachers insert own suggestion logs" ON topic_suggestion_logs;
CREATE POLICY "Teachers insert own suggestion logs" ON topic_suggestion_logs
  FOR INSERT TO authenticated
  WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Teachers update own suggestion logs" ON topic_suggestion_logs;
CREATE POLICY "Teachers update own suggestion logs" ON topic_suggestion_logs
  FOR UPDATE TO authenticated
  USING (teacher_id = auth.uid());

-- 확인 쿼리:
-- SELECT * FROM topic_suggestion_logs ORDER BY created_at DESC LIMIT 10;
