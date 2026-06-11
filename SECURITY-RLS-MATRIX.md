# RLS 접근 경로 매트릭스 (1단계 산출물)

> 코드베이스 전체(`pages/`, `components/`)를 grep·정독해 각 테이블의 실제 접근 경로를
> 정리한 표. **정책 설계 전 검토용.** 작성 시점: security work 시작 직후.

## 범례
- 행위자: **익명**(로그인 전) / **학생** / **교사** / **관리자**(admin) / **서버**(service_role 또는 anon API 라우트)
- 조건: 정책에서 걸어야 할 핵심 제약(누구의 행을 만질 수 있어야 하는가)

---

## 1. profiles (사용자 — 78회)
주요 컬럼: `id`(=auth.uid), `class_id`, `role`, `username`, `realname`, `nickname`, `number`, `is_hidden`, `is_banned`, `deleted_at`, `school`

| 행위자 | 작업 | 위치 | 조건 |
|---|---|---|---|
| 익명 | INSERT | student/login.js:248, teacher/login.js:251 | **가입 직후**(signUp으로 세션 생김) 본인 행 생성. id=auth.uid |
| 익명→세션 | SELECT | student/login.js:236 | 가입 직후 같은 class_id 학생 nickname 중복확인 |
| 학생 | SELECT 본인 | index.js, ranking.js:38, history.js:99 | id=auth.uid |
| 학생 | SELECT 동급생 | ranking.js:60 | 같은 class_id + role=student (id, nickname, number, is_hidden만) |
| 교사 | SELECT 학급학생 | teacher/students.js:66, submissions.js:149, status.js:53, topics.js:147, student-growth.js:34, index.js:81, feedback-reports.js:33, trash.js:39 | 본인 class_id + role=student |
| 교사 | UPDATE 학생 | teacher/students.js:640~920 (닉네임·번호·숨김·동의서 등) | 본인 학급 학생 |
| 관리자 | SELECT 전체 | admin/index.js:63,80,93,108,146,177,1704,1731 | 학급 무관 전체 |
| 관리자 | UPDATE | admin/index.js:255(ban),368,380,502(role) | 임의 교사/학생 |
| 관리자 | DELETE | admin/index.js:401 | 임의 |
| 서버 | SELECT/UPDATE/INSERT | reset-*·update-student-username(service_role), students-bulk(anon) | RLS 우회 또는 anon |
| 서버(cron) | UPDATE class_id=null, DELETE | cron-*-trash-cleanup | service_role |

## 2. submissions (학생 글 — 47회)
주요 컬럼: `user_id`, `topic_id`, `deleted_at`, `total_score`, `max_score`, `attempt`, `is_final`, `example_text`, 코멘트/신고 관련. ⚠️ **class_id 컬럼을 직접 쓰는 코드는 없음** — 항상 user_id(학생) 또는 topic_id(교사 소유)를 통해 간접 격리.

| 행위자 | 작업 | 위치 | 조건 |
|---|---|---|---|
| 학생 | SELECT 본인 | student/index.js:245,259,302,351,695, history.js:105 | user_id=auth.uid |
| 학생 | SELECT 동급생(랭킹) | ranking.js:73 | user_id ∈ 같은 학급 학생 (점수 통계용) |
| 학생 | INSERT | student/index.js:512,772 | user_id=auth.uid |
| 학생 | UPDATE 본인 | student/index.js:571,595,624,798 (예시·수정본·최종) | user_id=auth.uid |
| 교사 | SELECT 학급 글 | submissions.js:156,209, status.js:71, topics.js:156, record.js:10, feedback-reports.js:42, trash.js:46, student-growth.js:40, grammar-backfill.js:60 | topic 소유 또는 user_id ∈ 본인 학급 학생 |
| 교사 | UPDATE (채점·코멘트·재평가) | submissions.js:370,388,542,591,1273,1291, feedback-reports.js:59, grammar-backfill.js:155 | 본인 학급 글 |
| 교사 | UPDATE/DELETE (휴지통) | trash.js:66,86 | 본인 학급 글 |
| 관리자 | SELECT/DELETE | admin/index.js:66,67,117,185,461,1725,1985 | 전체 |
| 서버(cron) | DELETE | cron-*-trash-cleanup | service_role |

