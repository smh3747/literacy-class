-- step380: 파운딩 멤버 사전 신청 테이블 (결제 아님, 관심 등록만)
-- 교사당 1회(teacher_id unique). Supabase SQL Editor에서 직접 실행하세요. 중복 실행 안전(멱등).

-- 1) 테이블 생성 (멱등)
create table if not exists preorders (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid not null unique references profiles(id) on delete cascade,
  created_at timestamptz default now()
);

-- 2) RLS 활성화 (이미 켜져 있어도 안전)
alter table preorders enable row level security;

-- 3) 정책 (드롭 후 재생성 — 멱등)
drop policy if exists "po_select" on preorders;
drop policy if exists "po_insert" on preorders;

-- 본인 행 조회 + admin 전체 조회
create policy "po_select" on preorders for select to authenticated
  using ( teacher_id = auth.uid() or (select public.is_admin()) );

-- 교사 본인만 insert (teacher_id = 본인, role = teacher)
create policy "po_insert" on preorders for insert to authenticated
  with check ( teacher_id = auth.uid() and (select public.my_role()) = 'teacher' );

-- update/delete 정책 없음 = 전면 차단 (신청 취소는 이번 범위 밖)

-- 검증:
-- select policyname, cmd from pg_policies where tablename = 'preorders';   → 2행 (po_select/SELECT, po_insert/INSERT)
-- select relrowsecurity from pg_class where relname = 'preorders';         → true
