-- step434: 일괄 쪽지 구분 플래그 — ⚠️ 이미 Supabase에 적용됨(기록용, 실행 불필요)
-- 일괄 발송(📢 일괄 안내)과 개별 답장을 화면에서 구분하기 위한 플래그.

alter table messages add column if not exists is_bulk boolean default false;

-- 소급 처리(적용 완료): 기존 일괄 발송분 415건을 true로 UPDATE함.
--   (당시 실행한 UPDATE는 일괄 발송 시각·sender 기준으로 대상 특정 — Supabase SQL Editor에서 수동 수행)

-- 검증: select is_bulk, count(*) from messages group by 1;
