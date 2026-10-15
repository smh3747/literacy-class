-- step625: 우리 반 글 모음 열람 계측 — 학생 조회 1건 = 1행(학급·주제·KST 날짜만)
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run (멱등 — 중복 실행 안전)
--
-- 목적: "글 모음을 켠 학급에서 학생이 실제로 친구 글을 보는가"를 관리자가 두 숫자로 본다
--       (글 모음 ON 학급 수 / 최근 7일 열람 수). 학생 ID·본문·점수는 저장하지 않는다.
-- 기록처: /api/peer-share 학생 list 응답에서 카드가 실제로 뜨는 경우(ON + 본인 제출 있음 + 보여줄 글 1편 이상)에
--         service role로 1행 insert. 실패해도 응답은 그대로(계측은 부가 정보).
-- 관행: api_rate_limit(step165)처럼 호출 1건당 1행. FK를 두지 않아 주제·학급이 지워져도 집계 행은 남는다.
-- 미적용 시: insert 실패를 삼키므로 학생·교사 화면 무영향, 관리자 숫자만 0.

create table if not exists peer_share_views (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null,
  topic_id uuid not null,
  view_date date not null,                 -- 서버가 KST 날짜(YYYY-MM-DD)로 넣음
  created_at timestamptz not null default now()
);
create index if not exists idx_peer_share_views_created on peer_share_views(created_at desc);

-- RLS: insert·update·delete 정책 없음(서버 service role 전용). select는 admin만(관리자 화면 head count).
alter table peer_share_views enable row level security;
drop policy if exists psv_select_admin on peer_share_views;
create policy psv_select_admin on peer_share_views for select to authenticated using (
  (select public.is_admin())
);

-- 검증:
--   select count(*) from peer_share_views;  → 0
--   select policyname, cmd from pg_policies where tablename='peer_share_views';  → psv_select_admin / SELECT 1행
-- 정리(선택): delete from peer_share_views where created_at < now() - interval '90 days';
