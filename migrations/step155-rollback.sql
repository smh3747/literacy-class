-- ============================================
-- step155 롤백: error_logs 제거
-- ============================================
-- ⚠️ 코드도 함께 되돌려야 함 (logError 호출이 조용히 실패하긴 하나, admin 에러 탭은 깨짐).

drop policy if exists "elog_insert" on error_logs;
drop policy if exists "elog_select" on error_logs;
drop policy if exists "elog_delete" on error_logs;

drop table if exists error_logs;
