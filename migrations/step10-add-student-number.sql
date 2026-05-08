-- ============================================
-- step10 마이그레이션: 학생 번호 컬럼 추가
-- ============================================
-- 실행 위치: Supabase Dashboard → SQL Editor
-- 안전성: IF NOT EXISTS로 중복 실행해도 OK

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS number TEXT;

-- 학생 페이지에 학년/반/번호를 표시하기 위해 필요한 컬럼입니다.
-- TEXT 타입으로 둔 이유: "01", "10" 같이 앞자리 0이 있는 번호 보존 가능

-- 확인 쿼리:
-- SELECT id, realname, username, number FROM profiles WHERE role = 'student' LIMIT 5;
