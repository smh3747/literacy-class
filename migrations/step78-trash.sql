-- step78: 쓰레기통 (soft delete) 기능
-- 학생 글을 즉시 영구 삭제하지 않고 30일(기본) 보관 후 자동 삭제

-- submissions 테이블에 soft delete 컬럼 추가
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_by UUID,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

COMMENT ON COLUMN submissions.deleted_at IS '쓰레기통으로 이동된 시각 (NULL=활성, 값 있음=쓰레기통)';
COMMENT ON COLUMN submissions.deleted_by IS '쓰레기통으로 보낸 선생님 ID';
COMMENT ON COLUMN submissions.delete_reason IS '삭제 사유 (선생님 메모, 선택)';

-- 인덱스 추가 (쓰레기통 조회 성능)
CREATE INDEX IF NOT EXISTS idx_submissions_deleted_at ON submissions(deleted_at) WHERE deleted_at IS NOT NULL;

-- classes 테이블에 자동 삭제 기간 설정 추가
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS trash_retention_days INTEGER DEFAULT 30;

COMMENT ON COLUMN classes.trash_retention_days IS '쓰레기통 자동 삭제 기간 (일, 기본 30일)';
