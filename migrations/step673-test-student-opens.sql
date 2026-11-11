-- step673: 관리자 "🧪 시험 학생으로 열기" 발급 기록
--   수동 적용(Supabase SQL Editor). 여러 번 실행해도 안전하다.
--   pages/api/admin-test-student.js가 로그인 링크를 내줄 때마다 누가(admin_id)·언제(created_at)·어느 시험 학생(student_id, slot)을 적는다.
--   이 표가 없으면 API는 링크를 내주지 않는다(기록 실패 시 발급 거부).
--   RLS를 켜고 정책을 두지 않는다 → 서비스 롤(서버)만 읽고 쓴다.

create table if not exists test_student_opens (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  student_id uuid not null,
  slot integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_test_student_opens_created on test_student_opens (created_at desc);

alter table test_student_opens enable row level security;

-- 확인: select * from test_student_opens order by created_at desc limit 10;
