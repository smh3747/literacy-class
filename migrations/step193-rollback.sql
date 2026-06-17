-- ============================================
-- step193 롤백: consents 테이블 + classes.consent_password 제거
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 주의: consents 의 모든 부모 동의 기록(서명 이미지·동의항목·동의일시)이 영구 삭제됩니다(복구 불가).
--   classes.consent_password 도 함께 사라집니다. 롤백 전 필요한 데이터를 반드시 백업하세요.
-- ============================================

-- 정책 제거 (테이블 drop 전에 명시적으로 — 멱등)
drop policy if exists "consents_select" on consents;
drop policy if exists "consents_delete" on consents;

-- 인덱스 제거 (테이블 drop 시 자동 제거되나 방어적으로)
drop index if exists idx_consents_student;
drop index if exists idx_consents_class;

-- 테이블 제거 (cascade 로 의존 객체 함께 정리)
drop table if exists consents cascade;

-- 학급 동의비밀번호 컬럼 제거
alter table classes drop column if exists consent_password;

-- ============================================
-- 적용 확인:
-- select to_regclass('public.consents');   -- NULL 이어야 함(삭제됨)
-- select column_name from information_schema.columns
--   where table_name='classes' and column_name='consent_password';   -- 0행
-- ============================================
