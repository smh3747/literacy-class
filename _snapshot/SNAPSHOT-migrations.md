# SNAPSHOT — migrations/  (76 files)

> 다온클래스 소스 스냅샷. 생성 기준 디렉터리: `migrations/`

## migrations/step10-add-student-number.sql

```sql
-- ============================================
-- step10 마이그레이션: 학생 번호 컬럼 추가
-- ============================================
-- 실행 위치: Supabase Dashboard → SQL Editor
-- 안전성: IF NOT EXISTS로 중복 실행해도 OK

ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS number TEXT;

-- 학생 페이지에 학년/반/번호를 표시하기 위해 필요한 컬럼입니다.
-- TEXT 타입으로 둔 이유: "01", "10" 같이 앞자리 0이 있는 번호 보존 가능

-- 확인 쿼리:
-- SELECT id, realname, username, number FROM profiles WHERE role = 'student' LIMIT 5;

```

## migrations/step108-per-suggestion-share.sql

```sql
-- ============================================
-- step108 마이그레이션: 추천 개별(카드 단위) 공유
-- ============================================
-- 기존: is_shared 토글이 로그(묶음) 단위 → 3개 추천이 통째로 공유됨
-- 변경: shared_indexes (JSONB 배열)로 개별 추천만 공유
-- 예: 추천 3개 중 1번만 공유 → shared_indexes = [0]
-- ============================================

ALTER TABLE topic_suggestion_logs
  ADD COLUMN IF NOT EXISTS shared_indexes JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN topic_suggestion_logs.shared_indexes IS
  '명시적으로 공유된 추천의 인덱스 배열. 예: [0, 2]. 빈 배열이면 명시 공유 없음.';

-- 기존 is_shared = true 로그 → 모든 추천 인덱스를 shared_indexes로 변환
UPDATE topic_suggestion_logs
SET shared_indexes = (
  SELECT COALESCE(jsonb_agg(idx), '[]'::jsonb)
  FROM generate_series(0, jsonb_array_length(suggestions) - 1) AS idx
)
WHERE is_shared = true
  AND (shared_indexes IS NULL OR shared_indexes = '[]'::jsonb);

-- RLS 정책 갱신: shared_indexes에 하나라도 있으면 공유로 취급
DROP POLICY IF EXISTS "Teachers see own suggestion logs" ON topic_suggestion_logs;
DROP POLICY IF EXISTS "Teachers see own and shared suggestion logs" ON topic_suggestion_logs;

CREATE POLICY "Teachers see own and shared suggestion logs" ON topic_suggestion_logs
  FOR SELECT TO authenticated
  USING (
    teacher_id = auth.uid()
    OR (resulting_topic_id IS NOT NULL)
    OR (is_shared = true)
    OR (jsonb_array_length(COALESCE(shared_indexes, '[]'::jsonb)) > 0)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 인덱스 (shared_indexes 비어있지 않은 것)
CREATE INDEX IF NOT EXISTS idx_topic_sug_partial_shared
  ON topic_suggestion_logs(created_at DESC)
  WHERE jsonb_array_length(shared_indexes) > 0;

```

## migrations/step11-all-features.sql

```sql
-- ============================================
-- step11 통합 마이그레이션 (한 번에 실행)
-- ============================================
-- 실행 위치: Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
-- 안전성: IF NOT EXISTS / IF NOT EXISTS로 중복 실행해도 OK

-- ① 학생 번호 컬럼 (step10에서 이미 있어도 OK)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS number TEXT;

-- ② 학부모 동의서 회신 여부 (담임이 수동 체크)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS consent_received BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS consent_received_at TIMESTAMPTZ;

-- ③ 주제별 수업 시간 락 (글쓰기 가능 시간대 제한)
-- lock_enabled가 true면 lock_start_time~lock_end_time 사이에만 제출 가능
-- 시간은 HH:MM 형식 문자열 (예: "09:00", "10:40")
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS lock_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS lock_start_time TEXT;
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS lock_end_time TEXT;

-- ④ AI 피드백 신고
-- 학생이 피드백을 "이상해요"로 신고하면 reported=true가 됨
-- report_reason은 학생이 입력한 신고 사유 (선택)
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS reported BOOLEAN DEFAULT FALSE;
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS report_reason TEXT;
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS reported_at TIMESTAMPTZ;

-- ⑤ 신고된 피드백을 빠르게 찾기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_submissions_reported
  ON submissions(reported) WHERE reported = TRUE;

-- ============================================
-- 적용 후 확인 쿼리 (선택)
-- ============================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'profiles' AND column_name IN ('number', 'consent_received');
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'topics' AND column_name LIKE 'lock_%';
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'submissions' AND column_name LIKE 'report%';

```

## migrations/step113-comment-read.sql

```sql
-- ============================================
-- step113 마이그레이션: 학생 알림 (코멘트 읽음 추적)
-- ============================================

-- 담임 코멘트를 학생이 확인했는지 추적
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS teacher_comment_read_at TIMESTAMPTZ;

COMMENT ON COLUMN submissions.teacher_comment_read_at IS
  '학생이 담임 코멘트를 확인한 시각. NULL이면 미확인 → 학생 홈에 알림 표시.';

```

## migrations/step119-password-reset-requests.sql

```sql
-- ============================================
-- step119: 비밀번호 초기화 요청
-- ============================================
-- 비번을 잊은 선생님은 로그인을 못 해서 앱 안에서 연락할 방법이 없음.
-- 로그인 화면에서 비로그인 상태로 요청을 남기면 관리자 페이지에 표시됨.
-- ============================================

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  realname TEXT NOT NULL,
  school TEXT,
  contact TEXT,           -- 연락 방법 (선택: 전화, 카톡 등)
  message TEXT,           -- 추가 메모
  status TEXT DEFAULT 'pending',  -- pending / done
  created_at TIMESTAMPTZ DEFAULT now(),
  handled_at TIMESTAMPTZ
);

ALTER TABLE password_reset_requests ENABLE ROW LEVEL SECURITY;

-- 누구나(비로그인 포함) 요청 등록 가능 — 단 조회는 불가
DROP POLICY IF EXISTS "Anyone can insert reset request" ON password_reset_requests;
CREATE POLICY "Anyone can insert reset request" ON password_reset_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- 관리자만 조회·수정 가능
DROP POLICY IF EXISTS "Admin can view reset requests" ON password_reset_requests;
CREATE POLICY "Admin can view reset requests" ON password_reset_requests
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Admin can update reset requests" ON password_reset_requests;
CREATE POLICY "Admin can update reset requests" ON password_reset_requests
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_pwreset_pending
  ON password_reset_requests(created_at DESC)
  WHERE status = 'pending';

```

## migrations/step124-tutor-chat.sql

```sql
-- ============================================
-- step124: AI 글쓰기 도우미 챗봇
-- ============================================
-- 교사가 학급별로 켜고 끄는 학생 글쓰기 도우미.
-- 글을 대신 써주지 않고 생각을 이끄는 질문·힌트만 제공.
-- 학생당 하루 사용 횟수 제한 (Gemini 무료 한도 보호).
-- ============================================

-- 학급별 챗봇 on/off (기본 off — 교사가 명시적으로 켜야 함)
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS tutor_chat_enabled BOOLEAN DEFAULT false;

COMMENT ON COLUMN classes.tutor_chat_enabled IS
  'AI 글쓰기 도우미 챗봇 사용 여부. 교사가 학급 설정에서 켜고 끔. 기본 off.';

-- 학생별 일일 사용 횟수 추적
CREATE TABLE IF NOT EXISTS tutor_chat_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  used_date DATE NOT NULL DEFAULT CURRENT_DATE,
  count INTEGER DEFAULT 0,
  UNIQUE (user_id, used_date)
);

ALTER TABLE tutor_chat_usage ENABLE ROW LEVEL SECURITY;

-- 학생 본인 사용량만 조회·갱신
DROP POLICY IF EXISTS "Students manage own tutor usage" ON tutor_chat_usage;
CREATE POLICY "Students manage own tutor usage" ON tutor_chat_usage
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_tutor_usage_user_date
  ON tutor_chat_usage(user_id, used_date);

```

## migrations/step13-hide-students.sql

```sql
-- ============================================
-- step13: 학생 숨김 처리 (전출생 등)
-- ============================================
-- 실행 위치: Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
-- 안전성: IF NOT EXISTS로 중복 실행해도 OK

-- 학생 숨김 컬럼 (삭제 대신 숨김)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT FALSE;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS hidden_reason TEXT;

-- 숨김 학생 빠르게 필터링하기 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_profiles_visible
  ON profiles(class_id, is_hidden) WHERE role = 'student';

-- ============================================
-- 확인 쿼리
-- ============================================
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'profiles' AND column_name IN ('is_hidden', 'hidden_at', 'hidden_reason');

```

## migrations/step136-school-records.sql

```sql
-- ============================================
-- step136: 생기부 평어 저장 테이블
-- ============================================
-- 생성된 평어를 저장해두고 다시 열 때 토큰 없이 불러오기 위함.
-- 학생당 1행(최신 생성 결과). 다시 생성하면 덮어씀.

create table if not exists school_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references profiles(id) on delete cascade,
  teacher_id uuid not null references profiles(id) on delete cascade,
  sentences jsonb not null default '[]'::jsonb,   -- 생성된 평어 문장 배열
  level text,                                      -- 당시 수준
  standards text,                                  -- 당시 성취기준
  created_at timestamptz not null default now(),
  unique (student_id)                              -- 학생당 1행 (최신본 유지)
);

create index if not exists idx_school_records_teacher on school_records(teacher_id);

-- RLS: 교사는 본인이 만든 평어만 보고/쓰기
alter table school_records enable row level security;

drop policy if exists "teacher manages own records" on school_records;
create policy "teacher manages own records" on school_records
  for all
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid());

```

## migrations/step141-require-rewrite-change.sql

```sql
-- ============================================
-- step141: 맞춤법만 고친 수정본 제출 차단 (주제별 토글)
-- ============================================
-- require_rewrite_change = true 이면, 수정본이 첫 글과 90% 이상
-- 동일할 때 제출을 막는다. 기본값 true (켜짐).

-- 컬럼이 없으면 기본값 true로 추가
alter table topics
  add column if not exists require_rewrite_change boolean not null default true;

-- 이미 컬럼이 있던 경우(이전 버전으로 false 기본값 실행했던 경우) 기본값을 true로 변경
alter table topics
  alter column require_rewrite_change set default true;

```

## migrations/step144-rls-temp-defense.sql

```sql
-- ============================================
-- step144: 임시 RLS 방어 (쓰기/수정/삭제 보호)
-- ============================================
-- 현재 정책 qual=true, with_check=true 라 비로그인도 모든 작업 가능.
--
-- ⚠️ 주의: 회원가입(로그인 전)에 학급코드·닉네임 중복을 비로그인
-- 상태로 SELECT 하므로, SELECT를 전면 차단하면 가입이 깨진다.
-- 따라서 이번 임시 방어는:
--   - INSERT/UPDATE/DELETE → 로그인 필수 (남의 데이터 조작·삭제 차단)
--   - SELECT → 일단 유지 (정밀 학급별 격리는 이후 Claude Code 작업)
--
-- 효과: 비로그인자가 데이터를 "수정·삭제·위조"하는 최악의 공격을 차단.
-- 안전성: 정상 사용자는 모두 로그인 상태라 앱 작동에 영향 없음.
--         가입 시의 비로그인 SELECT는 그대로 허용되어 가입도 정상.

-- 공통 패턴: 기존 전체허용(ALL) 정책 제거 후,
--   SELECT는 전체 허용 유지 / 쓰기 계열은 로그인 필수로 분리

-- ---------- classes ----------
drop policy if exists "classes_all" on classes;
create policy "classes_select" on classes for select using (true);
create policy "classes_write"  on classes for insert with check (auth.uid() is not null);
create policy "classes_update" on classes for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "classes_delete" on classes for delete using (auth.uid() is not null);

-- ---------- profiles ----------
drop policy if exists "profiles_all" on profiles;
create policy "profiles_select" on profiles for select using (true);
create policy "profiles_write"  on profiles for insert with check (auth.uid() is not null);
create policy "profiles_update" on profiles for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "profiles_delete" on profiles for delete using (auth.uid() is not null);

-- ---------- submissions ----------
drop policy if exists "submissions_all" on submissions;
create policy "submissions_select" on submissions for select using (true);
create policy "submissions_write"  on submissions for insert with check (auth.uid() is not null);
create policy "submissions_update" on submissions for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "submissions_delete" on submissions for delete using (auth.uid() is not null);

-- ---------- topics ----------
drop policy if exists "topics_all" on topics;
create policy "topics_select" on topics for select using (true);
create policy "topics_write"  on topics for insert with check (auth.uid() is not null);
create policy "topics_update" on topics for update using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "topics_delete" on topics for delete using (auth.uid() is not null);

```

