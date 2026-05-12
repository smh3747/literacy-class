-- ============================================
-- step11 통합 마이그레이션 (한 번에 실행)
-- ============================================
-- 실행 위치: Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
-- 안전성: IF NOT EXISTS / IF NOT EXISTS로 중복 실행해도 OK

-- ① 학생 번호 컬럼 (step10에서 이미 있어도 OK)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS number TEXT;

-- ② 학부모 동의서 회신 여부 (담임이 수동 체크)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS consent_received BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS consent_received_at TIMESTAMPTZ;

-- ③ 주제별 수업 시간 락 (글쓰기 가능 시간대 제한)
-- lock_enabled가 true면 lock_start_time~lock_end_time 사이에만 제출 가능
-- 시간은 HH:MM 형식 문자열 (예: "09:00", "10:40")
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS lock_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS lock_start_time TEXT;
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS lock_end_time TEXT;

-- ④ AI 피드백 신고
-- 학생이 피드백을 "이상해요"로 신고하면 reported=true가 됨
-- report_reason은 학생이 입력한 신고 사유 (선택)
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS reported BOOLEAN DEFAULT FALSE;
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS report_reason TEXT;
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;

-- ⑤ 신고된 피드백을 빠르게 찾기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_submissions_reported
  ON submissions(reported) WHERE reported = TRUE;

-- ============================================
-- 적용 후 확인 쿼리 (선택)
-- ============================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'profiles' AND column_name IN ('number', 'consent_received');
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'topics' AND column_name LIKE 'lock_%';
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'submissions' AND column_name LIKE 'report%';
