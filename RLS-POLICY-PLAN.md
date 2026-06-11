# RLS 정책 설계안 (2단계 산출물 — 검토용)

> `SECURITY-RLS-MATRIX.md`(접근 경로 매트릭스)를 근거로 한 정책 설계.
> **아직 적용 전.** 사용자 검토 → 승인 후 테이블 하나씩 마이그레이션 작성·적용.
> 마지막 커밋이 step145이므로 마이그레이션은 step146부터 번호를 쓴다.

---

## 0. 적용 전 반드시 확인할 것 (Supabase SQL Editor에서)

```sql
-- (a) submissions에 class_id 컬럼이 실재하는가? (지시서는 있다고 하나 코드는 안 씀)
SELECT column_name FROM information_schema.columns WHERE table_name = 'submissions';

-- (b) feedback 테이블의 작성자 컬럼명 확인 (step87-feedback-author.sql 참고)
SELECT column_name FROM information_schema.columns WHERE table_name = 'feedback';

-- (c) 현재 걸려 있는 정책 전체 덤프 (적용 전 스냅샷 보관)
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies ORDER BY tablename, policyname;
```

- (a)에서 `class_id`가 **있으면** submissions 정책을 단순화(서브쿼리 불필요)할 수 있으나,
  코드가 INSERT 시 class_id를 안 넣으므로 **신뢰할 수 없는 값**일 수 있다 → 본 설계는
  class_id에 의존하지 않고 `user_id → profiles.class_id` 경유로 설계한다.
- **Supabase Auth 설정에서 "Confirm email"이 꺼져 있는지 확인.** 코드 전체가
  signUp 직후 즉시 세션이 생기는 것을 전제한다 (login.js가 signUp 후 바로 INSERT).

---

## 1. 공통 기반: SECURITY DEFINER 헬퍼 함수 (step146)

profiles 정책이 profiles 자신을 참조하면 **무한 재귀**가 발생한다.
이를 피하기 위해 RLS를 우회(SECURITY DEFINER)하는 작은 헬퍼 함수를 먼저 만든다.

```sql
-- step146-rls-helpers.sql
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() $$;

create or replace function public.my_class_id() returns uuid
language sql stable security definer set search_path = public as
$$ select class_id from profiles where id = auth.uid() $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role = 'admin' from profiles where id = auth.uid()), false) $$;

-- 학생/교사 구분 없이 "이 user_id가 내 학급 소속인가"
create or replace function public.is_my_classmate(target uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists(
     select 1 from profiles
     where id = target and class_id is not null and class_id = public.my_class_id()
   ) $$;

-- 내 학급의 담임 teacher_id (학생이 topics를 볼 때 사용)
create or replace function public.my_class_teacher_id() returns uuid
language sql stable security definer set search_path = public as
$$ select teacher_id from classes where id = public.my_class_id() $$;

-- 함수 실행 권한
grant execute on function public.my_role(), public.my_class_id(), public.is_admin(),
  public.is_my_classmate(uuid), public.my_class_teacher_id() to authenticated, anon;
```

롤백: `drop function ...` 5개 (step146-rollback.sql).

> 성능 메모: 정책 안에서 함수는 `stable`이라 쿼리당 캐시된다. 추가로 정책 본문에서
> `(select public.is_admin())` 처럼 서브쿼리로 감싸면 행마다가 아니라 쿼리당 1회 평가된다
> (Supabase 공식 권장 패턴). 아래 정책 SQL은 모두 이 패턴으로 작성한다.

---

## 2. 테이블별 정책 설계

### 2-1. submissions (1순위 — 가장 민감)

| 작업 | 허용 대상 |
|---|---|
| SELECT | 본인(user_id=auth.uid) / **같은 학급 구성원**(랭킹 필요) / 담임(교사 role + 글쓴이가 내 학급) / admin |
| INSERT | 본인(user_id=auth.uid)만 |
| UPDATE | 본인(수정본·예시 저장) / 담임 / admin |
| DELETE | 담임 / admin (학생은 소프트삭제=UPDATE만) |

