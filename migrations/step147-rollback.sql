-- ============================================
-- step147 롤백: submissions 정책을 적용 전 상태로 복원
-- ============================================
-- 적용 전 스냅샷(pg_policies) 기준: submissions_all (ALL, true/true) 하나만 존재.
-- step147이 만든 정밀 정책 4개를 제거하고 전체 허용으로 되돌립니다.
-- ⚠️ 보안 구멍이 다시 열리는 것이므로 문제 해결 후 반드시 재적용하세요.

drop policy if exists "sub_select" on submissions;
drop policy if exists "sub_insert" on submissions;
drop policy if exists "sub_update" on submissions;
drop policy if exists "sub_delete" on submissions;

create policy "submissions_all" on submissions
  for all using (true) with check (true);