## migrations/step144-rollback.sql

```sql
-- ============================================
-- step144 롤백: 임시 방어로 가입/작동이 깨졌을 때 원상복구
-- ============================================
-- 적용 후 문제가 생기면 이 SQL로 원래의 전체허용 정책으로 되돌린다.
-- (원래 상태로 복귀 — 보안은 다시 열리지만 앱은 확실히 작동)

-- classes
drop policy if exists "classes_select" on classes;
drop policy if exists "classes_write"  on classes;
drop policy if exists "classes_update" on classes;
drop policy if exists "classes_delete" on classes;
create policy "classes_all" on classes for all using (true) with check (true);

-- profiles
drop policy if exists "profiles_select" on profiles;
drop policy if exists "profiles_write"  on profiles;
drop policy if exists "profiles_update" on profiles;
drop policy if exists "profiles_delete" on profiles;
create policy "profiles_all" on profiles for all using (true) with check (true);

-- submissions
drop policy if exists "submissions_select" on submissions;
drop policy if exists "submissions_write"  on submissions;
drop policy if exists "submissions_update" on submissions;
drop policy if exists "submissions_delete" on submissions;
create policy "submissions_all" on submissions for all using (true) with check (true);

-- topics
drop policy if exists "topics_select" on topics;
drop policy if exists "topics_write"  on topics;
drop policy if exists "topics_update" on topics;
drop policy if exists "topics_delete" on topics;
create policy "topics_all" on topics for all using (true) with check (true);

```

## migrations/step146-rls-helpers.sql

```sql
-- ============================================
-- step146: RLS 헬퍼 함수 (SECURITY DEFINER)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- RLS 정밀 정책(step147~)의 공통 기반.
-- profiles 정책이 profiles 자신을 참조하면 무한 재귀가 발생하므로,
-- RLS를 우회(SECURITY DEFINER)하는 작은 헬퍼 함수로 분리합니다.
--
-- 이 단계는 함수만 만들 뿐 기존 정책을 건드리지 않으므로
-- 앱 동작에 아무 영향이 없습니다 (안전).
-- 롤백: step146-rollback.sql
-- ============================================

-- 현재 로그인 사용자의 역할 (비로그인이면 null)
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;

-- 현재 로그인 사용자의 학급 id (비로그인/무소속이면 null)
create or replace function public.my_class_id() returns uuid
language sql stable security definer set search_path = public as
$$ select class_id from profiles where id = auth.uid() $$;

-- 관리자 여부
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'admin' from profiles where id = auth.uid()), false) $$;

-- 대상 user_id가 나와 같은 학급 소속인가 (학생·교사 무관)
create or replace function public.is_my_classmate(target uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists(
     select 1 from profiles
     where id = target and class_id is not null and class_id = public.my_class_id()
   ) $$;

-- 내 학급의 담임 teacher_id (학생이 담임의 topics를 볼 때 사용)
create or replace function public.my_class_teacher_id() returns uuid
language sql stable security definer set search_path = public as
$$ select teacher_id from classes where id = public.my_class_id() $$;

-- 실행 권한 (정책 평가 시 필요)
grant execute on function
  public.my_role(), public.my_class_id(), public.is_admin(),
  public.is_my_classmate(uuid), public.my_class_teacher_id()
to authenticated, anon;

-- ============================================
-- 적용 확인 쿼리 (Run 후 같은 창에서 실행해보세요):
-- ============================================
-- select public.my_role(), public.my_class_id(), public.is_admin();
--   → SQL Editor는 비로그인 컨텍스트라 (null, null, false)가 정상입니다.
--
-- 함수 5개가 생겼는지:
-- select proname from pg_proc
--   where pronamespace = 'public'::regnamespace
--   and proname in ('my_role','my_class_id','is_admin','is_my_classmate','my_class_teacher_id');

```

## migrations/step146-rollback.sql

```sql
-- ============================================
-- step146 롤백: RLS 헬퍼 함수 제거
-- ============================================
-- step146-rls-helpers.sql 적용을 되돌립니다.
-- ⚠️ 주의: step147 이후 정책이 이 함수들을 참조하면 drop이 실패하거나
-- 정책이 깨집니다. 반드시 step147+ 정책을 먼저 롤백한 뒤 실행하세요.

drop function if exists public.my_role();
drop function if exists public.my_class_id();
drop function if exists public.is_admin();
drop function if exists public.is_my_classmate(uuid);
drop function if exists public.my_class_teacher_id();

```

## migrations/step147-rls-submissions.sql

```sql
-- ============================================
-- step147: submissions 정밀 RLS (1순위 — 가장 민감한 학생 글)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 사전 조건: step146 헬퍼 함수 5개가 먼저 적용되어 있어야 합니다.
-- 적용 전 상태(스냅샷 확인됨): submissions_all (ALL, true/true) = 전면 개방.
--
-- 목표:
--   SELECT: 본인 / 같은 학급 구성원(랭킹용) / admin   ※ 비로그인 0행
--   INSERT: 본인(user_id=auth.uid())만
--   UPDATE: 본인 / 담임(교사 + 글쓴이가 내 학급) / admin
--   DELETE: 담임 / admin (학생은 소프트삭제=UPDATE만)
--
-- 알려진 트레이드오프: 같은 학급 학생끼리는 서로 행 전체를 읽을 수 있음
-- (랭킹 기능 때문. 추후 집계 RPC로 보강 예정 — RLS-POLICY-PLAN.md 6번)
-- 롤백: step147-rollback.sql
-- ============================================

-- RLS 활성화 (이미 켜져 있어도 안전)
alter table submissions enable row level security;

-- 기존 정책 제거 (스냅샷 기준 submissions_all / 방어적으로 step144 명칭도)
drop policy if exists "submissions_all"    on submissions;
drop policy if exists "submissions_select" on submissions;
drop policy if exists "submissions_write"  on submissions;
drop policy if exists "submissions_update" on submissions;
drop policy if exists "submissions_delete" on submissions;

-- SELECT: 본인 + 같은 학급(교사·학생 모두 커버) + admin
create policy "sub_select" on submissions for select to authenticated using (
  user_id = auth.uid()
  or (select public.is_admin())
  or public.is_my_classmate(user_id)
);

-- INSERT: 본인 글만
create policy "sub_insert" on submissions for insert to authenticated with check (
  user_id = auth.uid()
);

-- UPDATE: 본인(수정본·예시 저장) + 담임 + admin
create policy "sub_update" on submissions for update to authenticated
using (
  user_id = auth.uid()
  or (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and public.is_my_classmate(user_id))
)
with check (
  user_id = auth.uid()
  or (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and public.is_my_classmate(user_id))
);

-- DELETE: 담임 + admin (휴지통 영구삭제)
create policy "sub_delete" on submissions for delete to authenticated using (
  (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and public.is_my_classmate(user_id))
);

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'submissions';
--   → sub_select / sub_insert / sub_update / sub_delete 4행이어야 함
-- ============================================

```

## migrations/step147-rollback.sql

```sql
-- ============================================
-- step147 롤백: submissions 정책을 적용 전 상태로 복원
-- ============================================
-- 적용 전 스냅샷(pg_policies) 기준: submissions_all (ALL, true/true) 하나만 존재.
-- step147이 만든 정밀 정책 4개를 제거하고 전체 허용으로 되돌립니다.
-- ⚠️ 보안 구멍이 다시 열리는 것이므로 문제 해결 후 반드시 재적용하세요.

drop policy if exists "sub_select" on submissions;
drop policy if exists "sub_insert" on submissions;
drop policy if exists "sub_update" on submissions;
drop policy if exists "sub_delete" on submissions;

create policy "submissions_all" on submissions
  for all using (true) with check (true);

```

## migrations/step148-rls-profiles.sql

```sql
-- ============================================
-- step148: profiles 정밀 RLS (2순위 — 개인정보)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 사전 조건: step146 헬퍼 함수. 적용 전 상태: profiles_all (전면 개방).
--
-- 목표:
--   SELECT: 본인 / 같은 학급 구성원 / admin   ※ 비로그인 0행
--   INSERT: 본인 행(id=auth.uid())만 (가입 직후 자기 프로필 생성)
--   UPDATE: 본인 / 담임(대상이 내 학급 student) / admin
--   DELETE: admin만 (교사는 숨김 처리, 영구삭제는 admin·cron)
--
-- ⚠️ 동반 코드 수정 필요 (같은 커밋에 포함):
--   1. student/login.js — 닉네임 중복확인을 profile INSERT 후로 이동
--      (INSERT 전엔 my_class_id()가 null이라 동급생 조회가 빈 결과)
--   2. api/verify-code.js — admin 중복가입 확인을 서버로 이동
--      (비로그인 클라이언트의 profiles SELECT가 차단되므로)
--
-- 롤백: step148-rollback.sql
-- ============================================

alter table profiles enable row level security;

-- 기존 정책 제거 (스냅샷 기준 profiles_all / 방어적으로 step144 명칭도)
drop policy if exists "profiles_all"    on profiles;
drop policy if exists "profiles_select" on profiles;
drop policy if exists "profiles_write"  on profiles;
drop policy if exists "profiles_update" on profiles;
drop policy if exists "profiles_delete" on profiles;

-- SELECT: 본인 + 같은 학급 + admin
create policy "prof_select" on profiles for select to authenticated using (
  id = auth.uid()
  or (select public.is_admin())
  or (class_id is not null and class_id = (select public.my_class_id()))
);

-- INSERT: 본인 행만 (가입 직후)
create policy "prof_insert" on profiles for insert to authenticated with check (
  id = auth.uid()
);

-- UPDATE: 본인 + 담임(내 학급 학생만) + admin
create policy "prof_update" on profiles for update to authenticated
using (
  id = auth.uid()
  or (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and role = 'student'
      and class_id is not null and class_id = (select public.my_class_id()))
)
with check (
  id = auth.uid()
  or (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and role = 'student'
      and class_id is not null and class_id = (select public.my_class_id()))
);

-- DELETE: admin만
create policy "prof_delete" on profiles for delete to authenticated using (
  (select public.is_admin())
);

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'profiles';
--   → prof_select / prof_insert / prof_update / prof_delete 4행이어야 함
-- ============================================

```

## migrations/step148-rollback.sql

```sql
-- ============================================
-- step148 롤백: profiles 정책을 적용 전 상태로 복원
-- ============================================
-- 적용 전 스냅샷(pg_policies) 기준: profiles_all (ALL, true/true) 하나만 존재.
-- ⚠️ 보안 구멍이 다시 열리는 것이므로 문제 해결 후 반드시 재적용하세요.
-- 참고: 동반 코드 수정(닉네임 부여 순서, verify-code admin 확인)은
--       구 정책에서도 정상 동작하므로 코드는 되돌릴 필요 없음.

drop policy if exists "prof_select" on profiles;
drop policy if exists "prof_insert" on profiles;
drop policy if exists "prof_update" on profiles;
drop policy if exists "prof_delete" on profiles;

create policy "profiles_all" on profiles
  for all using (true) with check (true);

```

## migrations/step149-rls-classes.sql

