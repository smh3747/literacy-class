-- step462: 주제 자동 공급 1차(관리자 발행 도구) — ⚠️ 이미 Supabase에 적용됨(기록용, 실행 불필요)
-- 공급 주제 = topics 행에 supply_type을 채운 것(teacher_id=관리자 본인, class_id 미사용 관행 유지).
-- 예약 발행: published_at에 미래 시각 저장 — 크론 불필요. 2차(교사 노출)의 조회 쿼리가
--   supply_type is not null AND published_at <= now() 조건으로 읽으면 자동 공개와 동일 효과.
-- 발행 취소 = published_at null(삭제 아님).

alter table topics add column if not exists supply_type text;      -- '시사' | '교육과정'
alter table topics add column if not exists publish_week text;     -- KST ISO 주차 'YYYY-Www'
alter table topics add column if not exists published_at timestamptz;

-- 검증: select title, supply_type, publish_week, published_at from topics where supply_type is not null;
