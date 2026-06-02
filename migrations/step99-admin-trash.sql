-- ============================================
-- step99 마이그레이션: 관리자 휴지통 (B4)
-- ============================================
-- 선생님 계정·학급을 안전하게 정리할 수 있는 휴지통 시스템.
-- 모든 삭제는 소프트 삭제(deleted_at) + 30일 후 자동 영구삭제.
-- ============================================

-- 1) profiles에 deleted_at (선생님 휴지통)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

COMMENT ON COLUMN profiles.deleted_at IS '소프트 삭제 시각. NULL이면 정상, 값 있으면 휴지통. 30일 후 cron이 영구삭제.';
COMMENT ON COLUMN profiles.deleted_by IS '누가 삭제했는지 (관리자 id)';
COMMENT ON COLUMN profiles.delete_reason IS '삭제 사유 (선택)';

CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at ON profiles(deleted_at) WHERE deleted_at IS NOT NULL;

-- 2) classes에 deleted_at (학급 휴지통)
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

COMMENT ON COLUMN classes.deleted_at IS '소프트 삭제 시각. NULL이면 정상.';

CREATE INDEX IF NOT EXISTS idx_classes_deleted_at ON classes(deleted_at) WHERE deleted_at IS NOT NULL;

-- ============================================
-- 안전장치 함수: 마지막 관리자 보호
-- 어드민 1명만 남았으면 그 어드민의 deleted_at 업데이트 금지
-- ============================================
CREATE OR REPLACE FUNCTION prevent_last_admin_deletion()
RETURNS TRIGGER AS $$
DECLARE
  active_admin_count INT;
BEGIN
  -- 어드민이 삭제되려는 경우만 검사
  IF OLD.role = 'admin' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    SELECT COUNT(*) INTO active_admin_count
      FROM profiles
      WHERE role = 'admin'
        AND deleted_at IS NULL
        AND id != OLD.id;
    IF active_admin_count = 0 THEN
      RAISE EXCEPTION '마지막 관리자는 삭제할 수 없습니다.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_last_admin_deletion ON profiles;
CREATE TRIGGER trg_prevent_last_admin_deletion
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_last_admin_deletion();

-- ============================================
-- 확인 쿼리:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name IN ('profiles', 'classes')
--   AND column_name IN ('deleted_at', 'deleted_by', 'delete_reason');
-- ============================================
