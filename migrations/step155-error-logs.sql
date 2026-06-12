-- ============================================
-- step155: 에러 로깅 시스템
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 목적: 학생/교사 화면·서버에서 발생한 에러를 운영자(admin)가 볼 수 있게 수집.
-- 사전 조건: step146 헬퍼 함수(is_admin)가 이미 적용돼 있어야 함.
--
-- 보존: cron-trash-cleanup이 30일 지난 행을 자동 삭제 (테이블 무한 증가 방지).
-- 롤백: step155-rollback.sql
-- ============================================

create table if not exists error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  role text default 'unknown',           -- student / teacher / admin / unknown
  user_id uuid,                            -- nullable (비로그인/미해결)
  class_id uuid,                           -- nullable
  page text,                               -- 경로 또는 기능명 (예: 'student/index', 'api/ai')
  error_type text,                         -- ai_call / js_error / api_error 등
  message text,                            -- 에러 메시지 (클라이언트에서 500자로 자름)
  context jsonb,                           -- 선택 부가정보 (개인정보 금지)
  user_agent text
);

create index if not exists idx_error_logs_created on error_logs(created_at desc);

alter table error_logs enable row level security;

-- INSERT: 로그인 사용자 전원 허용 (비로그인 스팸 차단 위해 anon 제외)
drop policy if exists "elog_insert" on error_logs;
create policy "elog_insert" on error_logs for insert to authenticated with check (true);

-- SELECT: admin만
drop policy if exists "elog_select" on error_logs;
create policy "elog_select" on error_logs for select to authenticated using (
  (select public.is_admin())
);

-- DELETE: admin만 (cron은 service_role이라 RLS 우회)
drop policy if exists "elog_delete" on error_logs;
create policy "elog_delete" on error_logs for delete to authenticated using (
  (select public.is_admin())
);

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'error_logs';
--   → elog_insert / elog_select / elog_delete 3행
-- ============================================
