-- ============================================
-- step206-D 검증: 백필 결과 확인
-- ============================================
-- 이 파일 전체 복붙 → Run. 아래 5개 결과를 한 번에 확인한다.
-- ============================================

-- ① 백필 대상(명렬표=pending 보유) 학급 수 — 이게 곧 "막혀야 할 학급 수"
select '대상(pending 보유) 학급 수' as check, count(*) as n
from (
  select distinct p.class_id
  from profiles p
  join pending_names pn on pn.student_id = p.id
  where p.class_id is not null
) t;

-- ② ★완료 확인: pending 보유 학급 중 아직 false 가 아닌 학급 수 → 0 이어야 백필 성공
select 'pending 학급 중 미차단(false 아님)' as check, count(*) as n
from classes c
where c.self_signup_enabled is distinct from false
  and c.id in (
    select distinct p.class_id from profiles p
    join pending_names pn on pn.student_id = p.id
    where p.class_id is not null
  );

-- ③ 이번 백필로 실제 바뀐 학급 수(롤백 로그 행 수)
select '이번 백필로 바뀐 학급 수(로그)' as check, count(*) as n
from step206d_backfill_log;

-- ④ 전체 false 학급 수 / 그 중 pending 없는 학급 수
--    ※ pending 없는 false 학급이 곧 오탐은 아님: step206-B 배포 후 students-bulk(일괄/한 명 추가)나
--      교사 토글로 정당하게 false 된 명렬표(평문) 학급도 여기 포함됨. "참고 카운트"로만 본다.
select '전체 차단(false) 학급' as check,
       count(*) filter (where c.self_signup_enabled is false) as false_total,
       count(*) filter (
         where c.self_signup_enabled is false
           and not exists (
             select 1 from profiles p join pending_names pn on pn.student_id = p.id
             where p.class_id = c.id
           )
       ) as false_without_pending
from classes c;

-- ⑤ 안전 점검: 백필 로그에 든 학급이 전부 실제 false 인지(true로 남은 게 있으면 update 누락)
select '로그 학급 중 아직 true/null' as check, count(*) as n
from classes c
join step206d_backfill_log l on l.class_id = c.id
where c.self_signup_enabled is distinct from false;
