-- step64: 학생 아이디 변경 시 잘못된 이메일 도메인 복구
-- step54 버그로 인해 @literacy.local로 잘못 저장된 학생들을 @writing.class로 복구

-- Supabase Dashboard → SQL Editor에서 실행
-- 1. 영향받은 사용자 확인 (실행 전 미리 보기)
SELECT id, email FROM auth.users WHERE email LIKE '%@literacy.local';

-- 2. 위 결과 확인 후 아래 UPDATE 실행 (한 번에 다 바꿈)
UPDATE auth.users
SET email = REPLACE(email, '@literacy.local', '@writing.class')
WHERE email LIKE '%@literacy.local';

-- 3. 변경 확인
-- SELECT id, email FROM auth.users WHERE email LIKE '%@writing.class';
