-- ============================================
-- step206-D 백필: 기존 명렬표 학급 자가가입 일괄 차단
-- ============================================
-- 목적: step206-B 배포 이전에 이미 명렬표를 올린 기존 학급들도 self_signup_enabled=false 로
--       바꿔, 학생이 로그인 오타 → 가입 탭 → 새 유령계정 만드는 길을 막는다.
--
-- ★안전 기준(보수적): 대상은 "확실한 명렬표 학급"인 pending_names 보유 학급으로만 한정한다.
--   - pending_names = step187 이후 잠금 일괄등록(students-bulk)을 거친 확실한 명렬표 학급.
--   - batch 휴리스틱(5분 5명+)만으로 잡힌 애매한 학급은 ★이번 백필에서 제외(오탐 위험).
--     그 학급들은 다음에 명렬표를 다시 올리면 자동 OFF되거나, 교사가 학급설정 토글로 끄면 된다.
--   - 순수 자가가입 학급은 pending_names가 없으니 자연히 제외 → 영향 0.
--
-- 멱등: 이미 false인 학급은 그대로(영향 없음). 중복 실행 안전.
-- 전제: step206-A(self_signup_enabled 컬럼)·step187(pending_names) 이미 적용됨.
-- 실행: Supabase SQL Editor에 이 파일 전체 복붙 → Run.
-- 롤백: step206-D-rollback.sql (이 스크립트가 남기는 로그를 이용해 "이번에 바뀐 학급만" 복구)
-- ============================================

-- 0) 롤백용 스냅샷 테이블 — "이번 백필로 true/null → false 로 바뀔 학급"을 기록.
--    (이미 false였던 학급은 기록 안 함 → 롤백 시 원래 false였던 건 안 건드림)
create table if not exists step206d_backfill_log (
  class_id   uuid primary key,
  changed_at timestamptz default now()
);

insert into step206d_backfill_log (class_id)
select distinct p.class_id
from profiles p
join pending_names pn on pn.student_id = p.id
join classes c on c.id = p.class_id
where p.class_id is not null
  and c.self_signup_enabled is distinct from false   -- 현재 true 또는 null(=아직 안 막힌 명렬표 학급)
on conflict (class_id) do nothing;

-- 1) 본 백필 — pending_names 보유 학급을 모두 false 로(이미 false면 그대로).
update classes
set self_signup_enabled = false
where id in (
  select distinct p.class_id
  from profiles p
  join pending_names pn on pn.student_id = p.id
  where p.class_id is not null
);
