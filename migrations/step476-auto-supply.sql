-- step476: 전국 공통 주제 2차(자동 받기) — ⚠️ 이미 Supabase에 적용됨(기록용, 실행 불필요)
-- 자동 등록 = /api/supply-adopt(service role)가 오늘(KST) 발행 공급 주제를 담임 앞으로 복사 insert.
--   "오늘 발행" 판정은 date 컬럼이 아니라 published_at이 오늘 KST 00:00 ~ now() 창인지로 한다
--   (예약 발행은 topics.date에 클릭일이 저장되므로 date 비교는 부정확 — pages/admin/index.js 참고).
-- 복사본은 supply_type/published_at을 복사하지 않는 일반 topics 행(source_supply_id로만 출처 표시).

alter table classes add column if not exists auto_supply_enabled boolean default false;  -- 🌏 자동 받기 토글
alter table topics add column if not exists source_supply_id uuid references topics(id); -- 원본 공급 주제 FK

-- 같은 공급 주제를 한 교사에게 두 번 등록 불가(동시 lazy 호출 경합은 23505로 무해하게 수렴)
create unique index if not exists uq_topics_source_supply_teacher
  on topics(source_supply_id, teacher_id) where source_supply_id is not null;

-- 검증: select id, title, teacher_id, source_supply_id from topics where source_supply_id is not null;
