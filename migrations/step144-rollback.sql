-- ============================================
-- step144 롤백: 임시 방어로 가입/작동이 깨졌을 때 원상복구
-- ============================================
-- 적용 후 문제가 생기면 이 SQL로 원래의 전체허용 정책으로 되돌린다.
-- (원래 상태로 복귀 — 보안은 다시 열리지만 앱은 확실히 작동)

-- classes
drop policy if exists "classes_select" on classes;
drop policy if exists "classes_write"  on classes;
drop policy if exists "classes_update" on classes;
drop policy if exists "classes_delete" on classes;
create policy "classes_all" on classes for all using (true) with check (true);

-- profiles
drop policy if exists "profiles_select" on profiles;
drop policy if exists "profiles_write"  on profiles;
drop policy if exists "profiles_update" on profiles;
drop policy if exists "profiles_delete" on profiles;
create policy "profiles_all" on profiles for all using (true) with check (true);

-- submissions
drop policy if exists "submissions_select" on submissions;
drop policy if exists "submissions_write"  on submissions;
drop policy if exists "submissions_update" on submissions;
drop policy if exists "submissions_delete" on submissions;
create policy "submissions_all" on submissions for all using (true) with check (true);

-- topics
drop policy if exists "topics_select" on topics;
drop policy if exists "topics_write"  on topics;
drop policy if exists "topics_update" on topics;
drop policy if exists "topics_delete" on topics;
create policy "topics_all" on topics for all using (true) with check (true);
