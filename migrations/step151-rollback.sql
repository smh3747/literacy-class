-- ============================================
-- step151 롤백: feedback 정책을 적용 전 상태로 복원
-- ============================================
-- 적용 전 스냅샷(pg_policies) 기준: feedback_all (ALL, true/true) 하나만 존재.
-- 참고: user_id 컬럼 추가는 되돌리지 않음 (additive + 의견보내기 버그 수정이라 유지).
--       password_reset_requests / topic_suggestion_logs / school_records /
--       tutor_chat_usage 는 step151에서 변경하지 않았으므로 롤백 대상 아님.

drop policy if exists "fb_insert" on feedback;
drop policy if exists "fb_select" on feedback;
drop policy if exists "fb_update" on feedback;
drop policy if exists "fb_delete" on feedback;

create policy "feedback_all" on feedback
  for all using (true) with check (true);
