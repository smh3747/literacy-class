-- ============================================
-- step92.1 마이그레이션: 추천 로그 RLS 보강
-- ============================================
-- step92 실행 후 403 Forbidden 에러가 나는 경우 추가 실행
--
-- 원인: insert().select() 패턴에서 RETURNING 절이 RLS의
-- SELECT 정책을 거치는데, 정책이 미묘하게 막힐 수 있음.
-- 코드는 select 없는 insert로 변경됐지만, 혹시 모를 다른
-- 케이스를 위해 정책을 명확히 합니다.
-- ============================================

-- 기존 정책 모두 제거 후 재생성 (멱등)
DROP POLICY IF EXISTS "Teachers see own suggestion logs" ON topic_suggestion_logs;
DROP POLICY IF EXISTS "Teachers insert own suggestion logs" ON topic_suggestion_logs;
DROP POLICY IF EXISTS "Teachers update own suggestion logs" ON topic_suggestion_logs;

-- SELECT: 본인 + 관리자
CREATE POLICY "Teachers see own suggestion logs" ON topic_suggestion_logs
  FOR SELECT TO authenticated
  USING (
    teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- INSERT: teacher_id가 자기 자신이거나 admin
CREATE POLICY "Teachers insert own suggestion logs" ON topic_suggestion_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- UPDATE: 본인 + 관리자
CREATE POLICY "Teachers update own suggestion logs" ON topic_suggestion_logs
  FOR UPDATE TO authenticated
  USING (
    teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 확인:
-- SELECT polname, polcmd, polqual FROM pg_policy WHERE polrelid = 'topic_suggestion_logs'::regclass;
