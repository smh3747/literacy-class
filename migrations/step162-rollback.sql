-- ============================================
-- step162 롤백: admin 삭제(DELETE) 정책 제거
-- ============================================
-- ⚠️ 코드도 함께 되돌려야 함 (요청함 삭제 버튼이 이 정책을 사용).

drop policy if exists "Admin can delete reset requests" on password_reset_requests;
