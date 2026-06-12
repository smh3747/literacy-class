-- ============================================
-- step156 롤백: 비번 초기화 익명 INSERT 복원
-- ============================================
-- ⚠️ 코드도 함께 되돌려야 함 (teacher/login.js가 다시 직접 INSERT 하도록).
--    새 서버 라우트(/api/password-reset-request)는 service_role을 쓰므로 정책과 무관하나,
--    구버전 클라이언트 직접 INSERT를 다시 허용하려면 아래 정책을 복원한다.

-- step119의 익명 INSERT 정책 복원
drop policy if exists "Anyone can insert reset request" on password_reset_requests;
create policy "Anyone can insert reset request" on password_reset_requests
  for insert to anon, authenticated
  with check (true);

-- 인덱스/컬럼은 남겨둬도 무해하므로 삭제하지 않음 (필요 시 아래 주석 해제)
-- drop index if exists idx_pwreset_iphash;
-- drop index if exists idx_pwreset_created;
-- alter table password_reset_requests drop column if exists ip_hash;
