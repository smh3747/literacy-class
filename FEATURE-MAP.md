# FEATURE-MAP.md — 기능 지도 (협업자용)

> 목적: claude.ai 등 다른 협업자가 **이미 구현된 기능**을 빠르게 파악하기 위한 지도.
> 원칙: **추측 없음. 실제 코드(`pages/`, `components/`, `lib/`, `migrations/`) 기준으로만.**
> 스택: Next.js 14 (Pages Router) · React 18 · Tailwind · Supabase(Auth+Postgres) · Google Gemini API · Vercel. 차트 chart.js, 엑셀 xlsx, PDF pdfjs-dist, QR qrcode.
> 작성 시점 기준 최신 작업: step153(학급 API 키 서버 격리).

---

## 1. 역할별 기능 목록

### admin (`pages/admin/index.js` — 단일 대시보드, 탭 구조)
- **상단 통계 카드**: 선생님 수 / 학급 수 / 학생 수(미삭제 student) / 누적 글쓰기(submissions 총합) / 오늘 작성 수.
- **비밀번호 초기화 요청 알림**: `password_reset_requests` 중 `status='pending'` 표시 → 처리 시 선생님 비번 초기화 + 요청 완료 처리.
- **👥 선생님 탭**: 선생님 목록(차단 토글), 행 펼침 시 운영 학급·학생수·제출수·마지막 활동, 작업 버튼(🔑 비번 초기화 / 차단·해제 / admin 부여·해제 / 🗑️ 휴지통).
- **🏫 학급 탭**: 학급별 담임·학교·학생수·가입코드·**API 키 등록 여부(class_secrets 기준)**·채점 모델 분포·활성상태. 작업(엿보기=임퍼소네이션 / 활성·비활성 / 휴지통).
- **📝 학생 글 탭**: 그룹화(전체/학교별/학급별/주제별/학생별), 그룹별 제출수·평균점수·폴백채점수·복붙감지수, 학급 필터, 최근 200건.
- **💬 의견 탭**: 받은 의견(작성자 역할 배지+실명/학교/반), 숨김·복원(개별/일괄), **AI 분석 요약**(`callAI('feedbackSummary')` — 카테고리·우선순위·인사이트), 마크다운 복사.
- **📚 공유 추천 탭**: `topic_suggestion_logs` 로그(누가 무슨 주제를 공유/등록했는지, 선택 주제 상세).
- **🗑️ 휴지통 탭**: 삭제된 선생님/학급 목록, 남은 일수(D-N), 복원/영구삭제(확인문구 입력).
- 임퍼소네이션("엿보기"): admin이 교사 화면을 읽기전용으로 보기 (`?as=<uuid>`, `lib/impersonation.js`).

