-- ============================================
-- step161: 아이디 찾기 요청 + 비번 초기화 후 변경 유도
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 실행 순서: 이 SQL을 먼저 실행 → 그다음 코드(step161) 배포.
--   (request_type/must_change_password 컬럼이 있어야 새 코드가 정상 동작.
--    컬럼이 없어도 기존 흐름은 깨지지 않지만, 새 기능은 컬럼 필요.)
--
-- RLS 변경 없음. 멱등(IF NOT EXISTS).
-- 롤백: step161-rollback.sql
-- ============================================

-- 1) 요청 종류 구분 (reset_password / find_id). 기존 행은 reset_password로 간주.
alter table password_reset_requests
  add column if not exists request_type text default 'reset_password';

-- 2) 비번 초기화 후 강제 변경 유도 플래그
alter table profiles
  add column if not exists must_change_password boolean default false;

-- ============================================
-- 적용 확인:
-- select column_name from information_schema.columns
--   where table_name = 'password_reset_requests' and column_name = 'request_type';   -- 1행
-- select column_name from information_schema.columns
--   where table_name = 'profiles' and column_name = 'must_change_password';           -- 1행
-- ============================================