```sql
-- ============================================
-- step149: classes 정밀 RLS (3순위 — api_key 보호가 핵심)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 사전 조건: step146 헬퍼 함수 + ⚠️ 동반 코드가 먼저 배포되어 있어야 함!
--   (Vercel에 /api/class-lookup 라우트가 떠 있어야 학생 가입이 안 깨짐)
--
-- 목표:
--   SELECT: 소유 교사 / 내 학급 구성원 / admin   ※ 익명 0행 (api_key 보호!)
--   INSERT: teacher_id=auth.uid() (교사 가입 시 학급 생성)
--   UPDATE: 소유 교사 / admin
--   DELETE: admin만
--
-- 익명 학급코드 조회(학생 가입·QR 힌트)와 코드 중복확인은
-- /api/class-lookup (service_role, 안전 컬럼만 반환)으로 대체됨.
--
-- 효과: api_key는 본인 학급 구성원+담임+admin만 읽기 가능.
--   (같은 학급 학생에게 보이는 건 현 구조의 한계 — RLS-POLICY-PLAN.md 6번 참고)
-- 롤백: step149-rollback.sql
-- ============================================

alter table classes enable row level security;

-- 기존 정책 제거 (스냅샷 기준 classes_all / 방어적으로 step144 명칭도)
drop policy if exists "classes_all"    on classes;
drop policy if exists "classes_select" on classes;
drop policy if exists "classes_write"  on classes;
drop policy if exists "classes_update" on classes;
drop policy if exists "classes_delete" on classes;

-- SELECT: 소유 교사 + 내 학급 + admin (익명 정책 없음 = 익명 0행)
create policy "cls_select" on classes for select to authenticated using (
  teacher_id = auth.uid()
  or id = (select public.my_class_id())
  or (select public.is_admin())
);

-- INSERT: 본인이 소유자인 학급만 (교사/관리자 가입 직후)
create policy "cls_insert" on classes for insert to authenticated with check (
  teacher_id = auth.uid()
);

-- UPDATE: 소유 교사 + admin
create policy "cls_update" on classes for update to authenticated
using (teacher_id = auth.uid() or (select public.is_admin()))
with check (teacher_id = auth.uid() or (select public.is_admin()));

-- DELETE: admin만
create policy "cls_delete" on classes for delete to authenticated using (
  (select public.is_admin())
);

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'classes';
--   → cls_select / cls_insert / cls_update / cls_delete 4행이어야 함
-- ============================================

```

## migrations/step149-rollback.sql

```sql
-- ============================================
-- step149 롤백: classes 정책을 적용 전 상태로 복원
-- ============================================
-- 적용 전 스냅샷(pg_policies) 기준: classes_all (ALL, true/true) 하나만 존재.
-- ⚠️ api_key가 익명에게 다시 노출되는 큰 구멍이므로 문제 해결 후 반드시 재적용.
-- 참고: 동반 코드(/api/class-lookup 경유)는 구 정책에서도 정상 동작하므로
--       코드는 되돌릴 필요 없음.

drop policy if exists "cls_select" on classes;
drop policy if exists "cls_insert" on classes;
drop policy if exists "cls_update" on classes;
drop policy if exists "cls_delete" on classes;

create policy "classes_all" on classes
  for all using (true) with check (true);

```

## migrations/step150-rls-topics.sql

```sql
-- ============================================
-- step150: topics 정밀 RLS (4순위)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 사전 조건: step146 헬퍼 함수. 동반 코드 수정 없음 (SQL만 적용하면 됨).
--
-- 목표:
--   SELECT: 소유 교사 / 내 학급 담임의 주제(학생) / admin   ※ 익명 0행
--   INSERT/UPDATE/DELETE: 소유 교사 / admin
--
-- 알려진 경미한 표시 저하 (의도된 수용):
--   공유 주제 추천 카드에서 타 교사 topic으로의 resulting_topic 조인이
--   null이 되어 "사용된 날짜" 배지만 안 보임. 카드 제목·내용은 로그
--   자체의 suggestions JSON에서 렌더링되므로 정상 표시됨.
-- 롤백: step150-rollback.sql
-- ============================================

alter table topics enable row level security;

-- 기존 정책 제거 (스냅샷 기준 topics_all / 방어적으로 step144 명칭도)
drop policy if exists "topics_all"    on topics;
drop policy if exists "topics_select" on topics;
drop policy if exists "topics_write"  on topics;
drop policy if exists "topics_update" on topics;
drop policy if exists "topics_delete" on topics;

-- SELECT: 소유 교사 + 내 학급 담임의 주제(학생용) + admin
create policy "top_select" on topics for select to authenticated using (
  teacher_id = auth.uid()
  or teacher_id = (select public.my_class_teacher_id())
  or (select public.is_admin())
);

-- INSERT: 본인 소유 주제만 (admin은 학급 정리 등 관리 작업용)
create policy "top_insert" on topics for insert to authenticated with check (
  teacher_id = auth.uid()
  or (select public.is_admin())
);

-- UPDATE: 소유 교사 + admin
create policy "top_update" on topics for update to authenticated
using (teacher_id = auth.uid() or (select public.is_admin()))
with check (teacher_id = auth.uid() or (select public.is_admin()));

-- DELETE: 소유 교사 + admin (admin은 학급 영구삭제 시 일괄 정리)
create policy "top_delete" on topics for delete to authenticated using (
  teacher_id = auth.uid()
  or (select public.is_admin())
);

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'topics';
--   → top_select / top_insert / top_update / top_delete 4행이어야 함
-- ============================================

```

## migrations/step150-rollback.sql

```sql
-- ============================================
-- step150 롤백: topics 정책을 적용 전 상태로 복원
-- ============================================
-- 적용 전 스냅샷(pg_policies) 기준: topics_all (ALL, true/true) 하나만 존재.
-- ⚠️ 문제 해결 후 반드시 재적용하세요.

drop policy if exists "top_select" on topics;
drop policy if exists "top_insert" on topics;
drop policy if exists "top_update" on topics;
drop policy if exists "top_delete" on topics;

create policy "topics_all" on topics
  for all using (true) with check (true);

```

## migrations/step151-rls-feedback.sql

```sql
-- ============================================
-- step151: feedback 정밀 RLS + user_id 컬럼 (step87 미적용분 포함)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 사전 조건: step146 헬퍼 함수. 동반 코드 수정 없음.
--
-- 🐛 버그 수정 포함: FeedbackModal이 로그인 시 user_id를 INSERT에 포함하는데
--    실제 DB에 user_id 컬럼이 없어(step87 마이그레이션 미적용 확인됨)
--    로그인 사용자의 "의견 보내기"가 실패하고 있었음. 컬럼 추가로 해결.
--
-- 목표 (feedback):
--   INSERT: 로그인 사용자 전원 (user_id는 본인 또는 null)
--   SELECT/UPDATE/DELETE: admin만
--
-- 나머지 테이블은 검토 결과 변경 불필요 (스냅샷 기준):
--   password_reset_requests: 익명 INSERT + admin SELECT/UPDATE 이미 적절
--   topic_suggestion_logs: step92.1+108 정책 적절 (DELETE 코드 없음 확인)
--   school_records / tutor_chat_usage: 기존 정책 적절
-- 롤백: step151-rollback.sql
-- ============================================

-- 1) user_id 컬럼 추가 (step87 내용 — 실제 DB에 미적용이었음)
alter table feedback
  add column if not exists user_id uuid references profiles(id) on delete set null;
create index if not exists idx_feedback_user_id on feedback(user_id);
comment on column feedback.user_id is '의견 작성자 (NULL이면 익명/구버전 의견)';

-- 2) RLS 정책
alter table feedback enable row level security;

drop policy if exists "feedback_all" on feedback;

-- INSERT: 로그인 사용자만, user_id는 본인 것(또는 미첨부)만
create policy "fb_insert" on feedback for insert to authenticated with check (
  user_id is null or user_id = auth.uid()
);

-- SELECT: admin만 (의견함)
create policy "fb_select" on feedback for select to authenticated using (
  (select public.is_admin())
);

-- UPDATE: admin만 (숨김/복원 처리)
create policy "fb_update" on feedback for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

-- DELETE: admin만 (현재 코드엔 없지만 관리용)
create policy "fb_delete" on feedback for delete to authenticated using (
  (select public.is_admin())
);

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'feedback';
--   → fb_insert / fb_select / fb_update / fb_delete 4행이어야 함
-- select column_name from information_schema.columns
--   where table_name = 'feedback' and column_name = 'user_id';
--   → 1행이어야 함
-- ============================================

```

## migrations/step151-rollback.sql

```sql
-- ============================================
-- step151 롤백: feedback 정책을 적용 전 상태로 복원
-- ============================================
-- 적용 전 스냅샷(pg_policies) 기준: feedback_all (ALL, true/true) 하나만 존재.
-- 참고: user_id 컬럼 추가는 되돌리지 않음 (additive + 의견보내기 버그 수정이라 유지).
--       password_reset_requests / topic_suggestion_logs / school_records /
--       tutor_chat_usage 는 step151에서 변경하지 않았으므로 롤백 대상 아님.

drop policy if exists "fb_insert" on feedback;
drop policy if exists "fb_select" on feedback;
drop policy if exists "fb_update" on feedback;
drop policy if exists "fb_delete" on feedback;

create policy "feedback_all" on feedback
  for all using (true) with check (true);

```

## migrations/step153-class-secrets.sql

```sql
-- ============================================
-- step153: 학급 API 키 서버 격리 (class_secrets 분리)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 실행 순서: 이 SQL을 먼저 실행 → 그다음 코드(step153) 배포.
--   (테이블·데이터가 있는 상태에서 새 서버 코드가 올라와야 안전.
--    코드가 먼저 올라가도 서버는 classes.api_key 폴백이 있어 안 끊김.)
--
-- 사전 조건: step146 헬퍼 함수(is_admin 등)가 이미 적용돼 있어야 함.
--
-- 배경: Gemini API 키가 classes.api_key에 있고 step149 RLS상 같은 학급 학생도
--   SELECT 가능 + ApiKeyManager가 localStorage에도 저장 → 학생 브라우저에 키 노출.
--   이를 막기 위해 키를 교사·admin만 접근 가능한 class_secrets로 분리한다.
--
-- 목표:
--   class_secrets: 학급당 1행. 소유 교사(classes.teacher_id=auth.uid())와 admin만 접근.
--   학생은 어떤 작업도 불가. AI 호출은 /api/ai가 service_role로 키를 조회해 사용.
--
-- 2단계 배포: 이번 step153은 class_secrets 생성·이관까지만.
--   classes.api_key는 "폴백용 동결 데이터"로 남겨둔다 (NULL로 비우지 않음).
--   classes.api_key 비우기 + 서버 폴백 제거는 안정화 후 step154에서 수행.
-- 롤백: step153-rollback.sql
-- ============================================

-- 1) 테이블 생성 (멱등)
create table if not exists class_secrets (
  class_id uuid primary key references classes(id) on delete cascade,
  api_key text,
  updated_at timestamptz default now()
);

-- 2) RLS 활성화
alter table class_secrets enable row level security;

-- 3) 정책: 소유 교사 + admin만 전 작업. 학생은 0행/거부.
drop policy if exists "csec_select" on class_secrets;
drop policy if exists "csec_insert" on class_secrets;
drop policy if exists "csec_update" on class_secrets;
drop policy if exists "csec_delete" on class_secrets;

-- SELECT: admin 전체 / 소유 교사 본인 학급
create policy "csec_select" on class_secrets for select to authenticated using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = class_secrets.class_id and c.teacher_id = auth.uid()
  )
);

-- INSERT: 본인이 소유한 학급의 행만 (admin은 무제한)
create policy "csec_insert" on class_secrets for insert to authenticated with check (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = class_secrets.class_id and c.teacher_id = auth.uid()
  )
);

-- UPDATE: 소유 교사 + admin
create policy "csec_update" on class_secrets for update to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = class_secrets.class_id and c.teacher_id = auth.uid()
  )
)
with check (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = class_secrets.class_id and c.teacher_id = auth.uid()
  )
);

-- DELETE: 소유 교사 + admin
create policy "csec_delete" on class_secrets for delete to authenticated using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = class_secrets.class_id and c.teacher_id = auth.uid()
  )
);

-- 4) 데이터 이관: 기존 classes.api_key → class_secrets (중복 실행 안전)
insert into class_secrets (class_id, api_key)
select id, api_key from classes
where api_key is not null
on conflict (class_id) do update set api_key = excluded.api_key, updated_at = now();

-- ⚠️ classes.api_key는 이번 step에서 비우지 않는다 (폴백용으로 동결 유지).
--    step154에서 update classes set api_key = null 수행 예정.

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'class_secrets';
--   → csec_select / csec_insert / csec_update / csec_delete 4행이어야 함
-- select count(*) from class_secrets;        -- 키 등록된 학급 수와 일치해야 함
-- select count(*) from classes where api_key is not null;  -- 위와 같아야 함
-- ============================================

```

## migrations/step153-rollback.sql

```sql
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

```

## migrations/step155-error-logs.sql