## 3. classes (학급 — 29회)
주요 컬럼: `id`, `name`, `code`(가입용), `teacher_id`(소유자), **`api_key`(평문 Gemini 키 ⚠️)**, `school`, `grade`, `is_active`, `deleted_at`, `ranking_enabled`, `tutor_chat_enabled`, `login_hint_enabled`, `login_username_prefix`, `login_default_password`, `trash_retention_days`

| 행위자 | 작업 | 위치 | 조건 |
|---|---|---|---|
| 익명 | SELECT by code | student/login.js:69,208 | **가입/QR 힌트 — 로그인 전 필수.** 단 노출 컬럼: id,name,is_active,school,deleted_at + login_hint_*(prefix·default_password) |
| 익명→세션 | SELECT/INSERT | teacher/login.js:241(code중복),246(INSERT) | 가입 직후. teacher_id=auth.uid |
| 학생 | SELECT 본인학급 | student/index.js:209,277, ranking.js:39 | id=본인 class_id. **api_key 포함**(AI 호출용) |
| 교사 | SELECT 본인학급 | teacher/index.js:105, topics.js:101, 다수 | teacher_id=auth.uid (api_key 포함) |
| 교사 | UPDATE | teacher/index.js:183(code), ClassSettings 등 | teacher_id=auth.uid |
| 관리자 | SELECT/UPDATE/DELETE | admin/index.js:64,152,422,434,466,476,1698 | 전체 |
| 서버(cron) | SELECT/DELETE | cron-*-trash-cleanup | service_role |

## 4. topics (주제 — 18회)
주요 컬럼: `id`, `teacher_id`(소유), `date`, `lock_*`, `deadline`, 평가기준(rubric) 등

| 행위자 | 작업 | 위치 | 조건 |
|---|---|---|---|
| 학생 | SELECT | student/index.js:231,283,295 | 본인 학급 담임(teacher_id=본인 학급의 teacher_id)의 주제 |
| 교사 | SELECT | teacher/topics.js:131,443, submissions.js:131, status.js:39, index.js:79,98, grammar-backfill.js:36 | teacher_id=auth.uid |
| 교사 | INSERT/UPDATE/DELETE | topics.js:363,450,467,519 | teacher_id=auth.uid |
| 관리자 | SELECT/DELETE | admin/index.js:457,1995 | 전체 |
| 서버(cron) | SELECT/DELETE | cron-admin-trash-cleanup:50,60 | service_role |

## 5. topic_suggestion_logs (주제 추천 로그 — 8회)
주요 컬럼: `teacher_id`(작성자), 공유 관련(`shared`/share 토글, step96~108)

| 행위자 | 작업 | 위치 | 조건 |
|---|---|---|---|
| 교사 | INSERT | topics.js:487,626,711,777 | teacher_id=auth.uid |
| 교사 | SELECT 본인 | topics.js:828 | teacher_id=auth.uid |
| 교사 | SELECT 공유분 | topics.js:836 | 공유 플래그 켜진 타 교사 로그 (전체 교사 대상) |
| 교사 | UPDATE/DELETE | topics.js:873 | 본인 작성분 |
| 관리자 | SELECT | admin/index.js:223 | 전체 |

## 6. feedback (의견 보내기 — 7회)
주요 컬럼: `user_id`?, `is_hidden`, `hidden_at`, 내용

| 행위자 | 작업 | 위치 | 조건 |
|---|---|---|---|
| 학생/교사 | INSERT | components/FeedbackModal.js:18 | 로그인 사용자 본인 의견 |
| 관리자 | SELECT/UPDATE | admin/index.js:68,517,532,546,561,575 | 전체 (숨김 처리) |
| (참고) | — | lib/supabase.js 주석 | impersonation 가드에서 feedback은 제외 대상 |

## 7. password_reset_requests (비번 초기화 요청 — 4회)
주요 컬럼: `username`, `realname`, `school`, `contact`, 상태

