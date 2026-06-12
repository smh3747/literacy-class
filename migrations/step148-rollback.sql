-- ============================================
-- step148 롤백: profiles 정책을 적용 전 상태로 복원
-- ============================================
-- 적용 전 스냅샷(pg_policies) 기준: profiles_all (ALL, true/true) 하나만 존재.
-- ⚠️ 보안 구멍이 다시 열리는 것이므로 문제 해결 후 반드시 재적용하세요.
-- 참고: 동반 코드 수정(닉네임 부여 순서, verify-code admin 확인)은
--       구 정책에서도 정상 동작하므로 코드는 되돌릴 필요 없음.

drop policy if exists "prof_select" on profiles;
drop policy if exists "prof_insert" on profiles;
drop policy if exists "prof_update" on profiles;
drop policy if exists "prof_delete" on profiles;

create policy "profiles_all" on profiles
  for all using (true) with check (true);