```sql
-- ============================================
-- step155: 에러 로깅 시스템
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 목적: 학생/교사 화면·서버에서 발생한 에러를 운영자(admin)가 볼 수 있게 수집.
-- 사전 조건: step146 헬퍼 함수(is_admin)가 이미 적용돼 있어야 함.
--
-- 보존: cron-trash-cleanup이 30일 지난 행을 자동 삭제 (테이블 무한 증가 방지).
-- 롤백: step155-rollback.sql
-- ============================================

create table if not exists error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  role text default 'unknown',           -- student / teacher / admin / unknown
  user_id uuid,                            -- nullable (비로그인/미해결)
  class_id uuid,                           -- nullable
  page text,                               -- 경로 또는 기능명 (예: 'student/index', 'api/ai')
  error_type text,                         -- ai_call / js_error / api_error 등
  message text,                            -- 에러 메시지 (클라이언트에서 500자로 자름)
  context jsonb,                           -- 선택 부가정보 (개인정보 금지)
  user_agent text
);

create index if not exists idx_error_logs_created on error_logs(created_at desc);

alter table error_logs enable row level security;

-- INSERT: 로그인 사용자 전원 허용 (비로그인 스팸 차단 위해 anon 제외)
drop policy if exists "elog_insert" on error_logs;
create policy "elog_insert" on error_logs for insert to authenticated with check (true);

-- SELECT: admin만
drop policy if exists "elog_select" on error_logs;
create policy "elog_select" on error_logs for select to authenticated using (
  (select public.is_admin())
);

-- DELETE: admin만 (cron은 service_role이라 RLS 우회)
drop policy if exists "elog_delete" on error_logs;
create policy "elog_delete" on error_logs for delete to authenticated using (
  (select public.is_admin())
);

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'error_logs';
--   → elog_insert / elog_select / elog_delete 3행
-- ============================================

```

## migrations/step155-rollback.sql

```sql
-- ============================================
-- step155 롤백: error_logs 제거
-- ============================================
-- ⚠️ 코드도 함께 되돌려야 함 (logError 호출이 조용히 실패하긴 하나, admin 에러 탭은 깨짐).

drop policy if exists "elog_insert" on error_logs;
drop policy if exists "elog_select" on error_logs;
drop policy if exists "elog_delete" on error_logs;

drop table if exists error_logs;

```

## migrations/step156-reset-rate-limit.sql

```sql
-- ============================================
-- step156: 비밀번호 초기화 요청 스팸 방어
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 목적: password_reset_requests의 익명 직접 INSERT를 막고, 서버 API(/api/password-reset-request)가
--   service_role로만 INSERT하도록 전환. ip_hash 기반 rate limit은 서버에서 수행.
--
-- ⚠️ 코드(서버 라우트 + teacher/login.js)가 함께 배포되어야 비번 초기화 요청이 동작.
--   (SQL 먼저 실행 → 코드 배포. 정책 제거 후에는 익명 직접 INSERT가 막히므로 새 라우트 필수.)
-- 롤백: step156-rollback.sql
-- ============================================

-- 1) ip_hash 컬럼 추가 (서버가 채움, 멱등)
alter table password_reset_requests add column if not exists ip_hash text;

-- 2) rate limit 조회용 인덱스
create index if not exists idx_pwreset_created on password_reset_requests(created_at desc);
create index if not exists idx_pwreset_iphash on password_reset_requests(ip_hash, created_at desc);

-- 3) 익명 INSERT 정책 제거 (이제 service_role로만 INSERT)
--    step119에서 만든 정책 이름. anon/authenticated 직접 INSERT 차단.
drop policy if exists "Anyone can insert reset request" on password_reset_requests;

-- admin SELECT/UPDATE 정책(step119)은 그대로 둔다. service_role은 RLS를 우회해 INSERT.

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'password_reset_requests';
--   → "Admin can view ..."(SELECT), "Admin can update ..."(UPDATE)만 남고 INSERT 정책은 없어야 함
-- select column_name from information_schema.columns
--   where table_name = 'password_reset_requests' and column_name = 'ip_hash';  -- 1행
-- ============================================

```

## migrations/step156-rollback.sql

```sql
-- ============================================
-- step156 롤백: 비번 초기화 익명 INSERT 복원
-- ============================================
-- ⚠️ 코드도 함께 되돌려야 함 (teacher/login.js가 다시 직접 INSERT 하도록).
--    새 서버 라우트(/api/password-reset-request)는 service_role을 쓰므로 정책과 무관하나,
--    구버전 클라이언트 직접 INSERT를 다시 허용하려면 아래 정책을 복원한다.

-- step119의 익명 INSERT 정책 복원
drop policy if exists "Anyone can insert reset request" on password_reset_requests;
create policy "Anyone can insert reset request" on password_reset_requests
  for insert to anon, authenticated
  with check (true);

-- 인덱스/컬럼은 남겨둬도 무해하므로 삭제하지 않음 (필요 시 아래 주석 해제)
-- drop index if exists idx_pwreset_iphash;
-- drop index if exists idx_pwreset_created;
-- alter table password_reset_requests drop column if exists ip_hash;

```

## migrations/step161-request-type.sql

```sql
-- ============================================
-- step161: 아이디 찾기 요청 + 비번 초기화 후 변경 유도
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 실행 순서: 이 SQL을 먼저 실행 → 그다음 코드(step161) 배포.
--   (request_type/must_change_password 컬럼이 있어야 새 코드가 정상 동작.
--    컬럼이 없어도 기존 흐름은 깨지지 않지만, 새 기능은 컬럼 필요.)
--
-- RLS 변경 없음. 멱등(IF NOT EXISTS).
-- 롤백: step161-rollback.sql
-- ============================================

-- 1) 요청 종류 구분 (reset_password / find_id). 기존 행은 reset_password로 간주.
alter table password_reset_requests
  add column if not exists request_type text default 'reset_password';

-- 2) 비번 초기화 후 강제 변경 유도 플래그
alter table profiles
  add column if not exists must_change_password boolean default false;

-- ============================================
-- 적용 확인:
-- select column_name from information_schema.columns
--   where table_name = 'password_reset_requests' and column_name = 'request_type';   -- 1행
-- select column_name from information_schema.columns
--   where table_name = 'profiles' and column_name = 'must_change_password';           -- 1행
-- ============================================

```

## migrations/step161-rollback.sql

```sql
-- ============================================
-- step161 롤백: request_type / must_change_password 컬럼 제거
-- ============================================
-- ⚠️ 코드도 함께 되돌려야 함 (새 코드가 이 컬럼들을 참조).

alter table password_reset_requests drop column if exists request_type;
alter table profiles drop column if exists must_change_password;

```

## migrations/step162-reset-request-delete-policy.sql

```sql
-- ============================================
-- step162: password_reset_requests 삭제(DELETE) 정책 — admin만
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 배경: step119는 password_reset_requests에 INSERT/SELECT/UPDATE 정책만 만들었다.
--   DELETE 정책이 없어 RLS가 켜진 상태에서는 admin도 행을 삭제할 수 없다.
--   요청함 "삭제" 기능을 위해 admin DELETE 정책을 추가한다.
--
-- ⚠️ 실행 순서: 이 SQL을 먼저 실행 → 그다음 코드(step162) 배포.
--   (정책이 없으면 삭제 버튼이 "삭제 실패"로 떨어진다. 다른 기능은 영향 없음.)
-- RLS: 추가만 함(SELECT/UPDATE 기존 정책 유지). 멱등.
-- 롤백: step162-rollback.sql
-- ============================================

alter table password_reset_requests enable row level security;

drop policy if exists "Admin can delete reset requests" on password_reset_requests;
create policy "Admin can delete reset requests" on password_reset_requests
  for delete to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'password_reset_requests';
--   → SELECT / UPDATE / DELETE(admin) 정책이 보여야 함 (INSERT는 step156에서 제거됨)
-- ============================================

```

## migrations/step162-rollback.sql

```sql
-- ============================================
-- step162 롤백: admin 삭제(DELETE) 정책 제거
-- ============================================
-- ⚠️ 코드도 함께 되돌려야 함 (요청함 삭제 버튼이 이 정책을 사용).

drop policy if exists "Admin can delete reset requests" on password_reset_requests;

```

## migrations/step163-rollback.sql

```sql
-- ============================================
-- step163 롤백 — 표준학교코드 컬럼 제거
-- ============================================
-- 주의: 이미 채워진 school_code/school_region 데이터가 영구 삭제된다.
-- 되돌릴 일이 없으면 실행하지 말 것. (school 공식명 텍스트는 그대로 남는다)
-- ============================================

DROP INDEX IF EXISTS idx_profiles_school_code;

ALTER TABLE profiles DROP COLUMN IF EXISTS school_code;
ALTER TABLE profiles DROP COLUMN IF EXISTS school_region;
ALTER TABLE classes  DROP COLUMN IF EXISTS school_code;

```

## migrations/step163-school-code.sql

```sql
-- ============================================
-- step163: 학교명 표준화 — 표준학교코드 컬럼 추가
-- ============================================
-- 교사가 학교를 "하랑초/하랑초등학교/경기 하랑초등학교" 등 제각각 입력해
-- 본인확인(아이디 찾기 step162)이 표기 불일치로 깨진다.
-- NEIS 학교기본정보 OpenAPI의 표준학교코드(SD_SCHUL_CODE)를 저장해
-- 표기 흔들림과 무관하게 학교를 고유 식별한다.
--
-- 전부 nullable TEXT + IF NOT EXISTS → 멱등. 코드 변화 0, 기존 데이터 무영향.
-- 기존 school(공식명 텍스트) 컬럼은 표시용으로 그대로 유지한다.
-- ============================================

-- 교사/학생 프로필: 표준학교코드 + 시도교육청명
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_code   TEXT;  -- SD_SCHUL_CODE (표준학교코드)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS school_region TEXT;  -- ATPT_OFCDC_SC_NM (시도교육청명)

-- 학급: 학교별 그룹화 정합성 + 신규 학생 상속용
ALTER TABLE classes  ADD COLUMN IF NOT EXISTS school_code   TEXT;  -- SD_SCHUL_CODE

-- 코드 기준 본인확인 조회 가속 (부분 인덱스: 코드가 채워진 행만)
CREATE INDEX IF NOT EXISTS idx_profiles_school_code
  ON profiles(school_code)
  WHERE school_code IS NOT NULL;

```

## migrations/step165-api-rate-limit.sql

```sql
-- ============================================
-- step165: API 호출 제한용 경량 테이블
-- ============================================
-- find-teacher-id(아이디 찾기) 같은 비로그인 라우트의 무차별 대입을 막기 위한
-- IP 해시 기반 호출 카운터. 서버리스(Vercel)는 인스턴스 메모리가 공유되지 않아
-- 신뢰할 수 있는 rate limit은 공유 상태(DB)가 필요하다.
--
-- bucket으로 용도를 구분해 여러 라우트가 한 테이블을 재사용한다 (예: 'find_teacher_id').
-- 행은 호출 1건당 1개 쌓이며, 윈도우(예: 10분/24h) 내 건수만 센다.
-- service_role(서버)만 접근한다(RLS enable + 정책 없음).
-- ============================================

CREATE TABLE IF NOT EXISTS api_rate_limit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket TEXT NOT NULL,        -- 용도 구분 (예: 'find_teacher_id')
  ip_hash TEXT NOT NULL,       -- sha256(고정 prefix + IP)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limit_lookup
  ON api_rate_limit(bucket, ip_hash, created_at DESC);

ALTER TABLE api_rate_limit ENABLE ROW LEVEL SECURITY;
-- 정책을 두지 않음 → anon/authenticated는 접근 불가, service_role만 사용(서버 전용).

-- 참고: 행은 천천히 쌓인다(호출량이 적은 라우트 전용). 필요 시 아래로 정리 가능:
--   DELETE FROM api_rate_limit WHERE created_at < now() - interval '2 days';
-- (윈도우가 24h라 2일보다 오래된 행은 카운트에 영향 없음)

```

## migrations/step165-rollback.sql

```sql
-- ============================================
-- step165 롤백 — API 호출 제한 테이블 제거
-- ============================================
DROP INDEX IF EXISTS idx_api_rate_limit_lookup;
DROP TABLE IF EXISTS api_rate_limit;

```

## migrations/step167-rollback.sql

