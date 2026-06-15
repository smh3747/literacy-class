-- ============================================
-- step163: 학교명 표준화 — 표준학교코드 컬럼 추가
-- ============================================
-- 교사가 학교를 "하랑초/하랑초등학교/경기 하랑초등학교" 등 제각각 입력해
-- 본인확인(아이디 찾기 step162)이 표기 불일치로 깨진다.
-- NEIS 학교기본정보 OpenAPI의 표준학교코드(SD_SCHUL_CODE)를 저장해
-- 표기 흔들림과 무관하게 학교를 고유 식별한다.
--
-- 전부 nullable TEXT + IF NOT EXISTS → 멱등. 코드 변화 0, 기존 데이터 무영향.
-- 기존 school(공식명 텍스트) 컬럼은 표시용으로 그대로 유지한다.
-- ============================================

-- 교사/학생 프로필: 표준학교코드 + 시도교육청명
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_code   TEXT;  -- SD_SCHUL_CODE (표준학교코드)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_region TEXT;  -- ATPT_OFCDC_SC_NM (시도교육청명)

-- 학급: 학교별 그룹화 정합성 + 신규 학생 상속용
ALTER TABLE classes  ADD COLUMN IF NOT EXISTS school_code   TEXT;  -- SD_SCHUL_CODE

-- 코드 기준 본인확인 조회 가속 (부분 인덱스: 코드가 채워진 행만)
CREATE INDEX IF NOT EXISTS idx_profiles_school_code
  ON profiles(school_code)
  WHERE school_code IS NOT NULL;