### teacher (`pages/teacher/*`)
- `teacher/index.js` — **대시보드**: 학급 카드(학급명·가입코드·학생/주제 수), 셋업 체크리스트(`SetupChecklist`), 학생 로그인 안내 카드(`StudentLoginInfoCard`, QR 포함), **API 키 관리**(`ApiKeyManager`), 오늘 AI 사용량 경고(300/450회 임계), 학급 설정(`ClassSettings`), 서브페이지 네비게이션.
- `teacher/topics.js` — **주제 관리 + AI**: AI 주제추천 3개 중 택1(`callAI('topicBatch')`)·개별 재추천, 기간 일괄 주제생성(주말 제외 옵션→미리보기→일괄등록), AI 평가기준 자동생성(`rubricGen`), AI 주제설명 생성(`topicDesc`), 단일 주제 등록/수정, 평가기준 수동편집, 글자수 제한(min/max), 최대 재수정 횟수, 시간 락, 제출기한, 추천 로그 조회·공유 토글.
- `teacher/submissions.js` — **제출물/채점 관리**: 주제별 학생 글 조회(제출/미제출), 단일·일괄 **AI 재평가**(`lib/regrade.js`, 이전 점수 백업), AI 점수·근거·종합·잘한점·발전점·개선예시 표시, 맞춤법 빨간 밑줄, **베껴쓰기 감지**(AI 예시와 유사도 30%/50% 경고), 담임 코멘트 작성, **일괄 격려 코멘트**(미코멘트 학생), AI 코멘트 추천(`commentSuggest`), Excel 다운로드, 학생 간 네비(←→/키보드), 휴지통 이동.
- `teacher/record.js` — **생기부 평어**: 학생별 작성 글 기반 평어 자동생성(`callAI('schoolRecord')`), 성취수준 자동판단(평균점수), 일괄 생성, 학생당 2~4개 평어 선택·복사, 저장 이력 복원(토큰 미사용), `school_records` 저장.
- `teacher/students.js` — **학생 관리**: 나이스 명렬표 엑셀/PDF 파싱 업로드(`/api/students-bulk`), 자동 아이디 생성, 아이디 prefix 일괄변경, 아이디/이름/번호 인라인 수정, 비번 초기화(개별/일괄), 학부모 동의 회신 체크, 학생 숨김(전출)/복원, 닉네임 부여·수정, 명단 Excel 다운로드.
- `teacher/status.js` — **제출 현황**: 주제별 제출/미제출 한눈, 제출률 바, 60%미만(도움 필요)·코멘트 미작성 자동 분류, 미제출 명단 클립보드 복사, 신고 표시.
- `teacher/student-growth.js` — **성장 그래프**(chart.js): 학급 평균 추이 꺾은선, 학생별 평균 비교 막대(순위), 개별 학생 성장 추이, 100점 환산.
- `teacher/grammar-backfill.js` — **맞춤법 일괄 보강**: 맞춤법 정보 없는 과거 글 선택 → `callAI('grammarOnly')` + `lib/koreanRules.js` 규칙 병합, 진행률·로그·취소, 한도 초과 시 재시도.
- `teacher/trash.js` — **휴지통**: 삭제 글 목록, 자동 영구삭제 기간 설정(7/30/60/90/180일), 남은 기간, 복원/영구삭제, 미리보기.
- `teacher/feedback-reports.js` — **피드백 신고함**: 학생이 신고한 AI 피드백 + 원문 검토, 확인 완료 처리.
- `teacher/parent-consent.js` — **학부모 동의서**: 인쇄용 A4 양식(수집정보·보관기간·Gemini 제3자 제공·서명란).
- `teacher/help.js` — **도움말/FAQ**: 7개 섹션 아코디언.
- `teacher/login.js` — 교사 로그인/가입(가입 시 `/api/verify-code`로 `TEACHER_SECRET_CODE` 검증, admin 중복확인).

### student (`pages/student/*`)
- `student/index.js` — **글쓰기 메인**: 단계 관리(write/feedback/done/rewrite), 글자수 min/max 검증, 시간 락(`lock_*`), 제출기한(`deadline_*`), **AI 채점**(`callAI('grading')` / 수정본 `rewriteGrading`), 점수·rubric_reasons·improve_examples 검증/캡, 맞춤법 규칙 보강, 모델 추적(`__usedModel`/fallback), **예시작품 생성**(`exampleEssay`), 중복 제출 방지(90% 동일 차단, `require_rewrite_change`), 수정횟수 제한(`max_rewrites`), 오늘 주제 여러 개, 지난 미제출 주제, 5초 자동백업(localStorage), 미확인 담임 코멘트 배너, 붙여넣기 감지, 맞춤법 빨간 밑줄(`lib/useGrammarTooltip.js`), **AI 글쓰기 도우미 챗봇**(`TutorChat`, 교사가 켰을 때).
- `student/history.js` — **내 기록**: 주제별 그룹화, 점수 추이 차트(chart.js), 첫 글·수정본 비교, 개선도(↑ 배지), 항목별 점수 바, 담임 코멘트 표시(읽음 처리), 발전점 예시, 맞춤법 목록, 예시작품(마지막 제출), 다시 쓰기 버튼.
- `student/ranking.js` — **랭킹**: 기간 필터(주/월/전체), 3종 랭킹(평균점수/제출횟수/향상도), 익명(nickname/번호), 내 순위 강조, 메달, `ranking_enabled` 비활성 처리.
- `student/login.js` — **로그인/가입**: 학급코드 가입(`/api/class-lookup`), 자동로그인/아이디 저장 옵션, `?code=`·`?mode=signup` 자동입력, 로그인 안내 동적로드, 가입 동의 필수, 아이디 잊기, 닉네임 자동생성.