```sql
-- step147-rls-submissions.sql (초안)
drop policy if exists "submissions_select" on submissions;
drop policy if exists "submissions_write"  on submissions;
drop policy if exists "submissions_update" on submissions;
drop policy if exists "submissions_delete" on submissions;

create policy "sub_select" on submissions for select to authenticated using (
  user_id = auth.uid()
  or (select public.is_admin())
  or public.is_my_classmate(user_id)          -- 랭킹: 같은 학급 (교사·학생 모두 커버)
);

create policy "sub_insert" on submissions for insert to authenticated with check (
  user_id = auth.uid()
);

create policy "sub_update" on submissions for update to authenticated using (
  user_id = auth.uid()
  or (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and public.is_my_classmate(user_id))
) with check (
  user_id = auth.uid()
  or (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and public.is_my_classmate(user_id))
);

create policy "sub_delete" on submissions for delete to authenticated using (
  (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and public.is_my_classmate(user_id))
);
```

**알려진 트레이드오프**: 같은 학급 학생끼리는 (랭킹 때문에) 서로의 submissions **행 전체**를
읽을 수 있다 — RLS는 컬럼 단위 제한이 안 되므로, 개발자도구를 쓰면 친구 글 본문도 읽을 수 있다.
당장은 "타 학급 완전 차단"이 목표이므로 수용하고, 추후 랭킹을 집계 RPC(뷰)로 빼는 보강을 별도 제안.

**막히는지 점검할 경로**: 학생 제출/수정본/예시저장(student/index.js), history, ranking,
교사 채점·코멘트·휴지통·재평가·문법백필, admin 통계·휴지통. → 매트릭스의 모든 경로가 위 4개 정책에 포함됨.

### 2-2. profiles (2순위)

| 작업 | 허용 대상 |
|---|---|
| SELECT | 본인 / 같은 학급 구성원 / admin |
| INSERT | 본인 행(id=auth.uid)만 |
| UPDATE | 본인 / 담임(대상이 내 학급 student) / admin |
| DELETE | admin만 |

```sql
-- step148-rls-profiles.sql (초안)
create policy "prof_select" on profiles for select to authenticated using (
  id = auth.uid()
  or (select public.is_admin())
  or (class_id is not null and class_id = (select public.my_class_id()))
);

create policy "prof_insert" on profiles for insert to authenticated with check (
  id = auth.uid()
);

create policy "prof_update" on profiles for update to authenticated using (
  id = auth.uid()
  or (select public.is_admin())
  or ((select public.my_role()) = 'teacher' and role = 'student'
      and class_id = (select public.my_class_id()))
) with check ( /* using과 동일 */ );

create policy "prof_delete" on profiles for delete to authenticated using (
  (select public.is_admin())
);
```

**⚠️ 이 정책이 깨뜨리는 기존 코드 2곳 — 코드 수정이 함께 필요**:

1. **학생 가입 닉네임 중복확인** (`student/login.js:236`): profile INSERT **전에**
   동급생 nickname을 SELECT한다. 그 시점엔 내 profile이 없어 `my_class_id()`가 null →
   조회 결과가 빈 배열이 되어 **에러는 아니지만 닉네임 중복 가능**.
   → 수정: profile을 먼저 INSERT(닉네임 없이) → 그 다음 동급생 조회 → 본인 UPDATE로 닉네임 부여.
2. **admin 중복가입 확인** (`teacher/login.js:228`): **비로그인 상태**에서
   `role='admin'` 존재 여부를 SELECT → 차단되어 항상 null → admin 중복 가입 가능해짐.
   → 수정: 이 확인을 `/api/verify-code`(서버)로 이동 (service_role로 admin 존재 확인).

### 2-3. classes (3순위 — api_key 보호가 핵심)

| 작업 | 허용 대상 |
|---|---|
| SELECT | **내 학급 구성원**(id=my_class_id) / 소유 교사(teacher_id=auth.uid) / admin. **익명 SELECT 전면 제거** |
| INSERT | teacher_id=auth.uid (교사 가입 시) |
| UPDATE | 소유 교사 / admin |
| DELETE | admin만 |

```sql
-- step149-rls-classes.sql (초안)
create policy "cls_select" on classes for select to authenticated using (
  teacher_id = auth.uid()
  or id = (select public.my_class_id())
  or (select public.is_admin())
);
-- 익명용 정책은 만들지 않는다 → anon은 0행
create policy "cls_insert" on classes for insert to authenticated with check (teacher_id = auth.uid());
create policy "cls_update" on classes for update to authenticated
  using (teacher_id = auth.uid() or (select public.is_admin()))
  with check (teacher_id = auth.uid() or (select public.is_admin()));
create policy "cls_delete" on classes for delete to authenticated using ((select public.is_admin()));
```

