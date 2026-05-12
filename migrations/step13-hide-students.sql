-- ============================================
-- step13: 학생 숨김 처리 (전출생 등)
-- ============================================
-- 실행 위치: Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
-- 안전성: IF NOT EXISTS로 중복 실행해도 OK

-- 학생 숨김 컬럼 (삭제 대신 숨김)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

-- 숨김 학생 빠르게 필터링하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_profiles_visible
  ON profiles(class_id, is_hidden) WHERE role = 'student';

-- ============================================
-- 확인 쿼리
-- ============================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'profiles' AND column_name IN ('is_hidden', 'hidden_at', 'hidden_reason');
