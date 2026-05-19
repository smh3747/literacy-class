-- step70: 학생 로그인 안내 (QR 진입 시 표시)
-- 선생님이 학급 설정에서 입력하면 학생들에게 안내 자동 표시

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS login_hint_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS login_username_prefix TEXT,
  ADD COLUMN IF NOT EXISTS login_default_password TEXT;

COMMENT ON COLUMN classes.login_hint_enabled IS '학생 로그인 안내 활성화 (QR 진입 시 표시)';
COMMENT ON COLUMN classes.login_username_prefix IS '학급 공통 아이디 접두사 (예: hr5 → hr51, hr52, ...)';
COMMENT ON COLUMN classes.login_default_password IS '초기 비밀번호 안내 (예: 1234)';
