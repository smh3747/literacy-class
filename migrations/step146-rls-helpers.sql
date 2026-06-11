-- ============================================
-- step146: RLS 헬퍼 함수 (SECURITY DEFINER)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- RLS 정밀 정책(step147~)의 공통 기반.
-- profiles 정책이 profiles 자신을 참조하면 무한 재귀가 발생하므로,
-- RLS를 우회(SECURITY DEFINER)하는 작은 헬퍼 함수로 분리합니다.
--
-- 이 단계는 함수만 만들 뿐 기존 정책을 건드리지 않으므로
-- 앱 동작에 아무 영향이 없습니다 (안전).
-- 롤백: step146-rollback.sql
-- ============================================

-- 현재 로그인 사용자의 역할 (비로그인이면 null)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;

-- 현재 로그인 사용자의 학급 id (비로그인/무소속이면 null)
create or replace function public.my_class_id() returns uuid
language sql stable security definer set search_path = public as
$$ select class_id from profiles where id = auth.uid() $$;

-- 관리자 여부
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'admin' from profiles where id = auth.uid()), false) $$;

-- 대상 user_id가 나와 같은 학급 소속인가 (학생·교사 무관)
create or replace function public.is_my_classmate(target uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists(
     select 1 from profiles
     where id = target and class_id is not null and class_id = public.my_class_id()
   ) $$;

-- 내 학급의 담임 teacher_id (학생이 담임의 topics를 볼 때 사용)
create or replace function public.my_class_teacher_id() returns uuid
language sql stable security definer set search_path = public as
$$ select teacher_id from classes where id = public.my_class_id() $$;

-- 실행 권한 (정책 평가 시 필요)
grant execute on function
  public.my_role(), public.my_class_id(), public.is_admin(),
  public.is_my_classmate(uuid), public.my_class_teacher_id()
to authenticated, anon;

-- ============================================
-- 적용 확인 쿼리 (Run 후 같은 창에서 실행해보세요):
-- ============================================
-- select public.my_role(), public.my_class_id(), public.is_admin();
--   → SQL Editor는 비로그인 컨텍스트라 (null, null, false)가 정상입니다.
--
-- 함수 5개가 생겼는지:
-- select proname from pg_proc
--   where pronamespace = 'public'::regnamespace
--   and proname in ('my_role','my_class_id','is_admin','is_my_classmate','my_class_teacher_id');
