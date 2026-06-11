# 보안 작업 지시서 — Supabase RLS 정밀 정책 구축

> 이 문서를 Claude Code에 주고 작업을 맡깁니다.
> **목표: 출시 가능한 수준의 데이터 보안.** 현재 모든 핵심 테이블의 RLS 정책이
> `using(true) with check(true)`(전체 허용)라, 로그인만 하면(혹은 비로그인도) 누구나
> 남의 학급 학생 글·개인정보를 읽고/수정/삭제할 수 있는 심각한 구멍이 있습니다.

---

## 0. 절대 원칙 (반드시 지킬 것)

1. **앱이 깨지지 않는 것이 최우선.** RLS를 조이다가 정상 기능이 막히면 안 됨.
   정책 하나 적용할 때마다 "이 정책으로 어떤 코드 경로가 막히는가"를 코드에서
   먼저 확인하고 적용할 것.
2. **한 테이블씩, 점진적으로.** 9개 테이블을 한 번에 바꾸지 말 것. 한 테이블 →
   해당 기능 동작 확인(코드 검토 + 가능하면 로컬/스테이징 테스트) → 다음 테이블.
3. **모든 정책 SQL은 마이그레이션 파일로 저장**하고(`migrations/stepNNN-*.sql`),
   **각 테이블마다 롤백 SQL도 함께** 만들 것.
4. **service_role 키를 쓰는 서버 라우트는 RLS를 우회**하므로, 그 라우트들의
   자체 권한 검증이 견고한지 별도로 점검할 것 (아래 5번 항목).
5. 작업 전후로 git commit. 단계마다 커밋해서 언제든 되돌릴 수 있게.

---

## 1. 먼저 전체 파악 (코드를 직접 읽어서 매트릭스 작성)

다음 9개 테이블 각각에 대해, **코드베이스 전체를 grep/읽기로 조사**해서
"누가(익명/학생/교사/관리자) 어떤 작업(SELECT/INSERT/UPDATE/DELETE)을
어떤 조건으로 하는지" 매트릭스를 만들어라.

테이블 (사용 빈도순):
- `profiles` (78회) — 사용자. id=auth.uid, class_id, role(student/teacher/admin)
- `submissions` (47회) — 학생 글. user_id, class_id
- `classes` (29회) — 학급. teacher_id가 소유자, code(가입용)
- `topics` (18회) — 글쓰기 주제. teacher_id 소유
- `topic_suggestion_logs` (8회)
- `feedback` (7회) — 의견 보내기
- `password_reset_requests` (4회)
- `tutor_chat_usage` (2회)
- `school_records` (2회) — 생기부 평어 (이미 RLS 정책 있음: teacher_id=auth.uid)

**특히 주의해서 찾아야 할 "정책이 막으면 안 되는" 접근 경로:**
- 회원가입(로그인 전, 비로그인 상태): 학생/교사 가입 시 `classes`를 code로 SELECT,
  `profiles`를 닉네임 중복 확인용 SELECT — 이걸 막으면 **가입이 깨진다**.
  (pages/student/login.js, pages/teacher/login.js 확인)
- 학생이 랭킹/예시에서 같은 학급 다른 학생 데이터를 보는 경로
  (pages/student/ranking.js, history.js)
- 관리자(role=admin)가 **여러 학급을 가로질러** 조회하는 경로 (pages/admin/index.js)
- 교사가 학생 글 보기에서 submissions+profiles+topics 조인하는 경로
  (pages/teacher/submissions.js — 최근 여기서 버그가 있었으니 특히 조심)
- 공유된 주제 추천 (topic_suggestion_logs, step96~108 공유 기능)
- impersonation(관리자가 교사 계정처럼 보기) 경로가 있는지

## 2. 인증 구조 (이미 확인된 사실)

- 학생·교사 **모두 Supabase Auth 사용** (signInWithPassword). 따라서 정책에서
  `auth.uid()` 사용 가능.
- profiles.id = auth.uid(). profiles.role 로 student/teacher/admin 구분.
- 가입은 이메일 인증 없이 즉시 세션 생성되는 것으로 보임(가입 직후 바로 사용 가능).
  단, **이것을 코드와 Supabase Auth 설정에서 반드시 재확인**할 것. 만약 이메일
  확인이 켜져 있으면 가입 직후 profiles INSERT가 auth.uid() null로 막힐 수 있음.

## 3. 목표 정책 설계 (가이드라인 — 코드 확인 후 조정)

각 테이블에 대략 다음 방향. **단, 1번 매트릭스로 실제 경로를 확인한 뒤 확정할 것.**

- **profiles**:
  - SELECT: 본인(id=auth.uid) + 같은 class_id 구성원 + 그 학급 담임 + admin.
    단 가입 시 닉네임 중복확인(비로그인 SELECT)이 필요하면, 그 쿼리를 서버 라우트로
    옮기거나, 최소 컬럼만 노출하는 별도 정책/뷰 검토.
  - INSERT: 본인 행(id=auth.uid)만. (가입 시 자기 프로필 생성)
  - UPDATE/DELETE: 본인 + 그 학급 담임 + admin.
