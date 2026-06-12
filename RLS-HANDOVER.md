# RLS 보안 작업 인수인계서

> 대화 컨텍스트가 가득 차서 새 대화로 이어가기 위한 핸드오버 문서.
> 작성 시점: 2026-06-12. 작성 직전 마지막 커밋: `1e0ae2b` (step152), `origin/main`에 push 완료.

---

## 0. 한눈에 보는 현재 상태

- **RLS 정밀 격리 작업(step146~152)은 코드/마이그레이션 모두 완료·커밋·push 됨.**
- 설계 문서: `RLS-POLICY-PLAN.md` (0~8단계 전부 수행 완료).
- 작업 트리 **깨끗함**. 미커밋 변경 없음.
- 침투 테스트로 **핵심(비로그인 완전 차단) 라이브 검증 완료** → 테스트 스크립트는 계획대로 삭제함.
- **남은 건 코드 작업이 아니라 운영 설정 1건(Vercel 환경변수)과 선택적 추가 검증뿐.**

---

## 1. 프로젝트 맥락 (빠른 복습)

- 초등 5학년 대상 AI 글쓰기 피드백 시스템. Next.js 14 (Pages Router) + Supabase + Gemini API. Vercel 배포.
- 역할: admin / teacher / student. 학생·교사 모두 Supabase Auth(가짜 합성 이메일 `username@writing.class`).
- 마이그레이션은 `migrations/stepNN-*.sql`, **Supabase SQL Editor에서 수동 실행**(자동 적용 안 됨).
- 테스트 프레임워크 없음. 검증은 `npm run build` + 수동 시연.
- 모든 UI 문구·주석·커밋 메시지는 한국어. 커밋은 `stepNNN: 설명` 형식.

---

## 2. 완료된 RLS 작업 (step146~152)

### 적용된 마이그레이션 (라이브 Supabase DB에 실행 완료 확인됨)
| step | 테이블/대상 | 내용 |
|---|---|---|
| 146 | 헬퍼 함수 | SECURITY DEFINER 함수 5개: `is_admin`, `my_role`, `my_class_id`, `is_my_classmate(uuid)`, `my_class_teacher_id`. profiles 무한재귀 회피용. |
| 147 | submissions | 본인/같은 학급(랭킹)/담임/admin만. 비로그인·타학급 0행. **이 step이 라이브 적용 누락이던 것을 침투테스트로 발견→이번에 사용자가 직접 SQL Editor 실행→해결.** |
| 148 | profiles | 본인/같은 학급/admin. 동반 코드: 닉네임 중복확인 순서 변경, admin 중복확인 서버 이동(S4). |
| 149 | classes | api_key 익명 노출 차단. 신규 `/api/class-lookup`(안전 컬럼만 반환, S3). |
| 150 | topics | 소유교사/내 학급 담임 주제/admin. |
| 151 | feedback | INSERT 전원·SELECT/UPDATE admin. `user_id` 컬럼 추가 + 의견보내기 버그 수정. |

각 step마다 `stepNN-rollback.sql` 롤백 파일 있음.

### step152 — 서버 코드 보강 (이번 세션 작업, 커밋 `1e0ae2b`)
- **S1 `pages/api/students-bulk.js`**: 권한 검증 전무였음 → `accessToken` 받아 `getUser`로 검증, 담임/admin만 허용. 계정 생성을 anon `signUp` → service_role `admin.createUser({email_confirm:true})`로 전환. 호출부 `pages/teacher/students.js`에 `session.access_token` 전달 추가.
- **S2 `pages/api/cron-trash-cleanup.js`, `cron-admin-trash-cleanup.js`**: `if (cronSecret && ...)`(미설정 시 무검증 통과) → `if (!cronSecret) return 500` 으로 **필수화**.
- `.env.local.example`에 `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` 항목 문서화.
- `npm run build` 통과.

---

## 3. 침투 테스트 결과 (검증 후 스크립트 삭제됨)

`scripts/rls-pentest.mjs`로 라이브 anon 키 검증 후 삭제. 최종 결과 PASS 5 / FAIL 0 / SKIP 4.

**검증 완료:**
- 비로그인 SELECT → submissions·profiles·classes·topics 전부 **0행** (핵심 목표 달성).
- 비로그인 `password_reset_requests` INSERT → 성공 (유일하게 허용돼야 하는 익명 쓰기, 정상).

**미실행(SKIP) — 환경 필요:**
- 3~6번 (학생/교사 타학급 권한 경계): 서로 다른 두 학급의 테스트 계정 자격증명 필요.
- 7~8번 (students-bulk 무토큰 401, cron 무시크릿 거부): 로컬 서버(`npm run dev`) + `.env.local` 필요.
- 코드·정책상으로는 보장되나 라이브로는 미검증. 핵심인 익명 차단이 입증돼 종료함.

---

## 4. ⚠️ 남은 할 일 (운영 — 코드 아님)

### 필수: Vercel 환경변수 등록
step152로 cron이 `CRON_SECRET` 필수가 됐다. **등록 안 하면 휴지통 자동 비우기 cron이 매번 500으로 거부되어 동작 안 함.**
Vercel 대시보드 → 프로젝트 → Settings → Environment Variables 에 등록:
- `CRON_SECRET` = 임의의 긴 무작위 문자열 (변수명이 정확히 `CRON_SECRET`이어야 Vercel이 cron 호출 시 `Authorization: Bearer <값>` 헤더를 자동으로 붙임)
- `SUPABASE_SERVICE_ROLE_KEY` = Supabase service_role 키 (cron·students-bulk가 사용. 없으면 그다음 줄에서 500)

cron 설정(`vercel.json`): `/api/cron-trash-cleanup` 매일 UTC 18:00, `/api/cron-admin-trash-cleanup` 매일 UTC 18:30 (= 한국시간 익일 03:00 / 03:30).

### 선택: 추가 침투 검증 (원하면 재작성)
- 로컬 검증하려면 `.env.local` 생성(`.env.local.example` 기반) 후 `npm run dev`로 서버 띄우고 7·8번 확인.
- 3~6번은 두 학급 학생/교사 테스트 계정 자격증명을 환경변수로 주면 검증 가능. (4번은 거부되지만 실제 UPDATE 쿼리를 던지므로 운영 데이터 주의.)

---

## 5. 별도 제안 (이번 범위 밖, `RLS-POLICY-PLAN.md` 6번)

- **api_key를 classes에서 분리**: `class_secrets` 테이블(교사+admin만 SELECT) + `/api/ai`가 서버에서 학급 키 조회 → 학생에게 키 자체가 안 보이게. 현재는 같은 학급 학생에게 api_key가 보이는 한계 수용 중.
- **랭킹 집계 RPC**: 같은 학급 submissions 행 전체 노출 대신 점수 집계만 반환하는 security definer 함수 → 친구 글 본문 비노출.
- **password_reset_requests INSERT rate limit** (Turnstile 등) — 익명 쓰기라 스팸 가능.

---

## 6. 새 대화 시작 시 첫 메시지 예시

> "literacy-class RLS 작업 이어서 할게. `RLS-HANDOVER.md`랑 `RLS-POLICY-PLAN.md` 읽고 현재 상태 파악해줘. 그다음 [원하는 작업]."

가능한 다음 작업: Vercel 환경변수 등록 확인 / 7·8번 추가 침투 검증 / 5번 별도 제안 중 하나 착수 / 이 핸드오버 파일 정리.
