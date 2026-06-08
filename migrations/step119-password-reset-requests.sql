-- ============================================
-- step119: 비밀번호 초기화 요청
-- ============================================
-- 비번을 잊은 선생님은 로그인을 못 해서 앱 안에서 연락할 방법이 없음.
-- 로그인 화면에서 비로그인 상태로 요청을 남기면 관리자 페이지에 표시됨.
-- ============================================

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  realname TEXT NOT NULL,
  school TEXT,
  contact TEXT,           -- 연락 방법 (선택: 전화, 카톡 등)
  message TEXT,           -- 추가 메모
  status TEXT DEFAULT 'pending',  -- pending / done
  created_at TIMESTAMPTZ DEFAULT now(),
  handled_at TIMESTAMPTZ
);

ALTER TABLE password_reset_requests ENABLE ROW LEVEL SECURITY;

-- 누구나(비로그인 포함) 요청 등록 가능 — 단 조회는 불가
DROP POLICY IF EXISTS "Anyone can insert reset request" ON password_reset_requests;
CREATE POLICY "Anyone can insert reset request" ON password_reset_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- 관리자만 조회·수정 가능
DROP POLICY IF EXISTS "Admin can view reset requests" ON password_reset_requests;
CREATE POLICY "Admin can view reset requests" ON password_reset_requests
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admin can update reset requests" ON password_reset_requests;
CREATE POLICY "Admin can update reset requests" ON password_reset_requests
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_pwreset_pending
  ON password_reset_requests(created_at DESC)
  WHERE status = 'pending';