**효과**: `api_key`는 본인 학급 구성원+담임+admin만 읽을 수 있게 됨 (타 학급·익명 완전 차단).
같은 학급 학생에게 키가 보이는 건 현 아키텍처의 한계로 수용 (별도 제안 참고).

**⚠️ 이 정책이 깨뜨리는 기존 코드 3곳 — 신규 서버 라우트 1개로 해결**:

새 라우트 **`/api/class-lookup`** (service_role, 비밀정보 미반환):
- 입력: `{ code }` → 출력: `{ id, name, school, is_active, deleted_at, login_hint_enabled, login_username_prefix, login_default_password }` **만** (teacher_id·api_key 절대 제외)
- 입력: `{ checkCode }` → 출력: `{ exists: true/false }` (교사 가입 시 코드 중복확인용)

수정 대상:
1. `student/login.js:69` QR 학급 힌트 조회 → `/api/class-lookup`
2. `student/login.js:208` 가입 시 학급코드 조회 → `/api/class-lookup`
3. `teacher/login.js:241` 새 학급코드 중복확인 → `/api/class-lookup` (checkCode)

> 참고: 학생 가입 직후 profiles INSERT의 `class_id`는 이 라우트가 돌려준 id를 그대로 쓰므로 영향 없음.

### 2-4. topics (4순위)

| 작업 | 허용 대상 |
|---|---|
| SELECT | 소유 교사 / **내 학급 담임의 주제**(학생) / admin |
| INSERT/UPDATE/DELETE | 소유 교사 / admin |

```sql
-- step150-rls-topics.sql (초안)
create policy "top_select" on topics for select to authenticated using (
  teacher_id = auth.uid()
  or teacher_id = (select public.my_class_teacher_id())   -- 학생: 우리 담임 주제
  or (select public.is_admin())
);
create policy "top_write" on topics for insert to authenticated
  with check (teacher_id = auth.uid() or (select public.is_admin()));
create policy "top_update" on topics for update to authenticated
  using (teacher_id = auth.uid() or (select public.is_admin()))
  with check (teacher_id = auth.uid() or (select public.is_admin()));
create policy "top_delete" on topics for delete to authenticated
  using (teacher_id = auth.uid() or (select public.is_admin()));
```

### 2-5. 나머지 4개 (5순위, 한 파일 step151)

**feedback** (작성자 컬럼명은 0-(b)에서 확인 후 확정):
- INSERT: authenticated 전원 허용 (`with check (auth.uid() is not null)`; 작성자 컬럼 있으면 `= auth.uid()` 추가)
- SELECT/UPDATE: admin만. DELETE: admin만.

**password_reset_requests**:
- INSERT: **anon 포함 전원 허용** (`to anon, authenticated with check (true)`) — 비번 분실자는 비로그인이므로 필수.
  스팸 위험은 수용 (필요시 추후 rate limit).
- SELECT/UPDATE/DELETE: admin만.

**tutor_chat_usage**: 기존 정책(`user_id = auth.uid()` FOR ALL) 적절 → **변경 없음, 검토만.**

**school_records**: 기존 정책(`teacher_id = auth.uid()` FOR ALL) 적절 → **변경 없음, 검토만.**

**topic_suggestion_logs**: step108 정책이 이미 정밀(본인+공유분+admin) → **변경 없음, 검토만.**
단 DELETE 정책이 없는지 0-(c) 덤프에서 확인 (없으면 본인+admin DELETE 추가).

---

## 3. RLS와 별개로 같이 고쳐야 하는 서버 코드 (정책 적용 전/중 수행)

