-- ============================================
-- step206-A 생성: classes.self_signup_enabled (학생 자가가입 허용 토글)
-- ============================================
-- 목적: 명렬표(일괄등록) 학급에서 학생이 로그인 오타 → 가입 탭 전환 → 새 유령계정 생성되는 문제 차단.
--       학급별로 자가가입(가입 탭) 허용 여부를 켜고 끈다.
--
-- ★ 기본값 true: 기존 학급·신규 학급 모두 일단 가입 허용 → 이 마이그레이션만으로는 동작 변화 0.
--   명렬표 학급은 step206-B(코드: 일괄등록 시 자동 false) / step206-C(백필)에서 false로 전환.
--   지금은 컬럼만 추가한다.
--
-- 멱등: add column if not exists → 중복 실행 안전.
-- 실행: Supabase SQL Editor에 이 파일 전체 복붙 → Run.
-- ============================================

alter table classes add column if not exists self_signup_enabled boolean default true;
