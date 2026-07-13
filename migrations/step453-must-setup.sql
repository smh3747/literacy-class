-- step453: 비번 초기화 후 재설정 강제 마커 — ⚠️ 이미 Supabase에 적용됨(기록용, 실행 불필요)
-- 관리자가 비밀번호를 초기화하면 must_setup_at이 기록되고, 그 교사는 다음 로그인에서
-- 닫기 불가 모달로 새 비밀번호+복구 이메일 등록을 마쳐야 함(완료 시 null).
-- must_change_password(step161)와 병행: 초기화 시 둘 다 서고, 설정 완료 시 둘 다 해제.

alter table profiles add column if not exists must_setup_at timestamptz;

-- 검증: select realname, must_setup_at from profiles where must_setup_at is not null;
