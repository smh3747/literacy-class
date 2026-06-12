-- ============================================
-- step150 롤백: topics 정책을 적용 전 상태로 복원
-- ============================================
-- 적용 전 스냅샷(pg_policies) 기준: topics_all (ALL, true/true) 하나만 존재.
-- ⚠️ 문제 해결 후 반드시 재적용하세요.

drop policy if exists "top_select" on topics;
drop policy if exists "top_insert" on topics;
drop policy if exists "top_update" on topics;
drop policy if exists "top_delete" on topics;

create policy "topics_all" on topics
  for all using (true) with check (true);
