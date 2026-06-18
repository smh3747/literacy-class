-- ============================================
-- step209 검증: consents.source 추가 확인
-- ============================================
-- 아래 ①②를 각각 따로 실행(블록 선택 후 Run)하거나, 한 번에 Run 해도 된다.
-- ============================================

-- ① consents 테이블 컬럼 목록 — source 컬럼이 생겼는지 확인 (source 행에 default 'online' 보여야 함)
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'consents'
order by ordinal_position;


-- ② source별 개수 집계 — 기존 행이 전부 'online'으로 채워졌는지 확인
--    (아직 종이 기록이 없으면 'online' 한 줄만 나오는 게 정상)
select source, count(*) as cnt
from consents
group by source
order by source;
