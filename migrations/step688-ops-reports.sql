-- step688: 매일 운영 보고서 저장 표 + DB 용량 읽기 함수
-- 적용: Supabase SQL Editor에서 수동 실행. 다시 실행해도 안전하다.
-- 개인정보: 학생 실명·글 본문을 저장하지 않는다. 수치와 학급 이름(학교·반)만 담는다.
-- 쓰기: 서비스 롤 전용(pages/api/cron-ops-report.js, pages/api/admin-ops-report.js). 읽기: 관리자만(RLS).
-- 되돌리기: drop table if exists ops_reports; drop function if exists ops_db_size();

create table if not exists ops_reports (
  -- 보고 날짜(한국 날짜). 집계 구간은 전날 15:00 ~ 이 날짜 15:00(KST).
  report_date date primary key,
  -- 판정: green / yellow / red
  verdict text not null check (verdict in ('green', 'yellow', 'red')),
  -- 수치 전체(JSON). 항목 구성은 lib/opsReport.js buildReport 참고.
  metrics jsonb not null default '{}'::jsonb,
  -- 사람이 읽는 사실 문장 3줄
  lines text[] not null default '{}',
  -- 만든 경로: cron(매일 자동) / manual(지금 보고 만들기) / backfill(지난 날짜 채우기)
  source text not null default 'cron',
  -- 만든 시각
  created_at timestamptz not null default now()
);

alter table ops_reports enable row level security;

drop policy if exists ops_reports_admin_select on ops_reports;
create policy ops_reports_admin_select on ops_reports
  for select to authenticated using (public.is_admin());

-- DB 전체 용량(바이트). 서비스 롤만 부를 수 있다.
create or replace function public.ops_db_size() returns bigint
language sql stable security definer set search_path = public as
$$ select pg_database_size(current_database()) $$;

revoke all on function public.ops_db_size() from public, anon, authenticated;
grant execute on function public.ops_db_size() to service_role;

-- 검증 1: select count(*) from ops_reports;  → 0
-- 검증 2: select relrowsecurity from pg_class where relname = 'ops_reports';  → true
-- 검증 3: select policyname from pg_policies where tablename = 'ops_reports';  → ops_reports_admin_select 1행
-- 검증 4: select pg_size_pretty(public.ops_db_size());  → 용량 1행
