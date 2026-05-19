-- step71: 학생 번호 자릿수 안내용 컬럼 추가
-- 1 = "1, 2, ... 25" (한 자리)
-- 2 = "01, 02, ... 25" (두 자리, 일괄 등록 시 흔함)

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS login_number_digits INTEGER DEFAULT 2;

COMMENT ON COLUMN classes.login_number_digits IS '학생 번호 자릿수 (1 또는 2). 일괄 등록 시 보통 2자리(01, 02)';
