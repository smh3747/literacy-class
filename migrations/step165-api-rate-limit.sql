-- ============================================
-- step165: API 호출 제한용 경량 테이블
-- ============================================
-- find-teacher-id(아이디 찾기) 같은 비로그인 라우트의 무차별 대입을 막기 위한
-- IP 해시 기반 호출 카운터. 서버리스(Vercel)는 인스턴스 메모리가 공유되지 않아
-- 신뢰할 수 있는 rate limit은 공유 상태(DB)가 필요하다.
--
-- bucket으로 용도를 구분해 여러 라우트가 한 테이블을 재사용한다 (예: 'find_teacher_id').
-- 행은 호출 1건당 1개 쌓이며, 윈도우(예: 10분/24h) 내 건수만 센다.
-- service_role(서버)만 접근한다(RLS enable + 정책 없음).
-- ============================================

CREATE TABLE IF NOT EXISTS api_rate_limit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL,        -- 용도 구분 (예: 'find_teacher_id')
  ip_hash TEXT NOT NULL,       -- sha256(고정 prefix + IP)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limit_lookup
  ON api_rate_limit(bucket, ip_hash, created_at DESC);

ALTER TABLE api_rate_limit ENABLE ROW LEVEL SECURITY;
-- 정책을 두지 않음 → anon/authenticated는 접근 불가, service_role만 사용(서버 전용).

-- 참고: 행은 천천히 쌓인다(호출량이 적은 라우트 전용). 필요 시 아래로 정리 가능:
--   DELETE FROM api_rate_limit WHERE created_at < now() - interval '2 days';
-- (윈도우가 24h라 2일보다 오래된 행은 카운트에 영향 없음)
