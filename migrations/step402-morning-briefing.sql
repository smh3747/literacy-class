-- step402: 교사 아침 브리핑 캐시 컬럼 (classes)
-- morning_briefing_text: 최근 생성된 지도 멘트(tip) / morning_briefing_source_topic_id: 그 근거 주제(중복방지 마커)
-- ⚠️ 이미 Supabase에 수동 적용된 컬럼의 기록용. 멱등이라 재실행 안전(이미 있으면 무시).
alter table classes add column if not exists morning_briefing_text text;
alter table classes add column if not exists morning_briefing_source_topic_id uuid;

-- 검증: select morning_briefing_text, morning_briefing_source_topic_id from classes limit 1;
