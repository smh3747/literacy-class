-- ============================================
-- step153 롤백: class_secrets 분리 되돌리기
-- ============================================
-- classes.api_key는 step153에서 비우지 않았으므로 동결 데이터가 그대로 살아 있다.
-- 따라서 롤백은 "class_secrets의 최신 키를 classes로 되돌린 뒤 테이블 제거"면 충분.
-- (혹시 step153 적용 후 교사가 ApiKeyManager로 키를 바꿔 class_secrets만 최신이고
--  classes.api_key가 과거 값일 수 있으므로, class_secrets → classes로 덮어쓴다.)
--
-- ⚠️ 롤백 시 구버전 코드(classes.api_key 사용)로 함께 되돌려야 키가 정상 동작.

-- 1) class_secrets의 키를 classes.api_key로 복원 (최신값 우선)
update classes c
set api_key = s.api_key
from class_secrets s
where s.class_id = c.id and s.api_key is not null;

-- 2) 정책 제거
drop policy if exists "csec_select" on class_secrets;
drop policy if exists "csec_insert" on class_secrets;
drop policy if exists "csec_update" on class_secrets;
drop policy if exists "csec_delete" on class_secrets;

-- 3) 테이블 제거
drop table if exists class_secrets;
