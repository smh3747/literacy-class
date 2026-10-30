-- step660: 전국 챌린지 "상위 글 보기" 열람 계측 — 학생 본인이 창을 열어 글이 1편 이상 보인 응답 1건 = 1행
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run (멱등 — 중복 실행 안전)
--
-- 목적: "학생에게 상위 글이 실제로 보였는가"를 관리자 소개 글 패널에서 숫자 1개(열람 N회)로 본다.
--       지금까지는 성공 열람 기록이 없어 보였는지 증명할 길이 없었다(10/30 분석).
-- 기록처: /api/supply-ranking 성공 응답(winners 1편 이상)에서 학생 본인 토큰 + 열람 요청(view:true)일 때만
--         service role로 1행 insert. 엿보기(?as=)·교사·관리자·내 순위 조회(fetchMyRank)는 기록하지 않는다.
--         실패해도 응답은 그대로(계측은 부가 정보). peer_share_views(step625)와 같은 꼴.
-- 저장 값: student_id·supply_topic_id·created_at만. 본문·점수·실명 없음. FK 없음(주제·학생이 지워져도 집계 행은 남음).
-- 미적용 시: insert 실패를 삼키므로 학생 화면 무영향, 관리자 숫자만 0.

create table if not exists supply_showcase_views (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null,
  supply_topic_id uuid not null,
  created_at timestamptz not null default now()      -- 열람 시각(UTC 저장, 화면은 KST 변환)
);
create index if not exists idx_supply_showcase_views_supply on supply_showcase_views(supply_topic_id, created_at desc);

-- RLS: insert·update·delete 정책 없음(서버 service role 전용). select는 admin만.
alter table supply_showcase_views enable row level security;
drop policy if exists ssv_select_admin on supply_showcase_views;
create policy ssv_select_admin on supply_showcase_views for select to authenticated using (
  (select public.is_admin())
);

-- 검증:
--   select count(*) from supply_showcase_views;  → 0
--   select policyname, cmd from pg_policies where tablename='supply_showcase_views';  → ssv_select_admin / SELECT 1행
-- 정리(선택): delete from supply_showcase_views where created_at < now() - interval '90 days';
