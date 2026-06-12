-- ============================================
-- step156: 비밀번호 초기화 요청 스팸 방어
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 목적: password_reset_requests의 익명 직접 INSERT를 막고, 서버 API(/api/password-reset-request)가
--   service_role로만 INSERT하도록 전환. ip_hash 기반 rate limit은 서버에서 수행.
--
-- ⚠️ 코드(서버 라우트 + teacher/login.js)가 함께 배포되어야 비번 초기화 요청이 동작.
--   (SQL 먼저 실행 → 코드 배포. 정책 제거 후에는 익명 직접 INSERT가 막히므로 새 라우트 필수.)
-- 롤백: step156-rollback.sql
-- ============================================

-- 1) ip_hash 컬럼 추가 (서버가 채움, 멱등)
alter table password_reset_requests add column if not exists ip_hash text;

-- 2) rate limit 조회용 인덱스
create index if not exists idx_pwreset_created on password_reset_requests(created_at desc);
create index if not exists idx_pwreset_iphash on password_reset_requests(ip_hash, created_at desc);

-- 3) 익명 INSERT 정책 제거 (이제 service_role로만 INSERT)
--    step119에서 만든 정책 이름. anon/authenticated 직접 INSERT 차단.
drop policy if exists "Anyone can insert reset request" on password_reset_requests;

-- admin SELECT/UPDATE 정책(step119)은 그대로 둔다. service_role은 RLS를 우회해 INSERT.

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'password_reset_requests';
--   → "Admin can view ..."(SELECT), "Admin can update ..."(UPDATE)만 남고 INSERT 정책은 없어야 함
-- select column_name from information_schema.columns
--   where table_name = 'password_reset_requests' and column_name = 'ip_hash';  -- 1행
-- ============================================
