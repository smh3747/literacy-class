-- ============================================
-- step141: 맞춤법만 고친 수정본 제출 차단 (주제별 토글)
-- ============================================
-- require_rewrite_change = true 이면, 수정본이 첫 글과 90% 이상
-- 동일할 때 제출을 막는다. (기본값 false = 경고만, 제출은 허용)

alter table topics
  add column if not exists require_rewrite_change boolean not null default false;
