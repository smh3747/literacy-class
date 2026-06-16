-- ============================================
-- step187 롤백: pending_names 제거
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 주의: 이 테이블에 보관된 암호화 실명(enc_name)이 모두 삭제됩니다(복구 불가).
--   롤백 전 필요한 데이터를 반드시 백업하세요.
-- ============================================

-- 정책 제거 (테이블 drop 전에 명시적으로 — 멱등)
drop policy if exists "pn_select" on pending_names;
drop policy if exists "pn_insert" on pending_names;
drop policy if exists "pn_update" on pending_names;
drop policy if exists "pn_delete" on pending_names;

-- 테이블 제거 (cascade로 의존 객체 함께 정리)
drop table if exists pending_names cascade;

-- ============================================
-- 적용 확인:
-- select to_regclass('public.pending_names');   -- NULL 이어야 함(삭제됨)
-- ============================================