### 공개 페이지
- `pages/index.js`(랜딩), `pages/api-key-guide.js`(Gemini 키 발급 안내), `pages/terms.js`(이용약관), `pages/privacy.js`(개인정보처리방침).

---

## 2. 데이터 모델 (Supabase)

> 출처: `migrations/stepNN-*.sql` + 코드의 `supabase.from('…')` 호출. 핵심 컬럼만.

### 기본 4테이블
- **profiles** (학생·교사·admin 공통): `id`(PK, Auth), `role`(student/teacher/admin), `username`(로그인 아이디), `realname`, `email`(학생은 가짜 `username@writing.class`), `class_id`(FK→classes, 학생/교사 소속), `nickname`(step23), `number`(step10), `consent_received`(step11), `is_hidden`/`hidden_reason`(step13), `is_banned`(교사 차단), `deleted_at`/`deleted_by`/`delete_reason`(step99).
- **classes** (학급): `id`(PK), `teacher_id`(FK→profiles 담임), `name`, `code`(가입코드), `school`, `is_active`, `grade`(step23), `ranking_enabled`/`board_scope`(step23), `lock_*`(step11), `login_hint_enabled`/`login_username_prefix`/`login_default_password`(step70), `trash_retention_days`(step78), `tutor_chat_enabled`(step124), `api_key`(step153에서 class_secrets로 이관 — **폴백용 동결**), `deleted_*`(step99).
- **topics** (주제+평가기준): `id`(PK), `teacher_id`(FK→profiles), `title`, `description`, `rubric`(JSONB), `date`, `min_length`(step38)/`max_length`(step60), `max_rewrites`(step38), `deadline_date`/`deadline_time`(step48), `lock_*`(step11), `require_rewrite_change`(step141).
- **submissions** (학생 글+AI 피드백): `id`(PK), `topic_id`(FK→topics), `user_id`(FK→profiles 학생), 본문 텍스트, `attempt`(제출 회차), `scores`(JSONB)/`total_score`/`max_score`, `feedback_overall`/`feedback_good`/`feedback_improve`, `rubric_reasons`(JSONB, step86), `improve_examples`(JSONB, step94), `graded_with_model`/`is_fallback_graded`(step83), 재평가 `re_graded_at`/`re_graded_by`/`previous_*`(step79), 신고 `reported`/`report_reason`(step11), 교사 `teacher_comment`/`teacher_comment_at`(step98)/`teacher_comment_read_at`(step113), `example_text`, `extra_rewrite_allowed`, 휴지통 `deleted_*`(step78).

### 부가 테이블
- **feedback** (의견/AI 피드백): `submission_id`(FK), `user_id`(FK→profiles, NULL=구버전/익명, step87), `content`, `is_hidden`/`hidden_at`(step46). → admin 의견함에서 사용.
- **class_secrets** (step153): `class_id`(PK, FK→classes 1:1), `api_key`, `updated_at`. RLS로 **소유 교사·admin만** 접근(학생 차단).
- **school_records** (step136): `student_id`(PK/UNIQUE, FK→profiles), `teacher_id`(FK), `sentences`(JSONB 평어), `level`, `standards`.
- **topic_suggestion_logs** (step92/96/108): `teacher_id`(FK), `class_id`(FK, nullable), `suggestions`(JSONB), `selected_index`, `resulting_topic_id`(FK→topics), `model_used`, `is_shared`/`shared_indexes`(공유).
- **tutor_chat_usage** (step124): `user_id`(FK→profiles), `used_date`, `count`, UNIQUE(user_id, used_date) — 학생 챗봇 일일 5회 제한.
- **password_reset_requests** (step119): `username`/`realname`/`school`/`contact`/`message`, `status`(pending/done), `handled_at`. FK 없음(비로그인 등록 허용).

