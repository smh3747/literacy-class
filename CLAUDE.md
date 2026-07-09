# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

초등학생(주로 5학년) 대상 AI 글쓰기 피드백 시스템. 선생님이 주제를 등록하면 학생이 글을 쓰고, Gemini API가 채점·피드백을 생성한다. 학급별로 완전히 분리 운영된다. UI 문구·주석·커밋 메시지는 모두 한국어다.

## 명령어

```bash
npm install
npm run dev      # 로컬 개발 (next dev)
npm run build    # 프로덕션 빌드
npm run start    # 빌드 후 서버 실행
```

- **테스트 프레임워크는 없다.** 검증은 `npm run build`(컴파일/타입 점검)와 실제 앱 수동 시연으로 한다.
- 린터 설정도 없다.
- `.env.local`을 `.env.local.example` 기반으로 만들어야 동작한다. 필요한 값: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ADMIN_SECRET_CODE`, `TEACHER_SECRET_CODE`.
- 배포는 Vercel. `next.config.js`의 `BUILD_ID`는 `VERCEL_GIT_COMMIT_SHA` 기반이며 버전 배너에 쓰인다.

## 기술 스택

Next.js 14 (Pages Router) · React 18 · Tailwind CSS · Supabase (Auth + Postgres) · Google Gemini API · Vercel Functions/Cron. 차트는 chart.js, 엑셀은 xlsx, PDF는 pdfjs-dist, QR은 qrcode.

## 아키텍처 핵심

### 사용자 역할과 인증
- 세 역할: **admin**, **teacher**, **student**. 역할은 `profiles.role`에 저장.
- **학생**은 Supabase Auth 이메일을 **가짜로 합성**한다. 로그인은 `username@writing.class` 형식 이메일로 `signInWithPassword`를 호출(`pages/student/login.js`). 즉 아이디·비밀번호로만 로그인하고 실제 이메일은 없다.
- **교사**는 step381 이후 **가입 시 실이메일을 받는다**(비밀번호 재설정 메일 수신용). 단 로그인은 여전히 아이디 기준: `pages/teacher/login.js`가 1차로 `username@writing.class` 합성 이메일을 시도하고, 실패하면 서버 폴백(`pages/api/teacher-login-fallback.js`)으로 실이메일을 해석해 재시도한다(이메일은 서버에서만 해석, 비노출). **기존 교사**(step381 이전 가입)는 실이메일이 없어 계정 복구 흐름으로 등록한다: 이메일 등록(`ProfileEditModal`)·아이디 찾기·재설정 쌍 검증(`pages/api/request-password-reset.js`, `pages/reset-password.js`). **원칙: 한 이메일=한 계정**(미래 소셜 로그인과 정합).
- admin/teacher 가입은 `pages/api/verify-code.js`가 서버 환경변수의 비밀 코드(`ADMIN_SECRET_CODE`/`TEACHER_SECRET_CODE`)를 검증해 통과시킨다.
- 학급 격리는 `classes.code`(4자리 가입 코드)로 이뤄진다. 학생은 이 코드로만 자기 학급에 가입 가능.

### AI 호출 경로 (프롬프트 IP 보호)
브라우저는 **프롬프트 본문을 절대 보지 못한다.** 호출 사슬:
```
클라이언트 → lib/aiClient.js (callAI: type+payload+apiKey만 전송)
          → pages/api/ai.js (서버에서 type에 맞는 프롬프트 구성)
          → lib/prompts.server.js (프롬프트 본문 — 서버 전용)
          → lib/gemini.js (callGeminiStructured: 모델 폴백 + 재시도)
          → Gemini API
