-- ============================================
-- step149: classes 정밀 RLS (3순위 — api_key 보호가 핵심)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 사전 조건: step146 헬퍼 함수 + ⚠️ 동반 코드가 먼저 배포되어 있어야 함!
--   (Vercel에 /api/class-lookup 라우트가 떠 있어야 학생 가입이 안 깨짐)
--
-- 목표:
--   SELECT: 소유 교사 / 내 학급 구성원 / admin   ※ 익명 0행 (api_key 보호!)
--   INSERT: teacher_id=auth.uid() (교사 가입 시 학급 생성)
--   UPDATE: 소유 교사 / admin
--   DELETE: admin만
--
-- 익명 학급코드 조회(학생 가입·QR 힌트)와 코드 중복확인은
-- /api/class-lookup (service_role, 안전 컬럼만 반환)으로 대체됨.
--
-- 효과: api_key는 본인 학급 구성원+담임+admin만 읽기 가능.
--   (같은 학급 학생에게 보이는 건 현 구조의 한계 — RLS-POLICY-PLAN.md 6번 참고)
-- 롤백: step149-rollback.sql
-- ============================================

alter table classes enable row level security;

-- 기존 정책 제거 (스냅샷 기준 classes_all / 방어적으로 step144 명칭도)
drop policy if exists "classes_all"    on classes;
drop policy if exists "classes_select" on classes;
drop policy if exists "classes_write"  on classes;
drop policy if exists "classes_update" on classes;
drop policy if exists "classes_delete" on classes;

-- SELECT: 소유 교사 + 내 학급 + admin (익명 정책 없음 = 익명 0행)
create policy "cls_select" on classes for select to authenticated using (
  teacher_id = auth.uid()
  or id = (select public.my_class_id())
  or (select public.is_admin())
);

-- INSERT: 본인이 소유자인 학급만 (교사/관리자 가입 직후)
create policy "cls_insert" on classes for insert to authenticated with check (
  teacher_id = auth.uid()
);

-- UPDATE: 소유 교사 + admin
create policy "cls_update" on classes for update to authenticated
using (teacher_id = auth.uid() or (select public.is_admin()))
with check (teacher_id = auth.uid() or (select public.is_admin()));

-- DELETE: admin만
create policy "cls_delete" on classes for delete to authenticated using (
  (select public.is_admin())
);

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'classes';
--   → cls_select / cls_insert / cls_update / cls_delete 4행이어야 함
-- ============================================
