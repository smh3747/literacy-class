-- ============================================
-- step187: 학생 실명 잠금 저장 (pending_names 분리)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 실행 순서: 이 SQL을 먼저 실행 → 그다음 이를 사용하는 코드(암호화 저장)를 배포.
--   (테이블·RLS가 있는 상태에서 새 서버 코드가 올라와야 안전)
--
-- 사전 조건: step146 헬퍼 함수(is_admin / my_class_id 등)가 이미 적용돼 있어야 함.
--   (RLS 정책이 public.is_admin() 을 참조)
--
-- 배경: 부모 동의 전 신규 학생의 실명을 profiles.realname 평문으로 두지 않고,
--   AES-256-GCM으로 암호화해 교사·admin만 접근 가능한 별도 테이블에 보관한다.
--   복호화 키(NAME_ENCRYPTION_KEY)는 서버 환경변수에만 존재(클라이언트 노출 금지).
--   동의 완료 시 서버가 복호화해 profiles.realname을 채우는 흐름을 염두에 둔다.
--
-- 목표:
--   pending_names: 학생당 1행. 소유 교사(classes.teacher_id=auth.uid())와 admin만 접근.
--   학생·비로그인(anon)은 어떤 작업도 불가.
--   서버는 service_role 로 RLS를 우회해 insert/조회한다(students-bulk 등).
--
-- 롤백: step187-rollback.sql
-- ============================================

-- 1) 테이블 생성 (멱등)
create table if not exists pending_names (
  student_id uuid primary key references profiles(id) on delete cascade,  -- unique 보장(PK)
  class_id   uuid references classes(id) on delete cascade,
  enc_name   text,                          -- AES-256-GCM 암호문: iv+authTag+ciphertext를 한 문자열로 보관
  created_at timestamptz default now()
);

-- 1.1) 컬럼 보강 (테이블이 이미 일부만 존재할 때 대비 — 멱등)
alter table pending_names add column if not exists class_id   uuid;
alter table pending_names add column if not exists enc_name   text;
alter table pending_names add column if not exists created_at timestamptz default now();

-- 2) RLS 활성화
alter table pending_names enable row level security;

-- 3) 정책: 소유 교사 + admin만 전 작업. 학생·anon은 0행/거부.
--    (step153 class_secrets 정책 구조 그대로 — classes.teacher_id 조인으로 소유 교사 판정)
drop policy if exists "pn_select" on pending_names;
drop policy if exists "pn_insert" on pending_names;
drop policy if exists "pn_update" on pending_names;
drop policy if exists "pn_delete" on pending_names;

-- SELECT: admin 전체 / 소유 교사 본인 학급
create policy "pn_select" on pending_names for select to authenticated using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = pending_names.class_id and c.teacher_id = auth.uid()
  )
);

-- INSERT: 본인이 소유한 학급의 행만 (admin은 무제한)
create policy "pn_insert" on pending_names for insert to authenticated with check (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = pending_names.class_id and c.teacher_id = auth.uid()
  )
);

-- UPDATE: 소유 교사 + admin
create policy "pn_update" on pending_names for update to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = pending_names.class_id and c.teacher_id = auth.uid()
  )
)
with check (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = pending_names.class_id and c.teacher_id = auth.uid()
  )
);

-- DELETE: 소유 교사 + admin
create policy "pn_delete" on pending_names for delete to authenticated using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = pending_names.class_id and c.teacher_id = auth.uid()
  )
);

-- (참고) 소유권 판정은 class_secrets(step153)와 동일하게 classes.teacher_id 조인을 쓴다.
--   step146 my_class_id() 로 `pending_names.class_id = (select public.my_class_id())`
--   조건을 써도 교사에 대해선 동등하나, teacher_id 조인이 소유권상 더 명시적이라 step153 패턴을 따랐다.

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'pending_names';
--   → pn_select / pn_insert / pn_update / pn_delete 4행이어야 함
-- select relrowsecurity from pg_class where relname = 'pending_names';   -- t (RLS on)
-- ============================================
