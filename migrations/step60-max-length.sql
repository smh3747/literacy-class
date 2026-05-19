-- step60: 주제별 글 최대 길이 (토큰 절약 + 한도 효율 개선)
-- NULL이면 제한 없음

ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS max_length INTEGER;
