-- ============================================
-- step206-A 검증: step206-self-signup.sql 적용 확인
-- ============================================
-- 이 파일 전체 복붙 → Run. 아래 결과를 확인한다.
-- ============================================

-- ① self_signup_enabled 컬럼 생겼는지 + 기본값 true 인지 (1행, column_default = true)
select 'classes self_signup_enabled' as check, column_name, data_type, column_default
from information_schema.columns
where table_name = 'classes' and column_name = 'self_signup_enabled';

-- ② 기존 학급들이 모두 true(또는 null=기본 true 취급)인지 확인 (영향 0 확인용)
--    false 행이 0이어야 함 — 지금은 아무 학급도 막히지 않은 상태.
select 'enabled 분포' as check,
       count(*) filter (where self_signup_enabled is true)  as enabled_true,
       count(*) filter (where self_signup_enabled is false) as enabled_false,
       count(*) filter (where self_signup_enabled is null)  as enabled_null,
       count(*)                                             as total
from classes;
