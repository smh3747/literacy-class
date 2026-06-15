-- ============================================
-- step163 롤백 — 표준학교코드 컬럼 제거
-- ============================================
-- 주의: 이미 채워진 school_code/school_region 데이터가 영구 삭제된다.
-- 되돌릴 일이 없으면 실행하지 말 것. (school 공식명 텍스트는 그대로 남는다)
-- ============================================

DROP INDEX IF EXISTS idx_profiles_school_code;

ALTER TABLE profiles DROP COLUMN IF EXISTS school_code;
ALTER TABLE profiles DROP COLUMN IF EXISTS school_region;
ALTER TABLE classes  DROP COLUMN IF EXISTS school_code;
