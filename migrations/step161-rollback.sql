-- ============================================
-- step161 롤백: request_type / must_change_password 컬럼 제거
-- ============================================
-- ⚠️ 코드도 함께 되돌려야 함 (새 코드가 이 컬럼들을 참조).

alter table password_reset_requests drop column if exists request_type;
alter table profiles drop column if exists must_change_password;
