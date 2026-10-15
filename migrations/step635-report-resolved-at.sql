-- step635: 학생 피드백 신고 해결 시각 (선택 적용 — 미적용이어도 앱은 정상, 해결 시각만 비표시)
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run (멱등)
--
-- 배경: 담임 "✓ 확인 완료"가 reported_at·report_reason을 지워 해결 이력이 사라졌다. step635부터 해결은
--       reported=false만 바꾸고(reported_at·report_reason 보존), 이 컬럼이 있으면 해결 시각도 함께 적는다.
--       코드는 이 컬럼 update를 별도 호출로 시도하고 실패(컬럼 없음)는 무시한다.
alter table submissions add column if not exists report_resolved_at timestamptz;

-- 검증: select column_name from information_schema.columns where table_name='submissions' and column_name='report_resolved_at';  → 1행