```
- **`lib/prompts.server.js`는 절대 클라이언트(`pages/` 페이지, `components/`)에서 import하면 안 된다.** import하면 프롬프트가 브라우저 번들에 포함되어 F12로 노출된다. AI 작업은 반드시 `pages/api/ai.js`에 `type`을 추가하고 거기서 프롬프트를 부르는 식으로 확장한다.
- **Gemini API 키는 사용자(교사) 본인 것**이다. 학급별로 교사가 자기 키를 등록하고, 요청 본문으로 서버에 전달되어 호출에만 쓰인다(서버에 저장 안 함). 키 관리는 `components/ApiKeyManager.js`, localStorage 헬퍼는 `lib/gemini.js`의 `saveApiKey`/`loadApiKey`.
- 모델은 외부에 'AI'로만 표기한다 (IP 보호). 로그/화면에 모델명을 노출하지 말 것.

### Gemini 모델 폴백 (`lib/gemini.js`)
- 무료 한도(RPM/RPD)가 작아서 **작업 타입별 폴백 체인**(`MODEL_CHAINS`)으로 한도 소진 시 다음 모델로 넘어간다. `taskType`: `grading`(채점, 일관성 최우선) / `creative`(주제 추천) / `quality`(예시) / `simple`.
- 일일 한도(429 per-day) 도달 모델은 `localStorage`(`gemini_quota_hit_today`)에 기억해 그날은 건너뛴다.
- 폴백으로 다른 모델이 채점한 결과는 `is_fallback_graded=true`로 표시되어 나중에 재평가 가능 (`lib/regrade.js`).
- 모든 응답은 **Structured Output**(`responseSchema`, `SCHEMAS` in `lib/gemini.js`)으로 강제한다. 그래도 깨질 때를 대비해 `parseAIJson`이 잘린 JSON 복구를 시도한다.
- `lib/apiThrottle.js`는 클라이언트 측 분당 호출 한도(12 RPM) 완충. 단 같은 학급 다른 학생끼리는 협조하지 못한다(클라이언트 사이드 한계).
- 채점 후 `lib/koreanRules.js`가 정규식 기반으로 AI가 놓친 맞춤법/띄어쓰기 오류를 후처리로 보강한다.

### 임퍼소네이션 ("엿보기 모드")
관리자가 교사 화면을 **흔적 없이 읽기 전용**으로 들여다보는 기능. URL `?as=<teacher_uuid>`.
- `lib/impersonation.js`의 `getEffectiveProfile()`로 현재 동작 중인 프로필을 결정. admin이 아니면 `?as=`는 무시된다.
- **이중 방어로 모든 DB 쓰기를 차단**한다:
  1. `lib/supabase.js`가 `supabase` 클라이언트를 Proxy로 감싸 `?as=` 존재 시 `from().update/insert/delete/upsert`를 가로채 차단.
  2. 페이지 코드에서 쓰기 직전 `assertWritable()` 호출.
- 교사 페이지 간 내부 링크는 `withImpersonation(href)`로 `?as=`를 유지해야 한다.

### 데이터 모델 (Supabase)
주요 테이블: `classes`, `profiles`(학생·교사 공통), `topics`(글쓰기 주제 + 평가기준 rubric), `submissions`(학생 글 + AI 피드백). 파생 테이블: `topic_copies`(공유 주제 가져오기 출처), `notifications`(알림 센터, step348), `correction_alerts`(맞춤법 오교정 자동 감시, step359~362), `preorders`(수익화 사전 신청, step380). 스키마는 코드가 아니라 **`migrations/` SQL 파일들로 점진 정의**된다. 단 일부(notifications·correction_alerts·teacher_stamp·admin_class_stats RPC 등)는 마이그레이션 파일 없이 Supabase SQL Editor에서 직접 적용됐다 — 존재 여부는 각 step 커밋 메시지로 추적한다.
- 마이그레이션은 `stepNN-*.sql` 형식이며 **수동으로 Supabase SQL Editor에서 실행**한다 (자동 적용 안 됨). 대부분 `ADD COLUMN IF NOT EXISTS`로 멱등하게 작성되어 중복 실행해도 안전.
- **RLS는 아직 느슨하다** (`step144-rls-temp-defense.sql` 참고): SELECT는 전체 허용, 쓰기 계열만 로그인 필수. 비로그인 가입 흐름(학급코드·닉네임 중복 SELECT) 때문에 SELECT를 막지 못한 상태이며, 학급별 정밀 격리는 향후 작업으로 남아 있다. 보안 관련 변경 시 이 파일을 먼저 읽을 것.

### 페이지 구조
- `pages/student/*` — 글쓰기, 기록, 랭킹
- `pages/teacher/*` — 주제·학생·제출물 관리, 성장 그래프, 생기부 평어 생성, 휴지통 등
- `pages/admin/*` — 전체 관리
- `pages/api/*` — 서버 함수. `cron-*-trash-cleanup`은 `vercel.json`에 등록된 매일 크론(휴지통 자동 비우기).

## 코딩 시 주의점

- **캐시 무효화**: HTML 페이지는 `next.config.js`에서 `no-store`로 강제한다(태블릿/모바일 캐시 문제). 새 배포 감지는 `BUILD_ID` + `components/VersionChecker.js`.
- **시간 락 등 일부 검증은 클라이언트 측**이라 시스템 시간 조작으로 우회 가능 (`STEP12-DEPLOY-GUIDE.md` 참고). 보안이 중요한 검증은 서버/RLS로 옮겨야 한다.
- 학생은 5학년이다. 사용자 대면 문구·AI 피드백은 **반드시 존댓말, 쉬운 말, 격려 톤**. 프롬프트(`lib/prompts.server.js`)에 이 원칙이 명시되어 있으니 채점 관련 변경 시 따를 것.
- 커밋 메시지는 `stepNNN: 설명` 형식의 한국어를 따른다 (예: `step145: 학생 글 보기 ReferenceError 수정`).
- **문구·레이아웃 변경 시 로직 불변**: UI 문구·배치·구획만 바꾸는 작업에서는 기존 로직(동의 처리·실명 전환·QR·복사·검사 알고리즘·점수 등)을 절대 건드리지 않는다. 추가·재배치만.
- **공용 컴포넌트 수정 전 소비자 확인**: 여러 화면이 재사용하는 컴포넌트(ConsentPanel·GrayZonePanel·ConsentDocument 등)를 고치기 전, grep으로 다른 소비자를 확인하고 영향 범위를 점검한다. 한 곳만 보고 고치면 다른 화면이 깨진다.
- **`lib/koreanRules.js` 수정 시: 커밋 전 `node scripts/gate-korean-rules.js` 전체 PASS 필수.** (맞춤법 규칙 회귀 게이트. 규칙을 의도적으로 바꿔 케이스가 바뀌면 그 스크립트의 기대값도 같은 커밋에서 갱신.)
- **`lib/prompts.server.js` 수정 시: 커밋 전 `node scripts/gate-prompts.js` 전체 PASS 필수.** (프롬프트 회귀 스모크 게이트. CORRECTIONS_RULES 핵심 지시가 지워지지 않았는지 확인. 규칙 문구를 의도적으로 바꾸면 그 스크립트의 기대 문구도 같은 커밋에서 갱신.)
- **커밋 후 push까지**: 커밋만 하고 push를 빠뜨리지 않는다. 작업 완료 = 커밋 + push + origin/main 반영 확인까지. (배포는 GitHub push로 트리거되므로 push 안 하면 Vercel에 안 올라감.)
- **force-push 절대 금지(병렬 세션 공존)**: 맞춤법 세션 등 별도 Code가 같은 origin(GitHub)을 공유한다. `git push --force`/`--force-with-lease`는 상대 세션 커밋을 유실시킨다(실제 사고: step390이 밀렸다가 백업에서 복원). 항상 일반 `push`만, 커밋 전 `git pull --rebase` 먼저. 워킹디렉토리는 폴더로 분리해 운영한다.
- **작업 보고는 아래 "보고 규칙 (v2)" 섹션을 따른다.**
- **큰 작업·민감 영역은 plan mode 먼저**: 원인이 불확실하거나(버그 규명) 학생 PII·동의 데이터·복잡한 신규 기능은 구현 전에 plan mode로 분석·설계→승인→구현 순서로 간다.

## 보고 규칙 (v2)
모든 작업 완료 보고는 아래 순서를 지킨다.
1. 첫 줄: 커밋 해시 · push 여부(origin/main 반영 확인) · step 번호
2. 변경 요약: 무엇이 어떻게 됐는지. 요구사항 대비 제약·미충족이 있으면 숨기지 말고 명시
3. 안전장치: 지시문의 제약(접근 금지 파일·로직 불변·PII 등)을 지켰는지 항목별로
4. 확인할 것: 사용자가 눈으로 대조할 수 있게 기대값(숫자·건수·색·문구)을 구체적으로 명시.
   예: "탭에 (7) 표시" (X: "탭이 보이는지 확인")
5. 다음 순서: 남은 것 + 제안. 제안이 다른 세션 전담 파일(lib/koreanRules.js·lib/prompts.server.js)에
   걸치면 반드시 그 사실을 표기

### 커밋 보고 규칙 (필수)
- 모든 커밋 후 보고 첫 줄은 반드시: `커밋 해시 · push 여부(origin 반영 확인) · step 번호`
- 이 첫 줄이 없으면 작업 미완료로 간주한다.
- UI 변경 커밋은 verify-ui-change 스킬 수행 결과를 보고에 포함한다.

## 문구 작성 원칙
- **두괄식**: 안내·설명 문구는 핵심 결론을 첫 문장에 놓는다. 교사가 첫 줄만 읽어도 요점을 알게.
- **대시(—) 금지, 자연스러운 문장**: 대시(—)나 과한 콜론으로 문장을 잇지 않는다. 짧은 문장으로 끊어서 자연스럽게. AI가 쓴 티 안 나게, 실제 선생님이 말하듯.
- "~할 수 있어요" 남발·법조문 말투 금지. (기존 5학년 존댓말·쉬운 말 톤과 함께 적용.)
- 학생 대면 문구는 항상 존댓말(~해요체). '네/너' 반말 지칭 금지, 자기 것은 '내 ~'로.
