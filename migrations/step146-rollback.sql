-- ============================================
-- step146 롤백: RLS 헬퍼 함수 제거
-- ============================================
-- step146-rls-helpers.sql 적용을 되돌립니다.
-- ⚠️ 주의: step147 이후 정책이 이 함수들을 참조하면 drop이 실패하거나
-- 정책이 깨집니다. 반드시 step147+ 정책을 먼저 롤백한 뒤 실행하세요.

drop function if exists public.my_role();
drop function if exists public.my_class_id();
drop function if exists public.is_admin();
drop function if exists public.is_my_classmate(uuid);
drop function if exists public.my_class_teacher_id();