```sql
-- ============================================
-- step167 롤백 — 초등학교 캐시 테이블 제거
-- ============================================
DROP INDEX IF EXISTS idx_schools_name;
DROP TABLE IF EXISTS schools;

```

## migrations/step167-schools.sql

```sql
-- ============================================
-- step167: 전국 초등학교 캐시 테이블
-- ============================================
-- 학교 자동완성이 매번 NEIS API를 호출해 ~3초 지연되던 것을, 전국 초등학교
-- (실측 6,341개)를 우리 DB에 1회 적재해두고 검색은 DB에서만 하도록 전환한다.
-- NEIS는 적재/갱신 때(scripts/load-schools.mjs)만 호출 → 검색 즉시 응답 +
-- NEIS 장애와 무관.
--
-- code(SD_SCHUL_CODE)가 PK라 재적재 upsert가 멱등하다.
-- 학교 목록은 공공데이터 → 공개 SELECT, 쓰기는 service_role(적재 스크립트)만.
-- ============================================

CREATE TABLE IF NOT EXISTS schools (
  code       TEXT PRIMARY KEY,        -- SD_SCHUL_CODE (표준학교코드, 고유)
  name       TEXT NOT NULL,           -- SCHUL_NM
  region     TEXT,                    -- ATPT_OFCDC_SC_NM (교육청명, step163과 동일 기준)
  address    TEXT,                    -- ORG_RDNMA (도로명주소)
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 부분검색(name LIKE '%키워드%')은 6천여 행에서 seq scan으로도 1ms 미만이라
-- 인덱스가 필수는 아니지만, 접두검색·정렬용으로 가볍게 둔다.
CREATE INDEX IF NOT EXISTS idx_schools_name ON schools(name);

ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

-- 공개 읽기 (학교 목록은 공공정보)
DROP POLICY IF EXISTS "schools public read" ON schools;
CREATE POLICY "schools public read" ON schools
  FOR SELECT TO anon, authenticated
  USING (true);

-- 쓰기 정책은 두지 않음 → service_role(적재 스크립트)만 INSERT/UPDATE 가능.

```

## migrations/step187-pending-names.sql

```sql
-- ============================================
-- step187: 학생 실명 잠금 저장 (pending_names 분리)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 실행 순서: 이 SQL을 먼저 실행 → 그다음 이를 사용하는 코드(암호화 저장)를 배포.
--   (테이블·RLS가 있는 상태에서 새 서버 코드가 올라와야 안전)
--
-- 사전 조건: step146 헬퍼 함수(is_admin / my_class_id 등)가 이미 적용돼 있어야 함.
--   (RLS 정책이 public.is_admin() 을 참조)
--
-- 배경: 부모 동의 전 신규 학생의 실명을 profiles.realname 평문으로 두지 않고,
--   AES-256-GCM으로 암호화해 교사·admin만 접근 가능한 별도 테이블에 보관한다.
--   복호화 키(NAME_ENCRYPTION_KEY)는 서버 환경변수에만 존재(클라이언트 노출 금지).
--   동의 완료 시 서버가 복호화해 profiles.realname을 채우는 흐름을 염두에 둔다.
--
-- 목표:
--   pending_names: 학생당 1행. 소유 교사(classes.teacher_id=auth.uid())와 admin만 접근.
--   학생·비로그인(anon)은 어떤 작업도 불가.
--   서버는 service_role 로 RLS를 우회해 insert/조회한다(students-bulk 등).
--
-- 롤백: step187-rollback.sql
-- ============================================

-- 1) 테이블 생성 (멱등)
create table if not exists pending_names (
  student_id uuid primary key references profiles(id) on delete cascade,  -- unique 보장(PK)
  class_id   uuid references classes(id) on delete cascade,
  enc_name   text,                          -- AES-256-GCM 암호문: iv+authTag+ciphertext를 한 문자열로 보관
  created_at timestamptz default now()
);

-- 1.1) 컬럼 보강 (테이블이 이미 일부만 존재할 때 대비 — 멱등)
alter table pending_names add column if not exists class_id   uuid;
alter table pending_names add column if not exists enc_name   text;
alter table pending_names add column if not exists created_at timestamptz default now();

-- 2) RLS 활성화
alter table pending_names enable row level security;

-- 3) 정책: 소유 교사 + admin만 전 작업. 학생·anon은 0행/거부.
--    (step153 class_secrets 정책 구조 그대로 — classes.teacher_id 조인으로 소유 교사 판정)
drop policy if exists "pn_select" on pending_names;
drop policy if exists "pn_insert" on pending_names;
drop policy if exists "pn_update" on pending_names;
drop policy if exists "pn_delete" on pending_names;

-- SELECT: admin 전체 / 소유 교사 본인 학급
create policy "pn_select" on pending_names for select to authenticated using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = pending_names.class_id and c.teacher_id = auth.uid()
  )
);

-- INSERT: 본인이 소유한 학급의 행만 (admin은 무제한)
create policy "pn_insert" on pending_names for insert to authenticated with check (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = pending_names.class_id and c.teacher_id = auth.uid()
  )
);

-- UPDATE: 소유 교사 + admin
create policy "pn_update" on pending_names for update to authenticated
using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = pending_names.class_id and c.teacher_id = auth.uid()
  )
)
with check (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = pending_names.class_id and c.teacher_id = auth.uid()
  )
);

-- DELETE: 소유 교사 + admin
create policy "pn_delete" on pending_names for delete to authenticated using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = pending_names.class_id and c.teacher_id = auth.uid()
  )
);

-- (참고) 소유권 판정은 class_secrets(step153)와 동일하게 classes.teacher_id 조인을 쓴다.
--   step146 my_class_id() 로 `pending_names.class_id = (select public.my_class_id())`
--   조건을 써도 교사에 대해선 동등하나, teacher_id 조인이 소유권상 더 명시적이라 step153 패턴을 따랐다.

-- ============================================
-- 적용 확인:
-- select policyname, cmd from pg_policies where tablename = 'pending_names';
--   → pn_select / pn_insert / pn_update / pn_delete 4행이어야 함
-- select relrowsecurity from pg_class where relname = 'pending_names';   -- t (RLS on)
-- ============================================

```

## migrations/step187-rollback.sql

```sql
-- ============================================
-- step187 롤백: pending_names 제거
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 주의: 이 테이블에 보관된 암호화 실명(enc_name)이 모두 삭제됩니다(복구 불가).
--   롤백 전 필요한 데이터를 반드시 백업하세요.
-- ============================================

-- 정책 제거 (테이블 drop 전에 명시적으로 — 멱등)
drop policy if exists "pn_select" on pending_names;
drop policy if exists "pn_insert" on pending_names;
drop policy if exists "pn_update" on pending_names;
drop policy if exists "pn_delete" on pending_names;

-- 테이블 제거 (cascade로 의존 객체 함께 정리)
drop table if exists pending_names cascade;

-- ============================================
-- 적용 확인:
-- select to_regclass('public.pending_names');   -- NULL 이어야 함(삭제됨)
-- ============================================

```

## migrations/step193-consents.sql

```sql
-- ============================================
-- step193: 부모 동의 + 학급 동의비밀번호 (consents / classes.consent_password)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 실행 순서: 이 SQL을 먼저 실행 → 그다음 이를 사용하는 코드(부모 동의 페이지·API)를 배포.
--
-- 사전 조건:
--   - step146 헬퍼 함수(is_admin)가 이미 적용돼 있어야 함 (RLS 정책이 public.is_admin() 참조).
--   - step187(pending_names)이 적용돼 있어야 함 — 부모 동의 완료 시 서버(service_role)가
--     pending_names.enc_name 을 복호화해 profiles.realname 을 채우고, 이 consents 에 동의기록을 남긴다.
--
-- 배경: C방식(학급링크 + 자녀번호 + 학급 동의비밀번호 + 부모 서명)으로 부모 동의를 받는다.
--   비로그인 부모는 세션이 없으므로 /api/parent-consent (service_role) 경유로만 INSERT 한다.
--   따라서 consents 에는 INSERT 정책을 두지 않고(기본 deny), service_role 이 RLS 를 우회해 기록한다.
--   classes.consent_password 는 학급 단위 공유 비밀(login_default_password 패턴)로, 서버가 검증에만 사용.
--
-- 목표:
--   classes.consent_password : 학급 동의비밀번호 (평문 text, 교사·admin 만 RLS로 접근 — classes step149 정책).
--   consents : 부모 동의 이력(복수 허용). 소유 교사 + admin 만 SELECT. 부모는 직접 못 읽고/못 넣음.
--
-- 롤백: step193-rollback.sql
-- ============================================

-- 1) classes 에 학급 동의비밀번호 컬럼 (멱등)
alter table classes add column if not exists consent_password text;

-- 2) consents 테이블 생성 (멱등) — 이력 보존(복수 허용, student_id unique 아님)
create table if not exists consents (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid references profiles(id) on delete cascade,
  class_id      uuid references classes(id) on delete cascade,
  parent_name   text,
  signature     text,            -- base64 PNG 데이터URL (부모 서명 이미지)
  consent_items jsonb,           -- 동의 항목 배열 (예: ["terms","privacy","ai_processing"])
  consented_at  timestamptz default now()
);

-- 2.1) 컬럼 보강 (테이블이 이미 일부만 존재할 때 대비 — 멱등)
alter table consents add column if not exists student_id    uuid;
alter table consents add column if not exists class_id      uuid;
alter table consents add column if not exists parent_name   text;
alter table consents add column if not exists signature     text;
alter table consents add column if not exists consent_items jsonb;
alter table consents add column if not exists consented_at  timestamptz default now();

-- 2.2) 조회용 인덱스 (unique 아님 — 자녀당 복수 동의 이력 허용)
create index if not exists idx_consents_student on consents(student_id);
create index if not exists idx_consents_class   on consents(class_id);

-- 3) RLS 활성화
alter table consents enable row level security;

-- 4) 정책 (step153 class_secrets 구조 그대로 — classes.teacher_id 조인으로 소유 교사 판정)
drop policy if exists "consents_select" on consents;
drop policy if exists "consents_delete" on consents;

-- SELECT: admin 전체 / 소유 교사 본인 학급
create policy "consents_select" on consents for select to authenticated using (
  (select public.is_admin())
  or exists (
    select 1 from classes c
    where c.id = consents.class_id and c.teacher_id = auth.uid()
  )
);

-- INSERT: 정책 없음 (의도적) — 부모(anon)는 직접 못 넣고, service_role API(/api/parent-consent)가 RLS 우회로만 기록.
--   RLS 기본 deny 이므로 authenticated 사용자의 직접 INSERT 도 차단된다.

-- DELETE: admin 만
create policy "consents_delete" on consents for delete to authenticated using (
  (select public.is_admin())
);

-- ============================================
-- 적용 확인:
-- select column_name from information_schema.columns
--   where table_name='classes' and column_name='consent_password';   -- 1행
-- select policyname, cmd from pg_policies where tablename='consents'; -- consents_select / consents_delete 2행
-- select relrowsecurity from pg_class where relname='consents';       -- t (RLS on)
-- ============================================

```

## migrations/step193-rollback.sql

```sql
-- ============================================
-- step193 롤백: consents 테이블 + classes.consent_password 제거
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 주의: consents 의 모든 부모 동의 기록(서명 이미지·동의항목·동의일시)이 영구 삭제됩니다(복구 불가).
--   classes.consent_password 도 함께 사라집니다. 롤백 전 필요한 데이터를 반드시 백업하세요.
-- ============================================

-- 정책 제거 (테이블 drop 전에 명시적으로 — 멱등)
drop policy if exists "consents_select" on consents;
drop policy if exists "consents_delete" on consents;

-- 인덱스 제거 (테이블 drop 시 자동 제거되나 방어적으로)
drop index if exists idx_consents_student;
drop index if exists idx_consents_class;

-- 테이블 제거 (cascade 로 의존 객체 함께 정리)
drop table if exists consents cascade;

-- 학급 동의비밀번호 컬럼 제거
alter table classes drop column if exists consent_password;

-- ============================================
-- 적용 확인:
-- select to_regclass('public.consents');   -- NULL 이어야 함(삭제됨)
-- select column_name from information_schema.columns
--   where table_name='classes' and column_name='consent_password';   -- 0행
-- ============================================

```

## migrations/step205-feedback-reply.sql