| # | 파일 | 문제 | 수정 |
|---|---|---|---|
| S1 | `pages/api/students-bulk.js` | **권한 검증 전무** — 누구나 임의 학급에 학생 일괄생성. anon 키라 RLS 적용 시 동작도 불안정 | accessToken 받기 → getUser → 요청자가 해당 classId의 담임 또는 admin인지 검증 → service_role로 생성. 호출부(teacher/students.js)도 토큰 전달 추가 |
| S2 | `pages/api/cron-trash-cleanup.js`, `cron-admin-trash-cleanup.js` | `if (cronSecret && ...)` — CRON_SECRET 미설정 시 무검증 | 시크릿 없으면 500으로 거부(필수화) + Vercel 환경변수에 CRON_SECRET 등록 안내 |
| S3 | (신규) `pages/api/class-lookup.js` | 2-3 참조 | 익명 학급코드 조회 전용, 안전 컬럼만 반환 |
| S4 | `pages/api/verify-code.js` | admin 중복확인이 클라이언트(비로그인 SELECT)에 있음 | role=admin 검증 시 admin 존재 여부도 서버에서 확인해 거부 |

비번/아이디 라우트 3종(reset-student/teacher-password, update-student-username)은 검증 견고 → 변경 없음.

---

## 4. 적용 순서 (한 단계 = 마이그레이션 + 롤백 + 코드수정 + 검증 + commit)

| 단계 | 내용 | 동반 코드 수정 | 검증 포인트 |
|---|---|---|---|
| 0 | 사전 확인 쿼리(0번) + 현재 정책 스냅샷 저장 | — | — |
| 1 | step146 헬퍼 함수 | — | 함수 단독 실행 테스트 |
| 2 | step147 submissions | — | 학생 글쓰기/수정/history/랭킹, 교사 채점/휴지통, admin 통계 |
| 3 | step148 profiles | 닉네임 중복확인 순서 변경(login.js), S4 | 학생/교사 가입, 로그인, 학생관리, 랭킹 닉네임 |
| 4 | step149 classes | S3 신규 라우트 + login.js 2곳 + teacher/login.js 1곳 | **학생 가입(QR 포함)**, 교사 가입, AI 호출(api_key), 학급설정 |
| 5 | step150 topics | — | 주제 등록/수정/삭제, 학생 주제 보기, 마감 |
| 6 | step151 나머지 (feedback, password_reset_requests) | — | 의견 보내기, 비번 초기화 요청(비로그인!), admin 의견함 |
| 7 | S1 students-bulk 재작성, S2 cron 필수화 | 해당 파일 | 엑셀 일괄 업로드, cron 수동 호출 401 |
| 8 | 침투 테스트 (아래 5번) | — | — |

각 단계마다: 적용 → 코드 경로 점검 → 깨지면 롤백 SQL 즉시 실행 → 통과 시 `git commit`.
step144(임시 방어)의 정책들은 각 테이블 단계에서 `drop policy`로 대체된다.

---

## 5. 침투 테스트 계획 (적용 완료 후)

임시 스크립트(`scripts/rls-pentest.mjs`, 종료 후 삭제)로 anon 키 클라이언트를 만들어:

1. 비로그인: `submissions/profiles/classes/topics` SELECT → **0행**이어야 함
2. 비로그인: `password_reset_requests` INSERT → **성공**해야 함 (유일한 익명 쓰기)
3. 학생 A 계정: 타 학급 학생 B의 submissions SELECT/UPDATE/DELETE → 0행/거부
4. 학생 A: 같은 반 친구 글 UPDATE 시도 → 거부 (SELECT는 허용됨 — 의도된 트레이드오프)
5. 교사 A: B 학급 classes의 api_key SELECT → 0행
6. 교사 A: B 학급 학생 profiles UPDATE → 거부
7. `/api/students-bulk`를 토큰 없이 호출 → 401
8. cron 라우트를 시크릿 없이 호출 → 401

---

## 6. 별도 제안 (이번 작업 범위 밖, 추후 검토)

- **api_key를 classes에서 분리**: `class_secrets` 테이블(교사+admin만 SELECT) + 학생 AI 호출은
  서버(/api/ai)가 학급 키를 직접 조회하는 구조로 변경 → 학생에게 키 자체가 안 보임.
  /api/ai가 이미 프록시이므로 자연스러운 확장이나, 키 등록·검증 UI까지 영향이 커서 별도 단계로.
- **랭킹 집계 RPC**: 같은 학급 submissions 전체 노출 대신 점수 집계만 반환하는
  `security definer` 함수로 교체 → 친구 글 본문 비노출.
- password_reset_requests INSERT rate limit (Vercel 미들웨어 또는 Turnstile).
