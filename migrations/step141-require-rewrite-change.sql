-- ============================================
-- step141: 맞춤법만 고친 수정본 제출 차단 (주제별 토글)
-- ============================================
-- require_rewrite_change = true 이면, 수정본이 첫 글과 90% 이상
-- 동일할 때 제출을 막는다. 기본값 true (켜짐).

-- 컬럼이 없으면 기본값 true로 추가
alter table topics
  add column if not exists require_rewrite_change boolean not null default true;

-- 이미 컬럼이 있던 경우(이전 버전으로 false 기본값 실행했던 경우) 기본값을 true로 변경
alter table topics
  alter column require_rewrite_change set default true;