```sql
-- ============================================
-- step205: 피드백 답변 컬럼 + SELECT 완화(작성자 본인 열람) + 학생 노출 토글
-- ============================================
-- 이 파일 전체 복붙 → Run → "Success" 확인. 그다음 step205-verify.sql 실행.
-- (앱 코드 변경은 별도 step. 이 파일은 스키마/정책만.)
--
-- 사전 조건: step146 헬퍼(is_admin), step151(feedback.user_id + fb_select 정책).
-- 보존: reply_* 4컬럼 nullable(기존 row 영향 0), classes 토글 default false(기존 학급 영향 0),
--       INSERT/UPDATE/DELETE 정책(admin write) 불변 — SELECT만 "admin → admin OR 본인" 완화.
-- 롤백: step205-rollback.sql
-- ============================================

-- 1) feedback 답변 컬럼 (멱등, nullable)
alter table feedback add column if not exists reply_text    text;
alter table feedback add column if not exists replied_at    timestamptz;
alter table feedback add column if not exists reply_by      uuid references profiles(id) on delete set null;
alter table feedback add column if not exists reply_read_at timestamptz;

-- 2) SELECT 완화 — admin 전체 + 작성자 본인(user_id=auth.uid())
--    ※ step151의 기존 정책명 'fb_select' 확인됨. INSERT/UPDATE/DELETE는 불변.
drop policy if exists "fb_select" on feedback;
create policy "fb_select" on feedback for select to authenticated using (
  (select public.is_admin())
  or user_id = auth.uid()
);

-- 3) 학생 노출 토글 (학급 단위, 기본 꺼짐)
alter table classes add column if not exists feedback_reply_visible_to_students boolean default false;

```

## migrations/step205-rollback.sql

```sql
-- ============================================
-- step205 롤백: 피드백 답변 컬럼 + SELECT 정책 원복 + 학생 토글 제거
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- ⚠️ 주의: reply_text 등 작성된 답변 데이터가 함께 삭제됩니다(복구 불가). 롤백 전 백업 권장.
-- ============================================

-- 1) SELECT 정책을 step151 원형(admin만)으로 되돌림
drop policy if exists "fb_select" on feedback;
create policy "fb_select" on feedback for select to authenticated using (
  (select public.is_admin())
);

-- 2) feedback 답변 컬럼 제거 (답변 데이터 삭제됨)
alter table feedback drop column if exists reply_text;
alter table feedback drop column if exists replied_at;
alter table feedback drop column if exists reply_by;
alter table feedback drop column if exists reply_read_at;

-- 3) 학생 노출 토글 컬럼 제거
alter table classes drop column if exists feedback_reply_visible_to_students;

-- ============================================
-- 적용 확인:
-- select policyname, qual from pg_policies where tablename='feedback' and policyname='fb_select';
--   → qual 에 is_admin()만 (user_id 조건 없음)
-- select column_name from information_schema.columns
--   where table_name='feedback' and column_name like 'reply%';   -- 0행
-- select column_name from information_schema.columns
--   where table_name='classes' and column_name='feedback_reply_visible_to_students';  -- 0행
-- ============================================

```

## migrations/step205-verify.sql

```sql
-- ============================================
-- step205 검증: step205-feedback-reply.sql 적용 확인
-- ============================================
-- 이 파일 전체 복붙 → Run. 아래 4개 결과를 한 번에 확인한다.
-- ============================================

-- ① feedback 답변 4컬럼 생겼는지 (4행이어야 함)
select 'feedback reply cols' as check, column_name, data_type
from information_schema.columns
where table_name = 'feedback'
  and column_name in ('reply_text','replied_at','reply_by','reply_read_at')
order by column_name;

-- ② fb_select 정책이 admin OR user_id=auth.uid() 로 바뀌었는지
--    (qual 에 is_admin() 와 (user_id = auth.uid()) 가 함께 보여야 함)
select 'fb_select policy' as check, policyname, cmd, qual
from pg_policies
where tablename = 'feedback' and policyname = 'fb_select';

-- ③ feedback 정책이 4개(insert/select/update/delete) 그대로인지
--    (fb_insert / fb_select / fb_update / fb_delete 4행, write 정책 보존 확인)
select 'feedback policies' as check, policyname, cmd
from pg_policies
where tablename = 'feedback'
order by cmd, policyname;

-- ④ classes 학생 노출 토글 컬럼 생겼는지 (1행, default false)
select 'classes toggle' as check, column_name, column_default
from information_schema.columns
where table_name = 'classes' and column_name = 'feedback_reply_visible_to_students';

```

## migrations/step206-D-backfill.sql

```sql
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

```

## migrations/step206-D-rollback.sql

```sql
-- ============================================
-- step206-D 롤백: 이번 백필로 바뀐 학급만 자가가입 다시 허용
-- ============================================
-- ⚠️ 경고: 롤백하면 해당 명렬표 학급의 자가가입이 다시 열려 유령계정 위험이 되돌아온다.
--          되돌릴 명확한 이유가 있을 때만 실행할 것.
--
-- ★안전: step206d_backfill_log(백필 직전 true/null 이던 학급)만 true 로 되돌린다.
--   - 원래부터 false였던 학급(이전에 교사가 끄거나 students-bulk가 끈 학급)은 건드리지 않는다.
--   - 백필 이후 students-bulk/토글로 새로 false 된 학급도 로그에 없으니 안 건드린다.
--
-- 한계:
--   - 로그 테이블(step206d_backfill_log)이 있어야 동작한다. 로그를 지웠다면 "이번에 바뀐 학급"을
--     특정할 수 없어 정밀 롤백 불가 → 그 경우 학급별로 교사가 토글로 직접 켜야 한다.
--   - 전체를 일괄 true 로 되돌리는 건 ★권장하지 않음(원래 false였던 학급까지 열려 유령 위험).
--
-- 실행: 이 파일 복붙 → Run.
-- ============================================

update classes
set self_signup_enabled = true
where id in (select class_id from step206d_backfill_log);

-- (선택) 롤백까지 끝낸 뒤 로그 정리하려면 아래 주석을 해제해 실행:
-- drop table if exists step206d_backfill_log;

```

## migrations/step206-D-verify.sql

```sql
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

```

## migrations/step206-rollback.sql

```sql
-- ============================================
-- step206-A 롤백: self_signup_enabled 컬럼 제거
-- ============================================
-- ⚠️ 경고: 이 컬럼에 저장된 학급별 자가가입 허용/차단 설정이 모두 사라진다.
--          step206-B/C 적용 후라면, 명렬표 학급을 막아둔 설정도 함께 날아가
--          유령계정 차단이 풀린다. 되돌릴 명확한 이유가 있을 때만 실행할 것.
--
-- 실행: Supabase SQL Editor에 복붙 → Run.
-- ============================================

alter table classes drop column if exists self_signup_enabled;

```

## migrations/step206-self-signup.sql

```sql
-- ============================================
-- step206-A 생성: classes.self_signup_enabled (학생 자가가입 허용 토글)
-- ============================================
-- 목적: 명렬표(일괄등록) 학급에서 학생이 로그인 오타 → 가입 탭 전환 → 새 유령계정 생성되는 문제 차단.
--       학급별로 자가가입(가입 탭) 허용 여부를 켜고 끈다.
--
-- ★ 기본값 true: 기존 학급·신규 학급 모두 일단 가입 허용 → 이 마이그레이션만으로는 동작 변화 0.
--   명렬표 학급은 step206-B(코드: 일괄등록 시 자동 false) / step206-C(백필)에서 false로 전환.
--   지금은 컬럼만 추가한다.
--
-- 멱등: add column if not exists → 중복 실행 안전.
-- 실행: Supabase SQL Editor에 이 파일 전체 복붙 → Run.
-- ============================================

alter table classes add column if not exists self_signup_enabled boolean default true;

```

## migrations/step206-verify.sql

```sql
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

```

## migrations/step209-consent-source-create.sql

```sql
-- ============================================
-- step209: consents.source 컬럼 추가 (온라인/종이 동의 구분)
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 목적: 동의 제출 출처를 구분한다.
--   'online' = 부모가 /consent/<코드> 양식으로 직접 서명 제출 (기존 경로)
--   'paper'  = 종이 동의서를 받아 교사가 처리한 기록 (묶음 F에서 추가될 경로)
--
-- ★기본값 'online': 이 컬럼 추가 전에 쌓인 consents 행은 전부 온라인 제출이었으므로
--   기존 행은 자동으로 'online'으로 채워진다. 기존 데이터·다른 컬럼은 건드리지 않는다.
--
-- 멱등: add column if not exists → 중복 실행 안전.
-- 사전 조건: step193(consents 테이블) 적용 완료.
-- 롤백: alter table consents drop column if exists source;  (필요 시 수동)
-- ============================================

alter table consents add column if not exists source text default 'online';

```

## migrations/step209-consent-source-verify.sql

```sql
-- ============================================
-- step209 검증: consents.source 추가 확인
-- ============================================
-- 아래 ①②를 각각 따로 실행(블록 선택 후 Run)하거나, 한 번에 Run 해도 된다.
-- ============================================

-- ① consents 테이블 컬럼 목록 — source 컬럼이 생겼는지 확인 (source 행에 default 'online' 보여야 함)
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'consents'
order by ordinal_position;


-- ② source별 개수 집계 — 기존 행이 전부 'online'으로 채워졌는지 확인
--    (아직 종이 기록이 없으면 'online' 한 줄만 나오는 게 정상)
select source, count(*) as cnt
from consents
group by source
order by source;

```

## migrations/step219-consent-notice-intro.sql

```sql
-- ============================================
-- step219: 학부모 안내문 상단 인사말(편집 가능) 컬럼
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 목적: 학부모 동의 안내문을 "상단 인사말(교사 편집 가능) + 고정부(코드가 항상 자동 생성·잠금)"로 나눈다.
--   classes.consent_notice_intro : 인사말만 저장(text, nullable, 기본 null).
--     - null  → 코드가 기본 인사말("[학교 반] 학부모 동의 안내")을 생성해 사용(기존과 동일).
--     - 값 있음 → 그 값을 인사말로 사용.
--   ★ 고정부(동의 링크·동의번호·"동의는 선택/미동의 시 닉네임" 필수 문구·사용법)는 이 컬럼에 저장하지 않는다.
--     항상 코드가 effectiveConsentPassword 규칙으로 생성 → 안내문과 서버 검증이 어긋날 수 없게 한다.
--
-- 멱등: add column if not exists → 중복 실행 안전. 기존 행은 null(기본 인사말) → 동작 불변.
-- 롤백: alter table classes drop column if exists consent_notice_intro;  (필요 시 수동)
-- 사전 조건: classes 테이블(존재), step193(consent_password) 적용 완료.
-- ============================================

alter table classes add column if not exists consent_notice_intro text;

-- ============================================
-- 적용 확인:
-- select column_name from information_schema.columns
--   where table_name='classes' and column_name='consent_notice_intro';   -- 1행
-- ============================================

```

## migrations/step23-anon-ai-ranking.sql

```sql
-- ============================================
-- step23 마이그레이션: 익명화 + AI 주제 개선 + 랭킹 준비
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run

-- ① 학급에 학년 정보 추가 (AI 주제 추천 학년별)
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS grade INTEGER; -- 1~6 (초등 학년)

-- ② 학생 닉네임 (자동 부여, 게시판 익명용)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS nickname TEXT;

-- ③ 학급 설정 (게시판 범위, 랭킹 공개 여부 등)
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS board_scope TEXT DEFAULT 'class' CHECK (board_scope IN ('class', 'national', 'off'));
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS ranking_enabled BOOLEAN DEFAULT TRUE;

-- ④ 닉네임 풀: 동물 이름 같은 형식 (자동 부여)
-- 별도 테이블 없이 클라이언트에서 처리하므로 컬럼만 두면 됨

-- 확인 쿼리:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'classes' AND column_name IN ('grade', 'board_scope', 'ranking_enabled');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles' AND column_name = 'nickname';

```

## migrations/step272-topic-copies.sql

