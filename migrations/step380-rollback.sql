-- step380 롤백: preorders 테이블 제거 (사전 신청 기록이 모두 삭제되니 주의)
drop policy if exists "po_select" on preorders;
drop policy if exists "po_insert" on preorders;
drop table if exists preorders;
