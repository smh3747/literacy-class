-- ============================================
-- step167 롤백 — 초등학교 캐시 테이블 제거
-- ============================================
DROP INDEX IF EXISTS idx_schools_name;
DROP TABLE IF EXISTS schools;