| 행위자 | 작업 | 위치 | 조건 |
|---|---|---|---|
| 익명 | INSERT | teacher/login.js:44 | **완전 비로그인** — 교사가 비번 분실 시 요청 |
| 관리자 | SELECT/UPDATE | admin/index.js:236,321,332 | 전체 (처리/완료) |

## 8. tutor_chat_usage (튜터챗 사용량 — 2회)
주요 컬럼: `user_id`, `used_date`, `count`

| 행위자 | 작업 | 위치 | 조건 |
|---|---|---|---|
| 학생 | SELECT/UPSERT 본인 | components/TutorChat.js:30,49 | user_id=auth.uid, 일자별 사용량 |

## 9. school_records (생기부 평어 — 2회, 이미 RLS 있음)
주요 컬럼: `teacher_id`, `student_id`?, 내용

| 행위자 | 작업 | 위치 | 조건 |
|---|---|---|---|
| 교사 | SELECT/UPSERT | teacher/record.js:96,160 | teacher_id=auth.uid (기존 정책과 일치 — 검토만) |

---

## 🚨 RLS가 막으면 "가입/핵심 기능이 깨지는" 경로 (절대 차단 금지)
1. **classes SELECT (비로그인, code로)** — student/login.js:69,208. 학생 가입은 signUp **전에** 학급코드로 조회함. 막으면 학생 가입 불가. → 비로그인 SELECT 허용하되 **민감 컬럼(teacher_id, api_key) 제외** 설계 필요(컬럼 보호 또는 뷰).
2. **password_reset_requests INSERT (완전 비로그인)** — teacher/login.js:44.
3. **profiles INSERT (가입 직후)** — id=auth.uid 정책이면 통과. 단 가입이 이메일 확인 없이 즉시 세션 생성됨을 전제(코드상 signUp 직후 바로 insert 성공 → 확인됨).
4. **profiles SELECT (동급생 닉네임 중복확인)** — 가입 직후 같은 class_id 조회. 세션 있으므로 "같은 class_id 허용" 정책으로 통과.
5. **학생 랭킹** — ranking.js: 동급생 profiles + 그들의 submissions 조회. "같은 class_id" 정책 필요.

## 🚨 발견된 보안 이슈 (정책과 별개로 보완 필요)
- **`students-bulk.js` 권한 검증 전무 (심각).** accessToken을 받지 않고 `classId`만 신뢰. anon 키로 동작 → 누구나 임의 classId에 학생 계정 일괄 생성 가능. 게다가 anon 키라 profiles INSERT에 `auth.uid()`를 요구하는 RLS를 걸면 **이 라우트가 깨짐**. → service_role + accessToken 권한검증(같은 학급 담임/admin)으로 재작성 필요.
- **cron 라우트 시크릿 검증이 조건부.** `if (cronSecret && authHeader !== ...)` 형태라 **CRON_SECRET 미설정 시 검증을 건너뜀** → 외부에서 누구나 호출해 트래시 영구삭제 트리거 가능. → 시크릿 필수화 권장.
- **classes.api_key 평문 노출.** 학생 클라이언트가 본인 학급 classes 행을 통째로 읽어 api_key 취득(student/index.js:209). RLS로 학급 격리해도 같은 학급 학생에겐 키가 노출됨(현 구조의 한계). 최소한 **타 학급 차단**은 필수. 키 분리/서버 프록시는 별도 제안 사항.
- **service_role 비번/아이디 라우트 3종은 견고함** (reset-student-password, reset-teacher-password, update-student-username): accessToken→getUser→role·class_id 재검증 모두 수행. 양호.

## ❓ 정책 설계 전 확정 필요한 사실
- submissions에 `class_id` 컬럼이 실재하는지 (스키마 확인 필요). 없으면 정책은 `topic_id→topics.teacher_id` 또는 `user_id→profiles.class_id` 서브쿼리로 학급 격리해야 함 → 정책 복잡도·성능에 영향.
- profiles 정책에서 "같은 학급/담임" 판단 시 RLS 재귀(profiles가 profiles를 참조) 문제 → `SECURITY DEFINER` 헬퍼 함수 또는 auth.jwt() 클레임 활용 검토 필요.
