-- ============================================
-- step48 마이그레이션: 주제별 제출 기한
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run

-- 제출 마감 기한 (NULL이면 기한 없음 = 항상 제출 가능)
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS deadline_date DATE;
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS deadline_time TIME;

-- 확인:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'topics' AND column_name LIKE 'deadline%';