- **submissions**:
  - SELECT: 글쓴이 본인 + 그 학급 담임 + admin.
  - INSERT: 본인(user_id=auth.uid)만.
  - UPDATE: 본인(수정본) + 담임(채점·코멘트) + admin.
  - DELETE: 담임 + admin.
- **classes**:
  - SELECT: 가입을 위해 code로 조회가 필요 → 비로그인 SELECT를 허용하되 **최소
    컬럼만**(예: id, name, is_active) 노출하는 방법 강구. teacher_id, api_key 같은
    민감 컬럼은 절대 일반 노출 금지. (api_key는 특히 중요 — 컬럼 단위 보호 검토)
  - INSERT: 교사 본인(teacher_id=auth.uid).
  - UPDATE/DELETE: 소유 교사 + admin.
- **topics**: SELECT는 같은 학급 학생 + 담임 + admin. 쓰기는 담임 + admin.
- **feedback / password_reset_requests / tutor_chat_usage / topic_suggestion_logs**:
  각자 소유자/대상자 + admin 으로 제한. 코드 경로 확인 후 설계.
- **school_records**: 이미 적절(teacher_id=auth.uid). 검토만.

### ⚠️ classes.api_key 특별 주의
api_key가 classes 테이블에 평문으로 있고, 학생이 AI를 쓰려면 이 키가 필요한 구조.
학생 클라이언트가 키를 읽어야 한다면 이미 노출 위험이 있음. 현재 어떻게 학생에게
전달되는지 코드에서 확인하고, 최소한 **다른 학급 사람은 못 읽도록** 반드시 제한할 것.
(가능하면 api_key를 별도 테이블로 분리하거나 서버 프록시 경유를 검토 — 단 이건
큰 변경이니 별도 제안만 하고, 우선은 RLS로 학급 격리부터.)

## 4. 적용 순서 (한 단계씩, 각 단계 후 검증)

1. `submissions` (가장 민감) → 학생 글쓰기/제출/수정, 교사 채점/코멘트/글보기,
   학생 본인 history 확인.
2. `profiles` → 가입, 로그인, 학생목록, 닉네임/비번 변경, 관리자 학생관리 확인.
3. `classes` → 가입(code 조회), 학급설정, api_key 학생 전달, 관리자 확인.
4. `topics` → 주제 등록/조회/마감, 학생 주제 보기 확인.
5. 나머지 4개 테이블.

각 단계: 정책 SQL 작성 → 적용 → **관련 기능을 코드로 추적해 막히는 곳 없는지 확인**
→ 깨지면 즉시 수정 또는 롤백 → 통과하면 git commit → 다음.

## 5. service_role 라우트 점검 (RLS 우회하므로 별도)

다음 라우트들은 SUPABASE_SERVICE_ROLE_KEY로 RLS를 우회한다. 각각 **호출자 권한을
서버에서 검증**하는지 확인하고, 허점이 있으면 보완:
- `pages/api/update-student-username.js` (권한: 같은 학급 담임 또는 admin)
- `pages/api/reset-student-password.js` (권한: 같은 학급 담임 또는 admin)
- `pages/api/reset-teacher-password.js` (권한: admin만)
- `pages/api/cron-trash-cleanup.js` (cron — 외부에서 못 부르게 시크릿 검증 필요)
- `pages/api/cron-admin-trash-cleanup.js` (cron — 동일)
- `pages/api/students-bulk.js` (학생 일괄 등록 — 권한 검증 확인)

확인 포인트: 이 라우트들이 요청자의 access token을 받아 "이 사람이 정말 그 학급
담임/admin이 맞는지"를 DB로 재검증하는가? 단순히 파라미터만 믿고 실행하면 누구나
남의 학생 비번을 초기화할 수 있는 구멍이 된다. cron 라우트는 CRON_SECRET 같은
헤더 검증이 있는가?

## 6. 침투 테스트 (정책 적용 후 실제로 뚫어보기)

정책 적용 후, 실제로 막혔는지 검증:
- 로그인 안 한 상태에서 `supabase.from('submissions').select('*')` → 빈 결과/거부여야 함
- A 교사 계정으로 로그인해서 B 학급 submissions 조회 시도 → 거부여야 함
- 학생 계정으로 다른 학생 글 UPDATE/DELETE 시도 → 거부여야 함
- classes에서 api_key를 다른 학급 사람이 읽기 시도 → 거부여야 함
이런 시도를 위한 임시 테스트 스크립트를 만들어 확인하고, 끝나면 삭제.

## 7. 마무리

- 모든 마이그레이션 SQL을 migrations/ 에 정리, 적용 순서 README 작성.
- 변경 요약 + "수동으로 Supabase에 실행해야 할 SQL 목록"을 명확히 정리.
- CLAUDE.md(또는 별도 문서)에 RLS 정책 구조를 기록해 향후 테이블 추가 시 참고.

---

## 작업 시작 멘트 (Claude Code에 이렇게 말하면 됨)

"SECURITY-RLS-TASK.md 를 읽고, 1번 매트릭스 작성부터 시작해줘. 코드 전체를 조사해서
각 테이블의 실제 접근 경로를 먼저 표로 정리하고, 나에게 보여준 다음에 정책 설계로
넘어가자. 절대 한 번에 다 바꾸지 말고, 단계마다 확인받고 진행해줘. 모든 설명은
한국어로."
