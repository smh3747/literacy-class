-- step382: 사전 신청 응답 구분 추가 (관심 있어요 / 아직 잘 모르겠어요)
-- 기존 행은 default로 'interested'가 된다(기존 신청자는 관심 신청이었으므로 정확). RLS 불변.
-- Supabase SQL Editor에서 직접 실행하세요. 중복 실행 안전(멱등).

alter table preorders add column if not exists
  response text not null default 'interested' check (response in ('interested','not_sure'));

-- 검증:
-- select response, count(*) from preorders group by response;   → 기존 신청 건은 모두 interested
