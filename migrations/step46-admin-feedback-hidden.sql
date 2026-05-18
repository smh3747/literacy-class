-- ============================================
-- step46 마이그레이션: 의견 숨김 처리
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run

-- 의견 숨김 (확인한 의견을 안 보이게 처리)
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

-- 확인 쿼리:
-- SELECT column_name, column_default FROM information_schema.columns
--   WHERE table_name = 'feedback' AND column_name IN ('is_hidden', 'hidden_at');

-- 참고: 관리자 권한은 profiles.role = 'admin'만 변경하면 되므로
-- 별도의 마이그레이션이 필요하지 않습니다.
-- 복수 관리자 구조는 기존 role 시스템으로 충분히 지원됩니다.
