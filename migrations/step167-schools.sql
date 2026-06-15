-- ============================================
-- step167: 전국 초등학교 캐시 테이블
-- ============================================
-- 학교 자동완성이 매번 NEIS API를 호출해 ~3초 지연되던 것을, 전국 초등학교
-- (실측 6,341개)를 우리 DB에 1회 적재해두고 검색은 DB에서만 하도록 전환한다.
-- NEIS는 적재/갱신 때(scripts/load-schools.mjs)만 호출 → 검색 즉시 응답 +
-- NEIS 장애와 무관.
--
-- code(SD_SCHUL_CODE)가 PK라 재적재 upsert가 멱등하다.
-- 학교 목록은 공공데이터 → 공개 SELECT, 쓰기는 service_role(적재 스크립트)만.
-- ============================================

CREATE TABLE IF NOT EXISTS schools (
  code       TEXT PRIMARY KEY,        -- SD_SCHUL_CODE (표준학교코드, 고유)
  name       TEXT NOT NULL,           -- SCHUL_NM
  region     TEXT,                    -- ATPT_OFCDC_SC_NM (교육청명, step163과 동일 기준)
  address    TEXT,                    -- ORG_RDNMA (도로명주소)
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 부분검색(name LIKE '%키워드%')은 6천여 행에서 seq scan으로도 1ms 미만이라
-- 인덱스가 필수는 아니지만, 접두검색·정렬용으로 가볍게 둔다.
CREATE INDEX IF NOT EXISTS idx_schools_name ON schools(name);

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

-- 공개 읽기 (학교 목록은 공공정보)
DROP POLICY IF EXISTS "schools public read" ON schools;
CREATE POLICY "schools public read" ON schools
  FOR SELECT TO anon, authenticated
  USING (true);

-- 쓰기 정책은 두지 않음 → service_role(적재 스크립트)만 INSERT/UPDATE 가능.
