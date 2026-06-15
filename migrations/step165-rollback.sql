-- ============================================
-- step165 롤백 — API 호출 제한 테이블 제거
-- ============================================
DROP INDEX IF EXISTS idx_api_rate_limit_lookup;
DROP TABLE IF EXISTS api_rate_limit;
