-- step464: 주제 공급 v2(원버튼 시사·학년대) — ⚠️ 사용자가 Supabase에 직접 적용(기록용)
-- supply_grade: 공급 주제의 대상 학년대('3~4학년'|'5~6학년'|'공통') — 2차 교사 노출 필터에도 사용 예정.

alter table topics add column if not exists supply_grade text;

-- 검증: select title, supply_type, supply_grade from topics where supply_type is not null;
