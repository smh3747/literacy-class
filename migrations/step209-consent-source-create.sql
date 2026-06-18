-- ============================================
-- step209: consents.source 컬럼 추가 (온라인/종이 동의 구분)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 목적: 동의 제출 출처를 구분한다.
--   'online' = 부모가 /consent/<코드> 양식으로 직접 서명 제출 (기존 경로)
--   'paper'  = 종이 동의서를 받아 교사가 처리한 기록 (묶음 F에서 추가될 경로)
--
-- ★기본값 'online': 이 컬럼 추가 전에 쌓인 consents 행은 전부 온라인 제출이었으므로
--   기존 행은 자동으로 'online'으로 채워진다. 기존 데이터·다른 컬럼은 건드리지 않는다.
--
-- 멱등: add column if not exists → 중복 실행 안전.
-- 사전 조건: step193(consents 테이블) 적용 완료.
-- 롤백: alter table consents drop column if exists source;  (필요 시 수동)
-- ============================================

alter table consents add column if not exists source text default 'online';
