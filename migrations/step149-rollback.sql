-- ============================================
-- step149 롤백: classes 정책을 적용 전 상태로 복원
-- ============================================
-- 적용 전 스냅샷(pg_policies) 기준: classes_all (ALL, true/true) 하나만 존재.
-- ⚠️ api_key가 익명에게 다시 노출되는 큰 구멍이므로 문제 해결 후 반드시 재적용.
-- 참고: 동반 코드(/api/class-lookup 경유)는 구 정책에서도 정상 동작하므로
--       코드는 되돌릴 필요 없음.

drop policy if exists "cls_select" on classes;
drop policy if exists "cls_insert" on classes;
drop policy if exists "cls_update" on classes;
drop policy if exists "cls_delete" on classes;

create policy "classes_all" on classes
  for all using (true) with check (true);