```sql
-- ============================================
-- step272 마이그레이션: 공유 주제 "가져오기" 출처 기록
-- ============================================
-- Supabase SQL Editor에서 수동 실행 (자동 적용 안 됨)
--
-- 교사 B가 교사 A의 공유 추천 주제를 가져와 자기 학급 주제로 등록하면
-- 그 출처를 기록한다. 가져온 주제는 B의 독립 주제로 유지(원본 재연결 X),
-- 여기엔 "출처"만 별도로 남긴다. (배지·인기순 정렬은 다음 단계에서 사용)
-- 멱등: IF NOT EXISTS / CREATE OR REPLACE 로 중복 실행 안전.
-- ============================================

CREATE TABLE IF NOT EXISTS topic_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 출처: 어느 추천 로그의 몇 번째 카드인지
  source_log_id UUID REFERENCES topic_suggestion_logs(id) ON DELETE CASCADE,
  source_index INTEGER NOT NULL,
  -- 누가 가져갔는지 (집계 전용 — 화면엔 노출 안 함)
  copied_by_teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- 가져와 새로 만든 주제 (독립 주제)
  copied_topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  copied_at TIMESTAMPTZ DEFAULT NOW(),
  -- 같은 교사가 같은 카드를 여러 번 가져와도 1명으로 (중복 방지)
  UNIQUE (source_log_id, source_index, copied_by_teacher_id)
);

CREATE INDEX IF NOT EXISTS idx_topic_copies_src
  ON topic_copies(source_log_id, source_index);

COMMENT ON TABLE topic_copies IS
  '공유 추천 주제를 다른 교사가 가져와 등록한 출처 기록 (집계용, 원작자/가져간이 식별은 비노출)';

-- ============================================
-- RLS: INSERT는 본인만, SELECT는 본인 행 + 관리자
-- ============================================
ALTER TABLE topic_copies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tc_insert_own" ON topic_copies;
CREATE POLICY "tc_insert_own" ON topic_copies
  FOR INSERT TO authenticated
  WITH CHECK (copied_by_teacher_id = auth.uid());

DROP POLICY IF EXISTS "tc_select_own_or_admin" ON topic_copies;
CREATE POLICY "tc_select_own_or_admin" ON topic_copies
  FOR SELECT TO authenticated
  USING (
    copied_by_teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================
-- 사용수 집계: 카운트 전용 RPC (개인정보 미노출)
-- "이 주제 N명 사용"을 위해 (source_log_id, source_index)별
-- DISTINCT 교사 수만 반환. copied_by는 절대 노출하지 않음.
-- SECURITY DEFINER 이므로 RLS와 무관하게 집계 정수만 돌려준다.
-- (다음 단계 표시/정렬에서 사용)
-- ============================================
CREATE OR REPLACE FUNCTION topic_copy_counts()
RETURNS TABLE (source_log_id UUID, source_index INTEGER, n_teachers BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT source_log_id, source_index, COUNT(DISTINCT copied_by_teacher_id) AS n_teachers
  FROM topic_copies
  GROUP BY source_log_id, source_index;
$$;

GRANT EXECUTE ON FUNCTION topic_copy_counts() TO authenticated;

-- 확인 쿼리:
-- SELECT * FROM topic_copies ORDER BY copied_at DESC LIMIT 10;
-- SELECT * FROM topic_copy_counts();

```

## migrations/step38-topic-length-rewrites.sql

```sql
-- ============================================
-- step38 마이그레이션: 주제별 글자수 + 최대 재수정 횟수
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run

-- 최소 글자수 (기본 30자, 주제별로 조정 가능)
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS min_length INTEGER DEFAULT 30;

-- 최대 재수정 횟수 (기본 1회, 0이면 수정 불가, 1=첫 글 + 수정본 1번)
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS max_rewrites INTEGER DEFAULT 1;

-- 확인 쿼리:
-- SELECT column_name, column_default FROM information_schema.columns
--   WHERE table_name = 'topics' AND column_name IN ('min_length', 'max_rewrites');

```

## migrations/step46-admin-feedback-hidden.sql

```sql
-- ============================================
-- step46 마이그레이션: 의견 숨김 처리
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run

-- 의견 숨김 (확인한 의견을 안 보이게 처리)
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN DEFAULT false;
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;

-- 확인 쿼리:
-- SELECT column_name, column_default FROM information_schema.columns
--   WHERE table_name = 'feedback' AND column_name IN ('is_hidden', 'hidden_at');

-- 참고: 관리자 권한은 profiles.role = 'admin'만 변경하면 되므로
-- 별도의 마이그레이션이 필요하지 않습니다.
-- 복수 관리자 구조는 기존 role 시스템으로 충분히 지원됩니다.

```

## migrations/step48-topic-deadline.sql

```sql
-- ============================================
-- step48 마이그레이션: 주제별 제출 기한
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run

-- 제출 마감 기한 (NULL이면 기한 없음 = 항상 제출 가능)
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS deadline_date DATE;
ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS deadline_time TIME;

-- 확인:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'topics' AND column_name LIKE 'deadline%';

```

## migrations/step60-max-length.sql

```sql
-- step60: 주제별 글 최대 길이 (토큰 절약 + 한도 효율 개선)
-- NULL이면 제한 없음

ALTER TABLE topics
  ADD COLUMN IF NOT EXISTS max_length INTEGER;

```

## migrations/step64-fix-email-domain.sql

```sql
-- step64: 학생 아이디 변경 시 잘못된 이메일 도메인 복구
-- step54 버그로 인해 @literacy.local로 잘못 저장된 학생들을 @writing.class로 복구

-- Supabase Dashboard → SQL Editor에서 실행
-- 1. 영향받은 사용자 확인 (실행 전 미리 보기)
SELECT id, email FROM auth.users WHERE email LIKE '%@literacy.local';

-- 2. 위 결과 확인 후 아래 UPDATE 실행 (한 번에 다 바꿈)
UPDATE auth.users
SET email = REPLACE(email, '@literacy.local', '@writing.class')
WHERE email LIKE '%@literacy.local';

-- 3. 변경 확인
-- SELECT id, email FROM auth.users WHERE email LIKE '%@writing.class';

```

## migrations/step70-login-hint.sql

```sql
-- step70: 학생 로그인 안내 (QR 진입 시 표시)
-- 선생님이 학급 설정에서 입력하면 학생들에게 안내 자동 표시

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS login_hint_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS login_username_prefix TEXT,
  ADD COLUMN IF NOT EXISTS login_default_password TEXT;

COMMENT ON COLUMN classes.login_hint_enabled IS '학생 로그인 안내 활성화 (QR 진입 시 표시)';
COMMENT ON COLUMN classes.login_username_prefix IS '학급 공통 아이디 접두사 (예: hr5 → hr51, hr52, ...)';
COMMENT ON COLUMN classes.login_default_password IS '초기 비밀번호 안내 (예: 1234)';

```

## migrations/step71-number-digits.sql

```sql
-- step71: 학생 번호 자릿수 안내용 컬럼 추가
-- 1 = "1, 2, ... 25" (한 자리)
-- 2 = "01, 02, ... 25" (두 자리, 일괄 등록 시 흔함)

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS login_number_digits INTEGER DEFAULT 2;

COMMENT ON COLUMN classes.login_number_digits IS '학생 번호 자릿수 (1 또는 2). 일괄 등록 시 보통 2자리(01, 02)';

```

## migrations/step78-trash.sql

```sql
-- step78: 쓰레기통 (soft delete) 기능
-- 학생 글을 즉시 영구 삭제하지 않고 30일(기본) 보관 후 자동 삭제

-- submissions 테이블에 soft delete 컬럼 추가
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deleted_by UUID,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

COMMENT ON COLUMN submissions.deleted_at IS '쓰레기통으로 이동된 시각 (NULL=활성, 값 있음=쓰레기통)';
COMMENT ON COLUMN submissions.deleted_by IS '쓰레기통으로 보낸 선생님 ID';
COMMENT ON COLUMN submissions.delete_reason IS '삭제 사유 (선생님 메모, 선택)';

-- 인덱스 추가 (쓰레기통 조회 성능)
CREATE INDEX IF NOT EXISTS idx_submissions_deleted_at ON submissions(deleted_at) WHERE deleted_at IS NOT NULL;

-- classes 테이블에 자동 삭제 기간 설정 추가
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS trash_retention_days INTEGER DEFAULT 30;

COMMENT ON COLUMN classes.trash_retention_days IS '쓰레기통 자동 삭제 기간 (일, 기본 30일)';

```

## migrations/step79-regrade.sql

```sql
-- step79: AI 재평가 기능
-- 선생님이 과거 글을 새 기준으로 다시 채점 가능
-- 이전 점수/피드백은 별도 컬럼에 백업

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS re_graded_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS re_graded_by UUID,
  ADD COLUMN IF NOT EXISTS previous_scores JSONB,
  ADD COLUMN IF NOT EXISTS previous_total_score INTEGER,
  ADD COLUMN IF NOT EXISTS previous_max_score INTEGER,
  ADD COLUMN IF NOT EXISTS previous_feedback_overall TEXT,
  ADD COLUMN IF NOT EXISTS previous_feedback_good TEXT,
  ADD COLUMN IF NOT EXISTS previous_feedback_improve TEXT;

COMMENT ON COLUMN submissions.re_graded_at IS 'AI 재평가 시각 (선생님이 다시 채점한 경우)';
COMMENT ON COLUMN submissions.re_graded_by IS '재평가를 실행한 선생님 ID';
COMMENT ON COLUMN submissions.previous_scores IS '재평가 전 점수 배열 백업';
COMMENT ON COLUMN submissions.previous_total_score IS '재평가 전 총점 백업';
COMMENT ON COLUMN submissions.previous_max_score IS '재평가 전 만점 백업';
COMMENT ON COLUMN submissions.previous_feedback_overall IS '재평가 전 종합의견 백업';
COMMENT ON COLUMN submissions.previous_feedback_good IS '재평가 전 잘한점 백업';
COMMENT ON COLUMN submissions.previous_feedback_improve IS '재평가 전 발전점 백업';

```

## migrations/step83-grading-model.sql

```sql
-- step83: 채점에 사용된 AI 모델 정보 저장
-- 메인 모델(gemini-3.1-flash-lite) 한도 도달 시 폴백된 채점에 표시

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS graded_with_model TEXT,
  ADD COLUMN IF NOT EXISTS is_fallback_graded BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN submissions.graded_with_model IS '채점에 사용된 AI 모델명';
COMMENT ON COLUMN submissions.is_fallback_graded IS '메인 모델 한도 도달로 폴백 채점됐는지 (true면 재평가 권장)';

```

## migrations/step86-rubric-reasons.sql

```sql
-- ============================================
-- step86 마이그레이션: 평가기준별 점수 근거 저장
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 학생이 점수에 납득할 수 있도록, 각 평가기준 옆에
-- "왜 이 점수가 나왔는지" 한 줄 설명을 함께 저장합니다.
-- 예) ["상상력 18/20점 — 외계인 학교라는 설정은 신선...",
--      "표현력 14/20점 — 비유가 좋았지만 ..."]
-- ============================================

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS rubric_reasons JSONB;

COMMENT ON COLUMN submissions.rubric_reasons IS '평가기준별 점수 근거 (배열, 각 한 문장)';

-- 확인 쿼리:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'submissions' AND column_name = 'rubric_reasons';

```

## migrations/step87-feedback-author.sql

```sql
-- ============================================
-- step87 마이그레이션: 의견 작성자 추적
-- ============================================
-- Supabase Dashboard → SQL Editor → New Query → 전체 복붙 → Run
--
-- 와이프 피드백 2번: "의견을 누가 줬는지 알 수 있게"
-- feedback 테이블에 user_id 컬럼 추가하고, 이후 작성되는 의견은
-- 자동으로 로그인한 사용자의 ID가 함께 저장됩니다.
-- 기존 의견은 user_id가 NULL로 남아서 "익명"으로 표시돼요.
-- ============================================

-- 1) user_id 컬럼 추가 (profiles 테이블 참조)
ALTER TABLE feedback
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

-- 2) 조회 성능을 위해 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);

COMMENT ON COLUMN feedback.user_id IS '의견 작성자 (NULL이면 익명/구버전 의견)';

-- ============================================
-- RLS 정책: 의견 작성 시 자기 user_id로만 가능
-- ============================================
-- 참고: 현재 feedback insert 정책이 어떻게 되어 있는지에 따라
-- 아래는 필요시에만 추가/수정. 보통 anon role도 insert 가능하게 열려있을 것.
-- 만약 RLS가 막힌다면 아래 정책을 참고:
--
-- CREATE POLICY "Anyone can submit feedback" ON feedback
--   FOR INSERT TO authenticated, anon
--   WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- ============================================
-- 확인 쿼리:
-- ============================================
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'feedback' ORDER BY ordinal_position;

```