### 관계 요약
```
profiles(teacher) 1─N classes 1─N topics 1─N submissions N─1 profiles(student)
classes 1─1 class_secrets
classes 1─N (profiles.class_id = 소속 학생/교사)
topics 1─1 topic_suggestion_logs.resulting_topic_id (nullable)
submissions 1─N feedback
profiles(student) 1─1 school_records ; 1─N tutor_chat_usage
```
주요 FK: `classes.teacher_id→profiles` · `profiles.class_id→classes` · `topics.teacher_id→profiles` · `submissions.topic_id→topics` · `submissions.user_id→profiles` · `class_secrets.class_id→classes` · `school_records.student_id/teacher_id→profiles` · `tutor_chat_usage.user_id→profiles`.

> 스키마는 `migrations/`로 점진 정의(수동 실행). RLS는 step146~153에서 학급별 정밀 격리 적용됨.

---

## 3. 이미 구현된 "교사 가치/시간절약" 기능

> AI 호출은 모두 `lib/aiClient.js`의 `callAI(type, …)` → `pages/api/ai.js`(서버 프록시) → `lib/prompts.server.js` 경유. 프롬프트는 서버 전용(IP 보호).

| 기능 | 위치 | callAI type | 절감 효과 |
|---|---|---|---|
| **AI 주제 추천**(3개 택1, 개별 재추천) | `teacher/topics.js` | `topicBatch`/`topicSingle` | 매일 주제 고민 → 버튼 클릭 |
| **기간 일괄 주제 생성** | `teacher/topics.js` | `topicBatch` | 1주일치 주제를 1회로 |
| **AI 평가기준 자동생성** | `teacher/topics.js` | `rubricGen` | 루브릭 설계 자동화 |
| **AI 주제 설명 생성** | `teacher/topics.js` | `topicDesc` | 설명문 자동 작성 |
| **생기부 평어 자동생성**(일괄, 2~4개 택1) | `teacher/record.js` | `schoolRecord` | 수십 명 평어 초안 일괄 |
| **AI 재평가**(단일/일괄, 이전점수 백업) | `teacher/submissions.js` + `lib/regrade.js` | `regrade`(+`rubricHint`) | 평가기준 변경 시 전체 재채점 |
| **AI 코멘트 추천**(교사 말투 학습) | `teacher/submissions.js` | `commentSuggest` | 코멘트 초안 자동 |
| **일괄 격려 코멘트** | `teacher/submissions.js` | (DB 일괄) | 미코멘트 학생 일괄 처리 |
| **맞춤법 일괄 보강** | `teacher/grammar-backfill.js` | `grammarOnly` | 과거 글 빨간 밑줄 복구 |
| **학생 일괄 등록**(나이스 엑셀/PDF) | `teacher/students.js` + `/api/students-bulk` | — | 아이디 자동생성 |
| **비밀번호 일괄 초기화** | `teacher/students.js` + `/api/reset-student-password` | — | 여러 학생 한 번에 |
| **베껴쓰기 감지** | `teacher/submissions.js` | — | AI 예시 유사도 자동 경고 |
| **학생용 AI 글쓰기 도우미**(질문 유도, 일일 5회) | `components/TutorChat.js` | `tutorChat` | 교사 1:1 지도 부담 경감 |

채점 핵심: 학생 제출 시 `callAI('grading')`로 점수·종합·잘한점·발전점·개선예시·맞춤법 자동 생성(`student/index.js`). 모델 폴백 체인·일일한도 회피·Structured Output은 `lib/gemini.js`.

---

## 4. 운영/관측 기능 (admin 대시보드)

`pages/admin/index.js` 한 화면에서 제공(코드에서 확인된 지표만):

**전체 집계 카드**: 선생님/학급/학생/누적 글쓰기/오늘 작성 수.

