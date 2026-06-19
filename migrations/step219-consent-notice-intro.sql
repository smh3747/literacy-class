-- ============================================
-- step219: 학부모 안내문 상단 인사말(편집 가능) 컬럼
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 목적: 학부모 동의 안내문을 "상단 인사말(교사 편집 가능) + 고정부(코드가 항상 자동 생성·잠금)"로 나눈다.
--   classes.consent_notice_intro : 인사말만 저장(text, nullable, 기본 null).
--     - null  → 코드가 기본 인사말("[학교 반] 학부모 동의 안내")을 생성해 사용(기존과 동일).
--     - 값 있음 → 그 값을 인사말로 사용.
--   ★ 고정부(동의 링크·동의번호·"동의는 선택/미동의 시 닉네임" 필수 문구·사용법)는 이 컬럼에 저장하지 않는다.
--     항상 코드가 effectiveConsentPassword 규칙으로 생성 → 안내문과 서버 검증이 어긋날 수 없게 한다.
--
-- 멱등: add column if not exists → 중복 실행 안전. 기존 행은 null(기본 인사말) → 동작 불변.
-- 롤백: alter table classes drop column if exists consent_notice_intro;  (필요 시 수동)
-- 사전 조건: classes 테이블(존재), step193(consent_password) 적용 완료.
-- ============================================

alter table classes add column if not exists consent_notice_intro text;

-- ============================================
-- 적용 확인:
-- select column_name from information_schema.columns
--   where table_name='classes' and column_name='consent_notice_intro';   -- 1행
-- ============================================
