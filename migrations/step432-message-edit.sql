-- step432: 쪽지 수정·소프트 삭제 컬럼 — ⚠️ 이미 Supabase에 적용됨(기록용, 실행 불필요)
-- 수정·삭제는 pages/api/message-edit.js(service role)가 sender 본인 확인 후 수행. RLS 불변.
-- 삭제는 소프트(deleted_at) — 본문은 남기고 화면에서 "삭제된 쪽지예요"로 대체 렌더.

alter table messages add column if not exists edited_at timestamptz;
alter table messages add column if not exists deleted_at timestamptz;

-- 검증: select id, edited_at, deleted_at from messages limit 1;