## migrations/step92-topic-suggestion-logs.sql

```sql
-- ============================================
-- step92 마이그레이션: AI 주제 추천 로그
-- ============================================
-- Supabase SQL Editor에서 실행
--
-- 와이프 피드백: 어떤 주제를 AI가 추천했는지, 어떤 걸 골랐는지
-- 선생님이 나중에 볼 수 있게.
-- ============================================

CREATE TABLE IF NOT EXISTS topic_suggestion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,

  -- 요청 정보
  request_category TEXT,         -- AI에 넘긴 카테고리
  request_level TEXT,            -- 난이도 (쉬움/보통/어려움)
  request_user_message TEXT,     -- 선생님이 추가로 적은 요청 (있으면)

  -- 결과: 추천된 주제들 (배열, 최대 3개)
  -- 형태: [{ title, description, category }]
  suggestions JSONB NOT NULL,

  -- 선생님이 어떤 걸 골랐는지 (인덱스 0..2)
  -- null이면 아직 고르지 않음 / 다시 추천을 받음
  selected_index INTEGER,

  -- 결과적으로 등록된 주제 (선택 → 평가기준 만들고 → 등록)
  -- null이면 등록까지 가지 않음
  resulting_topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,

  -- 어떤 모델이 답했는지 (디버깅용)
  model_used TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topic_sug_teacher ON topic_suggestion_logs(teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topic_sug_class ON topic_suggestion_logs(class_id, created_at DESC);

COMMENT ON TABLE topic_suggestion_logs IS '교사가 받은 AI 주제 추천 로그 (선택/미선택 모두 기록)';

-- ============================================
-- RLS: 본인 + 관리자만
-- ============================================
ALTER TABLE topic_suggestion_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teachers see own suggestion logs" ON topic_suggestion_logs;
CREATE POLICY "Teachers see own suggestion logs" ON topic_suggestion_logs
  FOR SELECT TO authenticated
  USING (
    teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "Teachers insert own suggestion logs" ON topic_suggestion_logs;
CREATE POLICY "Teachers insert own suggestion logs" ON topic_suggestion_logs
  FOR INSERT TO authenticated
  WITH CHECK (teacher_id = auth.uid());

DROP POLICY IF EXISTS "Teachers update own suggestion logs" ON topic_suggestion_logs;
CREATE POLICY "Teachers update own suggestion logs" ON topic_suggestion_logs
  FOR UPDATE TO authenticated
  USING (teacher_id = auth.uid());

-- 확인 쿼리:
-- SELECT * FROM topic_suggestion_logs ORDER BY created_at DESC LIMIT 10;

```

## migrations/step92.1-fix-suggestion-logs-rls.sql

```sql
-- ============================================
-- step92.1 마이그레이션: 추천 로그 RLS 보강
-- ============================================
-- step92 실행 후 403 Forbidden 에러가 나는 경우 추가 실행
--
-- 원인: insert().select() 패턴에서 RETURNING 절이 RLS의
-- SELECT 정책을 거치는데, 정책이 미묘하게 막힐 수 있음.
-- 코드는 select 없는 insert로 변경됐지만, 혹시 모를 다른
-- 케이스를 위해 정책을 명확히 합니다.
-- ============================================

-- 기존 정책 모두 제거 후 재생성 (멱등)
DROP POLICY IF EXISTS "Teachers see own suggestion logs" ON topic_suggestion_logs;
DROP POLICY IF EXISTS "Teachers insert own suggestion logs" ON topic_suggestion_logs;
DROP POLICY IF EXISTS "Teachers update own suggestion logs" ON topic_suggestion_logs;

-- SELECT: 본인 + 관리자
CREATE POLICY "Teachers see own suggestion logs" ON topic_suggestion_logs
  FOR SELECT TO authenticated
  USING (
    teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- INSERT: teacher_id가 자기 자신이거나 admin
CREATE POLICY "Teachers insert own suggestion logs" ON topic_suggestion_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- UPDATE: 본인 + 관리자
CREATE POLICY "Teachers update own suggestion logs" ON topic_suggestion_logs
  FOR UPDATE TO authenticated
  USING (
    teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    teacher_id = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 확인:
-- SELECT polname, polcmd, polqual FROM pg_policy WHERE polrelid = 'topic_suggestion_logs'::regclass;

```

## migrations/step94-improve-examples.sql

```sql
-- ============================================
-- step94 마이그레이션: 피드백 친절·자세함 강화
-- ============================================
-- Supabase SQL Editor에서 실행
--
-- 와이프 피드백: 학생이 피드백 보고 글을 더 잘 쓰게 하려면
-- "왜 감점됐는지", "어떻게 고치면 좋은지" 구체적으로 알아야 함.
-- 발전점에 대한 구체 예시(학생 글의 어느 부분을 어떻게 고치면 좋을지)를
-- 저장하기 위한 컬럼 추가.
-- ============================================

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS improve_examples JSONB;

COMMENT ON COLUMN submissions.improve_examples IS
  '발전점에 대한 구체 예시 배열. 각 항목: {original: "학생 글의 부분", suggested: "이렇게 바꿔보세요", reason: "왜"}';

-- 확인:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'submissions' AND column_name = 'improve_examples';

```

## migrations/step96-share-suggestions.sql

```sql
-- ============================================
-- step96 마이그레이션: 추천 주제 공유
-- ============================================
-- Supabase SQL Editor에서 실행
--
-- 와이프 피드백: "내가 추천 받은 주제를 다른 선생님도 보고 선택할 수 있게"
-- 단, 모든 추천을 공유하면 사적 요청까지 노출되니 — 실제로 학급에 
-- 등록한 추천(resulting_topic_id 있음)만 다른 선생님이 볼 수 있게 함.
-- ============================================

-- 기존 SELECT 정책 교체
DROP POLICY IF EXISTS "Teachers see own suggestion logs" ON topic_suggestion_logs;

-- 새 SELECT 정책: 본인 추천 + 다른 선생님이 학급에 등록한 추천 + 관리자
CREATE POLICY "Teachers see own and shared suggestion logs" ON topic_suggestion_logs
  FOR SELECT TO authenticated
  USING (
    -- 본인 추천은 모두 볼 수 있음
    teacher_id = auth.uid()
    -- 또는 다른 선생님이 실제로 학급에 등록한 추천 (resulting_topic_id 있음)
    OR (resulting_topic_id IS NOT NULL)
    -- 관리자는 다 봄
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- INSERT/UPDATE는 기존 정책 그대로 (본인만)
-- DROP POLICY IF EXISTS "Teachers insert own suggestion logs" ON topic_suggestion_logs;
-- DROP POLICY IF EXISTS "Teachers update own suggestion logs" ON topic_suggestion_logs;

-- 인덱스 추가: 공유 추천 빨리 가져오기 위해 resulting_topic_id 있는 것만
CREATE INDEX IF NOT EXISTS idx_topic_sug_shared
  ON topic_suggestion_logs(created_at DESC)
  WHERE resulting_topic_id IS NOT NULL;

-- 확인:
-- SELECT polname, polcmd, polqual FROM pg_policy WHERE polrelid = 'topic_suggestion_logs'::regclass;

```

## migrations/step97-share-toggle.sql

```sql
-- ============================================
-- step97 마이그레이션: 추천 명시적 공유 토글
-- ============================================
-- 와이프 피드백: 선택 안 한 추천도 공유하고 싶으면 공유할 수 있게
-- 기존 자동 공유(resulting_topic_id 있는 것) + 명시 공유 토글 둘 다 지원
-- ============================================

ALTER TABLE topic_suggestion_logs
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT false;

COMMENT ON COLUMN topic_suggestion_logs.is_shared IS
  '선생님이 명시적으로 공유한 추천. true면 등록 안 했어도 다른 선생님이 봄.';

-- SELECT 정책 갱신: 본인 + 등록된 추천 + 명시 공유 + 관리자
DROP POLICY IF EXISTS "Teachers see own suggestion logs" ON topic_suggestion_logs;
DROP POLICY IF EXISTS "Teachers see own and shared suggestion logs" ON topic_suggestion_logs;

CREATE POLICY "Teachers see own and shared suggestion logs" ON topic_suggestion_logs
  FOR SELECT TO authenticated
  USING (
    teacher_id = auth.uid()
    OR (resulting_topic_id IS NOT NULL)
    OR (is_shared = true)
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- 명시 공유 추천도 빠르게
CREATE INDEX IF NOT EXISTS idx_topic_sug_explicit_shared
  ON topic_suggestion_logs(created_at DESC)
  WHERE is_shared = true;

```

## migrations/step98-teacher-comment.sql

```sql
-- ============================================
-- step98 마이그레이션: 담임 코멘트
-- ============================================
-- 와이프 피드백: AI 피드백 외에 담임이 직접 코멘트 달 수 있게
-- 학생 글 1편당 코멘트 1개 (수정 가능)
-- 학생만 자기 글의 코멘트를 봄, 관리자는 다 봄
-- ============================================

ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS teacher_comment TEXT,
  ADD COLUMN IF NOT EXISTS teacher_comment_at TIMESTAMPTZ;

COMMENT ON COLUMN submissions.teacher_comment IS '담임 선생님이 작성한 직접 코멘트 (AI 피드백 외 추가 메시지)';
COMMENT ON COLUMN submissions.teacher_comment_at IS '코멘트 마지막 작성/수정 시각';

-- ============================================
-- 기존 submissions RLS 정책을 확인해야 함:
-- - 학생 본인은 자기 submissions를 SELECT 가능 (이미 그럴 것)
-- - 담임은 자기 학급 학생 submissions를 SELECT/UPDATE 가능 (이미 그럴 것)
-- - 따라서 별도 정책 추가 필요 없음 (컬럼만 추가하면 됨)
-- ============================================

-- 확인:
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'submissions'
--   AND column_name IN ('teacher_comment', 'teacher_comment_at');

```

## migrations/step99-admin-trash.sql

```sql
-- ============================================
-- step99 마이그레이션: 관리자 휴지통 (B4)
-- ============================================
-- 선생님 계정·학급을 안전하게 정리할 수 있는 휴지통 시스템.
-- 모든 삭제는 소프트 삭제(deleted_at) + 30일 후 자동 영구삭제.
-- ============================================

-- 1) profiles에 deleted_at (선생님 휴지통)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

COMMENT ON COLUMN profiles.deleted_at IS '소프트 삭제 시각. NULL이면 정상, 값 있으면 휴지통. 30일 후 cron이 영구삭제.';
COMMENT ON COLUMN profiles.deleted_by IS '누가 삭제했는지 (관리자 id)';
COMMENT ON COLUMN profiles.delete_reason IS '삭제 사유 (선택)';

CREATE INDEX IF NOT EXISTS idx_profiles_deleted_at ON profiles(deleted_at) WHERE deleted_at IS NOT NULL;

-- 2) classes에 deleted_at (학급 휴지통)
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_reason TEXT;

COMMENT ON COLUMN classes.deleted_at IS '소프트 삭제 시각. NULL이면 정상.';

CREATE INDEX IF NOT EXISTS idx_classes_deleted_at ON classes(deleted_at) WHERE deleted_at IS NOT NULL;

-- ============================================
-- 안전장치 함수: 마지막 관리자 보호
-- 어드민 1명만 남았으면 그 어드민의 deleted_at 업데이트 금지
-- ============================================
CREATE OR REPLACE FUNCTION prevent_last_admin_deletion()
RETURNS TRIGGER AS $$
DECLARE
  active_admin_count INT;
BEGIN
  -- 어드민이 삭제되려는 경우만 검사
  IF OLD.role = 'admin' AND OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    SELECT COUNT(*) INTO active_admin_count
      FROM profiles
      WHERE role = 'admin'
        AND deleted_at IS NULL
        AND id != OLD.id;
    IF active_admin_count = 0 THEN
      RAISE EXCEPTION '마지막 관리자는 삭제할 수 없습니다.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_last_admin_deletion ON profiles;
CREATE TRIGGER trg_prevent_last_admin_deletion
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_last_admin_deletion();

-- ============================================
-- 확인 쿼리:
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name IN ('profiles', 'classes')
--   AND column_name IN ('deleted_at', 'deleted_by', 'delete_reason');
-- ============================================

```