**학급별 지표** (`lines ~102-206`):
- `submission_count` — 학급 누적 제출 수.
- `last_activity_at` — 학급 마지막 제출 시각(최신 submissions.created_at).
- `student_count` — 학급 학생 수.
- `model_stats` — 학급별 채점 **모델 분포**(모델명→건수) + `fallback`(폴백 채점 수) + `total`.

**선생님별 지표**: 운영 학급 수·총 학생 수·총 제출 수 합계, **활동 최신성 라벨**("오늘 활동/어제 활동/N일 전" — 색상 구분).

**학생 글 탭 통계**: 그룹(학교/학급/주제/학생)별 제출수·평균점수·폴백수·복붙감지수.

### "학급별 활동 빈도 / 유지율(retention)" 화면 존재 여부 — **부분적으로만 있음**
- ✅ **있음**: 학급별 누적 제출 수(`submission_count`), 학급 **마지막 활동 시각**(`last_activity_at`), 선생님별 **최근 활동 라벨**(오늘/어제/N일 전). → "최근에 쓰는 학급 / 죽은 학급" 구분은 가능.
- ❌ **없음**: **시계열 제출 추이**(날짜별 그래프), **유지율/코호트(retention)** 지표, 주간 활성 학급(WAU) 같은 빈도 집계. submissions의 시계열을 admin에서 차트로 보여주는 화면은 코드에 **없음**. (학생 개인 점수 추이 차트는 `student/history.js`·`teacher/student-growth.js`에 있으나, 이는 "활동 빈도/유지율"이 아니라 점수 성장 그래프임.)

**기타 운영**: 휴지통 자동 영구삭제 크론 2종(`/api/cron-trash-cleanup` 학급별 글, `/api/cron-admin-trash-cleanup` 30일 경과 교사·학급, `vercel.json` 등록), 버전 감지(`/api/version` + `components/VersionChecker.js`), 비번 초기화 요청함.

---

## 5. 수익화 / 결제 관련 — **없음**

코드·의존성 전수 확인 결과 **결제·구독·플랜·과금·사용량 기반 청구 기능은 전혀 없음**:
- `package.json`에 결제 라이브러리 없음(stripe/paddle/iamport 등 전무 — 의존성은 supabase, @google/generative-ai, chart.js, pdfjs-dist, qrcode, xlsx뿐).
- "유료/결제/구독/플랜/billing/subscription/price" 전수 검색 결과 **앱 자체 과금 코드 없음**.
  - `pages/privacy.js:80`의 "유료 등급(Cloud Billing)"은 **교사가 쓰는 Google Gemini API 키의 등급** 설명일 뿐, 이 앱의 과금이 아님.
- 비용 구조: **Gemini API 키는 교사 본인 것**(학급별 등록, `class_secrets`). 앱은 키를 대신 호출만 하며 사용량 과금/제한/판매 로직 없음.
- 유일한 "사용량 제한"은 학생 챗봇 **일일 5회**(`tutor_chat_usage`)와 클라이언트 분당 호출 완충(`lib/apiThrottle.js`) — **수익화가 아니라 무료 API 한도 보호용**.

> 즉, 현재는 **완전 무료·교사 자비 API 키 모델**. 수익화를 붙이려면 결제/구독/플랜/사용량 측정 인프라를 신규로 설계해야 함(기존 코드 재활용분 없음).

---

## 부록: AI 호출 type 전체 목록 (`pages/api/ai.js`)
`grading`(채점) · `rewriteGrading`(수정본 채점) · `regrade`(재평가) · `rubricHint`(루브릭 힌트) · `topicBatch`/`topicSingle`(주제추천) · `rubricGen`(평가기준) · `topicDesc`(주제설명) · `exampleEssay`(예시작품) · `schoolRecord`(생기부 평어) · `commentSuggest`(코멘트 추천) · `grammarOnly`(맞춤법) · `feedbackSummary`(admin 의견요약) · `tutorChat`(학생 챗봇).
