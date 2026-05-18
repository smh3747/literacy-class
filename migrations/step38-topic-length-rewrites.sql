-- ============================================
-- step38 마이그레이션: 주제별 글자수 + 최대 재수정 횟수
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run

-- 최소 글자수 (기본 30자, 주제별로 조정 가능)
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS min_length INTEGER DEFAULT 30;

-- 최대 재수정 횟수 (기본 1회, 0이면 수정 불가, 1=첫 글 + 수정본 1번)
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS max_rewrites INTEGER DEFAULT 1;

-- 확인 쿼리:
-- SELECT column_name, column_default FROM information_schema.columns
--   WHERE table_name = 'topics' AND column_name IN ('min_length', 'max_rewrites');
