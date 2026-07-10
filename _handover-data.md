# 핸드오버 데이터 (HEAD = 38f8207 (step421))

> 살아있는 마스터 인수인계서. 파일명 `_handover-data.md` 유지.
> ⚠️ 이 문서는 요약이다. 커밋 단위 상세는 항상 `git log`로 교차검증할 것(문서가 뒤처질 수 있음).

## 0. 작업/보고 폼 (★ 항상 이렇게 — 퍼니훈님이 좋다고 확정한 방식)
**Code 작업 결과를 받으면 이 순서로 보고 (v2 — CLAUDE.md "보고 규칙 (v2)"와 동일):**
1. 첫 줄: 커밋 해시 · push 여부(origin/main 반영 확인) · step 번호
2. 변경 요약: 무엇이 어떻게 됐는지. 요구사항 대비 제약·미충족이 있으면 숨기지 말고 명시
3. 안전장치: 지시문의 제약(접근 금지 파일·로직 불변·PII 등)을 지켰는지 항목별로
4. 확인할 것: 사용자가 눈으로 대조할 수 있게 기대값(숫자·건수·색·문구)을 구체적으로 명시. 예: "탭에 (7) 표시" (X: "탭이 보이는지 확인")
5. 다음 순서: 남은 것 + 제안. 제안이 다른 세션 전담 파일(lib/koreanRules.js·lib/prompts.server.js)에 걸치면 반드시 그 사실을 표기

**작업 지시(Code 지시문) 전에는:**
- 추측 금지. 코드/데이터(스냅샷·grep·SELECT) 먼저 확인하고 지시.
- 지시문에 안전 제약을 명시적으로 박기(불변 대상, PII 보호, 가드 유지 등).
- 큰 작업·민감 영역은 plan mode 먼저(분석→승인→구현).
- 커밋 지시 시 반드시 "커밋하고 push까지" 명시 — Code가 push 빠뜨리는 경우 있음(step299에서 실제 발생).
- 배포 확인은 Vercel 대시보드에서 커밋 해시 Ready 직접 확인(`/api/version`은 stale, Code는 Vercel CLI 없음).

**소통 톤:** 결정·지시·결론은 짧고 직설. 원인 분석·설계 설명은 쉽고 자세하게(구조·예시). 존댓말·비서 포지션.
> 스냅샷 4개(`_snapshot/SNAPSHOT-{pages,components,lib,migrations}.md`)는 `node scripts/make-snapshot.js`로 최신화(로컬 산출물, step356에서 추적 제거).

## 1. 현재 HEAD
> ⚠️ **문체 오교정 방어 변천 요약(step393~409)**: 프롬프트 규칙 11(예방)과 koreanRules `isStyleChange`(fail-safe 차단+기록)의 왕복이 있었다. **현재 상태 = 규칙 11은 step403판(4원인 차단)이 단독 전담. isStyleChange 필터는 step409에서 최종 제거됨(함수 자체 없음).** 데이터 분석 결과 필터가 옳은 문체 통일 지적("모여 있다→모여 있어요")과 맞춤법 교정("해결했습다→해결했습니다")까지 오차단해 폐기. 아래 개별 항목은 이력이므로 최신 결론만 볼 거면 이 줄과 §7·§13을 보라.
- `c329053` — **step409: isStyleChange 필터 최종 제거(`lib/koreanRules.js` 단일).** correction_alerts 분석상 이 필터가 옳은 문체 통일 지적("모여 있다→모여 있어요")과 맞춤법 교정("해결했습다→해결했습니다", 글자 빠짐)까지 오차단해 함수·필터체인·주석을 전부 제거(23줄 삭제). 이후 문체 판단은 프롬프트 규칙 11(step403) 단독. 유지 필터: 안않오교정·불가능형태·무의미. **필터 왕복 종결(393신설→400제거→401복원→409최종제거).**
- `5fcf782` — **step408: 알림 종 개선(병렬 세션).** 개별 x 소프트 삭제(dismissed_at) + 타입 아이콘·여백 가독성.
- `1bdfc74` — **step407: 차단 교정 발췌 맥락 확대(`pages/api/ai.js` 단일, 메인 세션 영역이나 이 세션이 커밋).** `buildEssayExcerpt` 발췌를 original 앞뒤 40→100자, 못 찾으면 앞 100→200자, 상한 300→500자로. 관리자 의심 교정 탭 차단 기록(submission_id 없음)의 맥락을 문장 2~3개 담기게. buildEssayExcerpt 외 불변. ※step407 해시 2개(병렬 브리핑 `c511e7d`와 이 커밋 `1bdfc74`).
- `c511e7d` — **step407: 브리핑 프롬프트 강화(병렬 세션).** 지난 주제 소재 배제, 범용 글쓰기 기술 안내로.
- `b3b6887` — **step406: 브리핑 알림 문구 2층 구조(병렬 세션).** 교사용 문맥 + 학생 지도 문장(weakness/student_line).
- `d8f7a6f` — **step405: 안/않 과차단 수정(`lib/koreanRules.js` 단일).** `isInvalidAnhToAn`에 조기 가드 `if (/안\s[가-힣][가-힣]/.test(correction)) return false` 추가 — 부정부사 '안'+공백+2글자 용언("안 지나"·"안 고파")은 정당 교정으로 검사(1)(2) 모두 제외(호평초 6-5 이산 학생 실사례). "안 아"(1글자 어미)는 계속 차단. **알려진 잔여 누수 "안 아서"(2글자)는 감수** — 실전에 거의 없고 correction_alerts 감시로 사후 대응. 다른 함수·필터 불변.
- `43cb273` — **step403: 문체 오교정 4원인 차단 — 규칙 11 재교체(`lib/prompts.server.js` 단일).** 의심 교정 8건 분석 4원인 차단: ①일관된 글 다수결 판정(문체 교정 금지) ②표현 다듬기 금지 ③마침표 없는 문장중간을 문장끝으로 단정 금지 ④내용 단어 교체 금지. 규칙 1~10 불변, 세 프롬프트 공유.
- `f4367b2` — **step402: 교사 아침 브리핑 종 알림(병렬 세션).** briefing AI type·홈 lazy 생성·주제당 1회 캐시. `lib/briefingPrompt.server.js`(신설)·`migrations/step402-morning-briefing.sql`·`pages/api/ai.js`·`pages/teacher/index.js`. (방학 본공사 '교사 아침 브리핑' 1차 착수)
- `1c8c857` — **step401: 문체개입 필터(isStyleChange) 복원(`lib/koreanRules.js` 단일).** step400에서 제거했으나, 이 필터가 문체 오교정을 (1)학생에 안 나가게 막고 (2)dropped에 '문체개입'으로 실어 correction_alerts 분석 재료로 남기므로 되살림. **→ step409에서 최종 제거됨(현재 없음).**
- `d86ab1e` — **step400: 문체개입 필터(isStyleChange) 제거(`lib/koreanRules.js`).** 규칙 11(step397)이 "섞였을 때만"으로 바뀌자 문장 하나만 보는 필터가 정당한 통일 지적까지 버려 제거했음. **→ step401 복원됐다가 step409 최종 제거(현재 없음).**
- `9123bd9` — **step399: 관리자 의심 교정 탭에 차단 기록 학생·맥락 표시(`pages/admin/index.js` 단일).** `blocked_user_id`→profiles 배치 조인으로 학생 정보, `blocked_essay_excerpt`를 맥락에 표시. displayStudentName(미동의=닉네임). '글 보기'는 submission_id 있을 때만.
- `1ded9e2` — **step398: C-2 차단 기록에 학생·글 맥락 저장(`pages/api/ai.js` 단일).** `logDroppedCorrections`가 요청자 user_id + 원문 발췌를 correction_alerts에 저장. ⚠️**correction_alerts에 `blocked_user_id uuid`·`blocked_essay_excerpt text` 2컬럼 Supabase 수동 추가**(마이그레이션 파일 없음).
- `11cc58b` — **step397: 문체 지적 정책 "전면 금지"→"섞였을 때만 통일"(규칙 11).** → step403에서 재교체됨(이력).
- `813d0b9` — **step396: 핸드오버 step395 기준 최신화(문서만).**
- `be59ae0` — **step395: 문체개입 오교정 억제 — CORRECTIONS_RULES 규칙 11 강화(`lib/prompts.server.js` 단일).** 규칙 11을 더 단호·구체적으로 교체(❌ 예시 + "correction의 original과 correction은 종결어미(말투)가 서로 같아야"). 상수 하나라 세 프롬프트(grading·grammarStrict·grammarOnly) 자동 반영. 규칙 1~10 불변. step393 필터(fail-safe)와 이중 차단.
- `731b701` — **step394: 오른쪽 추천 패널에도 인기순 정렬+🔥 인기 배지(다른 선생님 탭).** 병렬 세션 작업. `components/SuggestionLogPanel.js`·`pages/teacher/topics.js`.
- `f1dfd94` — **step393: 문체개입(반말→존댓말) 오교정 fail-safe 필터(`lib/koreanRules.js` 단일).** `isStyleChange` 신설 + mergeCorrectionsDetailed 필터 체인 연결(drop_reason `문체개입`). 반말 종결(-다 등) 원문을 존댓말(-습니다/-어요)로 바꾸는 교정을 확정 폐기. 어미 형태 안 바뀌면(됬다→됐다) 안 걸림, 원문이 이미 존댓말이면 제외. "안 기" fail-safe와 동일 전략.
- `94a1a53` — **step392: 핸드오버 step391 기준 최신화(문서만).**
- `da06538` — **step391: 인기 주제 모달·헤더 버튼 제거, '다른 선생님' 탭 상위 3개만 인기 배지. 최종 형태.** 한 주제를 2명 이상 가져갔을 때만(`item.isPopular = i<3 && n>=2`) 🔥 인기 배지. 정렬(인기순)·`copyCounts` 로드는 유지. (`teacher/topics.js` 단일)
- `73ffe86` — **step390: 인기 주제 배지+인기순 정렬+인기 주제 모달(주제 관리) 도입.** `topic_copy_counts` RPC 로드 + `buildSharedFlat` 헬퍼. ※**병렬 세션의 origin 재작성으로 한 번 유실됐다가 백업 커밋 `8c68a50`에서 topics.js 복원함.** (step391에서 모달·버튼은 제거됨)
- `88ee9e6` — **step389: 의존명사 '것/거' 앞 띄어쓰기 규칙(맞춤법 세션, `lib/koreanRules.js`).** ⚠️**해시 매핑 주의(revert 사고 방지): `d12cb57`=것/거 원본, `88ee9e6`=것/거 재작성본(현 origin/main 조상). 인기 주제 최종=`da06538`.**
- `8a76969` — **step388: 핸드오버·CLAUDE.md step387 기준 최신화(문서만).**
- `5665526` — **step387: 영구 삭제 반쪽 버그 수정(auth 잔존)·admin 이메일 등록·중복 안내.** 교사 영구 삭제 시 profiles만 지우고 Supabase Auth 계정이 남던 반쪽 버그 수정(`pages/api/admin-purge-teacher.js` 신설, auth.admin.deleteUser 호출). admin이 교사 이메일 등록 + 중복 이메일 안내. 변경: `admin-purge-teacher.js`(신설)·`admin/index.js`·`cron-admin-trash-cleanup.js`·`teacher-update-email.js`·`ProfileEditModal.js`.
- `9dd3a54` — **step386: 기존 교사 계정 복구 3종.** ①이메일 등록(ProfileEditModal) ②아이디 찾기(teacher/login) ③재설정 쌍 검증(username↔email 짝 맞을 때만 재설정 메일). 변경: `ProfileEditModal.js`·`request-password-reset.js`(신설)·`teacher-update-email.js`(신설)·`reset-password.js`·`teacher/index.js`·`teacher/login.js`.
- `e3d8cf7` — **step385: 주제 수정 목록 진입 + 제출물 있는 주제 제목/루브릭 잠금**(`teacher/topics.js` 단일). 제출물 존재 시 제목·루브릭 편집 잠금(채점 일관성 보호). ※해시 주의: step384=f1a7a71, step385=e3d8cf7 (이전 핸드오버에서 뒤바꿔 기록했던 것 정정).
- `f1a7a71` — **step384: 가입 이메일 검증 우회 수정(앵커드 검증기)·도메인 선택 UI·서버 방어선.** `lib/email.js` 앵커드 정규식 + `teacher-username-check.js` 서버 검증 + `teacher/login.js` 도메인 선택 UI.
- `73616cd` — **step383: 교사 가입 폼 제출 불가 수정(DOM 실제값 검증)·비밀번호 확인·필드별 실시간 안내**(`teacher/login.js` 단일).
- `fe067b4` — **step382: 사전 신청 2차 — 가격 제거 + 2버튼 응답(관심 있어요/아직 잘 모르겠어요) + 관리자 명단.** `preorders.response` 컬럼('interested'/'not_sure') 추가. 변경: `migrations/step382-preorders-response.sql`·`admin/index.js`·`teacher/index.js`.
- `86e7352` — **step380: 파운딩 멤버 사전 신청(preorders 테이블·교사 카드·관리자 카운트).** 결제 아님, 관심 등록만. `migrations/step380-preorders.sql`·`admin/index.js`·`teacher/index.js`.
- `006afa4` — **step381: 교사 비밀번호 이메일 재설정(신규 가입 실이메일 전환·재설정 페이지).** `reset-password.js`(신설)·`teacher-login-fallback.js`(신설)·`teacher-username-check.js`(신설)·`teacher/login.js`.
- (step379는 결번. step378은 두 커밋 `3fb84b2`·`bf4af8b`.)
- **⚠️ step308~378 상세는 이 문서에 개별 나열하지 않는다. `git log` 참조.** 그 구간의 큰 흐름은 아래 §12·§13에 주제별로 정리. 주요 완료 트랙:
  - **맞춤법 파이프라인** (§7·§13): A 서버 이전(step350) · C 오교정 자동 감시(step359~362) · 안/않 차단망(step327·373·375·378).
  - **알림 센터** 1차(step348, 교사·관리자) · 2차(step358, 학생 도장·코멘트).
  - **성장 그래프** 3단 재설계 + 학년 맥락 보정(step342~346).
  - **학생 화면** 재설계(step363~377): 피드백 결과 재배치·채점 완료 스크롤·다시쓰기 체크리스트·맞춤법 퀴즈 1차(step361).

## 2. lib/koreanRules.js — 함수 역할 + 줄 위치 (step409 기준 재확인)
| 함수 | 줄 | 역할(1줄) |
|---|---|---|
| `findRuleBasedErrors(text)` | `:10` | 정규식으로 AI가 놓친 맞춤법/띄어쓰기 보강 생성(문장부호 뒤 띄어쓰기, 할수있다, 안/않, 되/돼, ㄹ께요, 번째, 입니다/습니다, 조사 '의', 되다/시키다/하다 접미사, 였다·이였다, COMMON_TYPOS 등). |
| `isAndaVerbCorrection(o,c)` | `:429` | '안다' 활용형(안아·안고·안으며) 화이트리스트 — 안/않 차단망 과차단 방지(step378). |
| `isInvalidAnhToAn(o,c)` | `:450` | "맞는 '않'을 '안'으로 바꾸는" 오교정 판정(내부 가드). step405 조기 가드: '안'+공백+2글자 용언("안 지나")은 정당 교정으로 통과. |
| `isImpossibleCorrection(c)` | `:493` | 불가능 형태 교정 fail-safe 필터('안 '+어미 등, step327). |
| `dropAnhFalsePositives(corr)` | `:502` | mergeCorrections 안 타는 경로용 — 안/않 오교정 + 불가능형태 필터. |
| `findOriginalRange(essay, original)` | `:513` | original을 본문에서 찾되 공백 무시 매칭→실제 구간 인덱스 환산. `{start,end,exact,ambiguous}` 또는 `null`. |
| `snapOriginalToEssay(c, essay)` | `:546` | AI correction의 original을 공백무시로 **유일하게** 찾힐 때만 본문 실제 문자열로 스냅. |
| `mergeCorrectionsDetailed(aiCorr, essay)` | `:561` | **본체(step360 신설).** 병합 + **폐기된 항목까지 `{corrections, dropped}`로 반환**. dropped는 correction_alerts 기록(작업 C-2, step362)에 쓰임. drop_reason: 안않오교정·불가능형태(문체개입은 step409에서 필터 제거로 사라짐). |
| `mergeCorrections(aiCorr, essay)` | `:620` | 얇은 래퍼 — `mergeCorrectionsDetailed(...).corrections`만 반환(동작 불변). |

- **무의미 교정 필터(step273)** + **불가능형태 필터(step327)**가 mergeCorrectionsDetailed 안에 통합. (문체개입 필터 isStyleChange는 step393 신설→409 최종 제거되어 없음.)

## 3. mergeCorrections 실행 위치 — ★서버로 이전됨(step350)
- **병합은 서버에서 1회만 수행**: `pages/api/ai.js:278` `mergeCorrectionsDetailed(...)` (import `:18`). corrections 생성 type(grading·rewriteGrading·regrade·grammarOnly·grammarStrict) 응답 반환 직전.
- **클라이언트 호출 6곳 제거됨**(student/index.js·grammar-backfill·submissions.js 등). 이제 클라는 서버가 병합한 결과를 그대로 받음.
- **`lib/regrade.js`**: 더 이상 mergeCorrections 호출 안 함. `:125` `corrections: Array.isArray(result.corrections) ? result.corrections : []` — 서버에서 이미 병합된 값 그대로 저장(`:7` 주석에 명시). 재평가도 서버 경유(ai.js)라 규칙 일관.
- 멱등성 검증 완료(두 번 돌려도 동일) → 배포 순간 옛 클라 겹침 안전.

## 4. lib/notices.js — 상수 2개 (step274)
```js
export const GRAMMAR_NOTICE_STUDENT =
  '✏️ 맞춤법 표시는 AI가 도와주는 거예요. 가끔 놓치거나 잘못 짚을 수 있으니 참고만 하고, 헷갈리면 선생님께 물어봐요.'

export const GRAMMAR_NOTICE_TEACHER =
  '맞춤법·띄어쓰기 표시는 AI가 도와드린 거예요. 완벽하진 않아 가끔 놓치기도 하니, 마지막엔 선생님께서 한 번 봐주시면 좋아요. 결과가 아쉬우면 아래에서 다시 검사할 수 있어요.'
```

## 5. migrations — 최신 파일(스텝번호 기준)
| 파일 | 한 줄 설명 |
|---|---|
| `step402-morning-briefing.sql` | 교사 아침 브리핑 저장(step402, 병렬 세션 신설). |
| `step382-preorders-response.sql` (+`-rollback`) | 사전 신청 응답 구분 `response text`('interested'/'not_sure', default interested). RLS 불변. |
| `step380-preorders.sql` (+`-rollback`) | 파운딩 멤버 사전 신청 `preorders`(teacher_id unique·created_at) + RLS(po_select 본인/admin, po_insert 본인 teacher). update/delete 정책 없음=차단. |
| `step272-topic-copies.sql` | 공유 주제 가져오기 출처 기록(topic_copies + RLS + topic_copy_counts() RPC). |
- **⚠️ DB 객체는 Supabase SQL Editor에서 수동 실행**(자동 적용 아님). 대부분 `IF NOT EXISTS`로 멱등.
- **마이그레이션 파일 없이 Supabase 수동 적용된 것**: 알림 센터(`notifications` 테이블·RLS·`create_notification` RPC, step348) / 오교정 감시(`correction_alerts` 테이블·pg_cron 일일 스캔, step359~362, submission_id nullable; **step398에서 `blocked_user_id uuid`·`blocked_essay_excerpt text` 2컬럼 수동 추가**) / 담임 확인 도장(`teacher_stamp`, step323) / 관리자 통계 RPC(`admin_class_stats`, step333). → 스키마는 코드 커밋이 아니라 각 step 커밋 메시지 + 실제 Supabase에 존재.

## 6. topic_copies (step272, step326 원저자 로그 연결)
- **컬럼**: `id` · `source_log_id`(→topic_suggestion_logs) · `source_index`(int) · `copied_by_teacher_id`(→profiles) · `copied_topic_id`(→topics, nullable) · `copied_at`. **UNIQUE(source_log_id, source_index, copied_by_teacher_id)**.
- **RLS**: `tc_insert_own`(본인) · `tc_select_own_or_admin`(본인+admin). **집계 RPC**: `topic_copy_counts()`(SECURITY DEFINER, `(source_log_id, source_index)`별 `COUNT(DISTINCT copied_by_teacher_id)`).
- **INSERT**: `pages/teacher/topics.js` 신규 topic 등록 성공 블록. step326에서 `resolve_origin_log` RPC로 **원저자 로그** 기준 기록(실패 시 직전 logId 폴백).
- ⚠️ **"공유 가져오기 버튼"으로 온 것만 잡힘**(직접 눈으로 보고 입력한 복사는 미기록). admin 조회 뷰=step307 "🔗 주제 공유 추적" 탭.

## 7. grammar 모델 체인 / grammarStrict
- 정의: `lib/gemini.js` `grammar` 체인(채점 메인과 다른 모델 우선).
- 라우팅: `pages/api/ai.js` `grammarOnly` → `taskType 'grammar'`.
- **grammarStrict**(step299 신설): 정식 채점과 동일 품질(taskType 'grading'·temp 0·같은 모델). CORRECTIONS_RULES 단일 소스에서 프롬프트 추출.
- **현재 사용처**: 전체일괄(`runGrammarBatch`·grammar-backfill)은 grammarOnly, 단일 재검사(recheckGrammarOne)는 grammarStrict. step331에서 grammarOnly도 CORRECTIONS_RULES로 통일.
- **CORRECTIONS_RULES 규칙 11(현재 step403판):** 문체 오교정 4원인 차단 — ①일관된 글은 문장 끝맺음 다수결로 판정해 문체 교정 금지 ②표현 다듬기(있어서→있기 때문에 등) 금지 ③마침표 없는 문장중간을 문장끝으로 단정 금지 ④내용 단어 교체(사건 해결이다→사건들입니다) 금지. **변천: step395 강화 → step397 "섞였을 때만 통일" → step403 4원인 차단.** 상수 단일 소스라 세 프롬프트 자동 반영. **문체 판단은 이제 이 규칙 11(프롬프트, 예방)이 단독 전담.** `koreanRules`의 fail-safe 필터 `isStyleChange`는 step409에서 최종 제거됨(옳은 통일 지적·맞춤법까지 오차단한 데이터 확인). 틀린 문체 교정은 여전히 프롬프트에서 예방하고, cron 감시(correction_alerts)로 다른 유형 오교정을 계속 수집.

## 8~9. 재평가 배너 / 학생 안내 (변경 없음, git log step273·274 참조)
- 교사 `submissions.js`: 맞춤법 배지 뒤 amber 배너 + "🔄 다시 평가하기"(regradeOne). 학생: `GRAMMAR_NOTICE_STUDENT`.

## 10. 제품 존재이유
- 아침 주제글쓰기 검사에 교사가 **50분~1시간** 소요 → 피드백 위축·형식화. 이를 막아 **'내실 있는 피드백 + 교사 편의'** 둘 다 확보하는 것이 뿌리. 수익화(교사 B2B)는 그 위에 얹은 비즈니스 모델.

## 11. 확정 사실
- **폴백 채점은 거의 일어나지 않음**(무료 한도 충분). 채점 누락·점수 변동은 폴백이 아니라 **AI 자체의 변동성**.
- 그 변동성은 `koreanRules` 규칙으로 **'모양이 일정한 패턴'만** 보강 가능. **임의 띄어쓰기(의미 기반)는 규칙 불가** — AI 담당.
- **A2(topic_copies 인기 배지)**: 2026-07-01 데이터 기준 원본 주제 11개가 각 1번씩만 복사(인기 주제 0개)라 대기였음 → 아래 §13에서 재점화(§다음 작업).

## 12. 확정된 설계 결정 (2026-07-06 세션)
1. **한 이메일 = 한 계정 유지.** 여러 아이디를 한 이메일에 허용하자는 안은 **기각**. 이유: 미래 소셜 로그인(구글·카카오·네이버)과 정합. 교사 인증 정비(step381·383~387)는 이 원칙 위에서 설계됨.
2. **인디스쿨 홍보글 보류.** 개학 직전 2탄으로 재검토. 1번(경험담형) 초안은 보관.
3. **사전 신청 가격은 방학 중 확정**해서 관심 등록자에게 첫 공개. 그래서 step382에서 카드의 가격 표기를 제거하고 2버튼(관심 있어요/아직 잘 모르겠어요)으로 전환.
4. **재설정 메일 실왕복 6단계 실물 검증 완료**(step386 계정 복구 흐름). 교사 인증 정비는 시연으로 확인됨.

## 13. 백로그 (다음 할 일 — 항상 여기만 보면 됨)
> ⚠️ 매 작업 세션 종료 시 이 §13을 갱신할 것(끝낸 항목 '종료'로 이동, 새 할 일 추가).

**[★다음 작업 — 새 대화 1순위]** (2026-07-10 오후 갱신)
- **답장 모니터링(상시)**: 일괄 발송 249명 답장 대응. 현재 사이클 실적: 답장 3건(정윤정·김민구·조옥희)
  → 개선 6건(점수조정·작업B·날짜주입·모델교체·챗봇품질·규칙12) → 완료 쪽지 3통 발송(사이클 닫힘).
- **성적표 관찰(며칠 뒤)**: 관리자 의심 교정 탭에서 '점수역전' 건수(작업 B 실효성)·핑퐁 오교정
  재발 여부(규칙 12 실효성) 확인. 재발 시 spell 제안 = koreanRules 코드 레벨 필터(조사 떼기·%띄우기
  폐기) 검토.
- **커스텀 도메인 구입 검토(신규)**: 학교망이 vercel.app을 간헐 차단(2026-07-10 실경험,
  ERR_TIMED_OUT — 폰은 정상). 교실 사용 서비스라 근본 해결 필요 + 유료화 신뢰도 겸사.
  후보 daonclass.kr 등, 연 1~2만원, 기존 주소 자동 리다이렉트 가능.
- **미정착 처방(데이터 대기)**: 92학급=학생 0명(시작 전 벽), 1~5명 멈춤 7학급뿐 — 입력 UX 아님 확정.
  B 문구 답장+no_students 응답 분포 쌓이면 온보딩 방향 확정.
- **챗봇 품질 관찰**: step449·450(양 세션) 배포됨 — 실사용 응답에서 공감만 하는 패턴 재발 시
  단계별 비계(장면 쪼개기) 지시 추가 검토(spell 제안).

**[★수익화 로드맵 (2026-07-03 확정, 2026-07-06 사전 신청 착수)]**
- 전제: 고객=교사 B2B. 무료=현행 전부(개인 API 키). 유료 후보(교사 개인 구독): ①키 없이 바로 사용(AI 비용 대납) ②검증 수업·창체 레시피 팩 ③성장 리포트 PDF.
- 구조: 단일 구독 '다온클래스 플러스'. 크레딧은 고원가 단발 작업(손글씨 스캔) 애드온 전용.
- 가격(가설): 월 4,900원 / 연 39,000원('1년 39,000원, 하루 100원꼴'). **→ ★가격은 방학 중 확정 후 관심자에게 첫 공개(§12-3).**
- 파운딩 멤버: 출시 공지일 이전 가입+학생 1명 이상 등록 교사. 혜택=첫해 연 19,000원+가격 인상 미적용.
- **✅ 사전 신청 카드 착수(step380·382):** 가격 없는 2버튼(관심 있어요/아직 잘 모르겠어요) + 관리자 명단. **현재 interested 2명.** `preorders` 테이블 배포됨. → 신청률 보고 PG 연동 착수 판단.
- 신규 기능 3바구니 규칙: ①매일 습관·학생용·네트워크→무료 ②교사 시간 절약·외부 산출물→플러스 ③고원가 단발→크레딧. 기존 무료 소급 잠금 없음.

**[대기열 — 소형]**
- **step385 주제 수정 3개 눈 확인** — 제출물 잠금 반영된 주제 수정 UI 실물 확인(밀린 눈 확인).
- **주제 수정 의견 준 교사 회신** — 피드백 준 교사에게 반영 회신.
- **RLS 일반교사 격리 확인** — 일반 교사 계정으로 남의 반 데이터가 안 보이는지 앱 차원 점검(관리자 SQL 전체 조회는 정상).
- **의심 교정 '글 보기' 버튼 일부 미표시** [맞춤법 세션 소관] — 관리자 의심 교정 탭에서 일부 항목에만 글 보기 버튼. 맞춤법 세션에서 조건·최근 step 회귀 확인.
- **막힌 3종 모달 재노출 정책 검토** — 현재 평생 1회. ✕ 닫은 교사(예: no_class_run)가 다시 막혀도 재안내 불가. 응답 데이터 쌓인 뒤 "N일 후 1회 재노출" 등 검토.
- **온보딩 응답 기반 후속 처방** — no_students 3버튼 분포 보고 우선순위(명렬표 간소화 vs 동의 안내) 결정.
- **corrections 비문자열 원본 추적** [맞춤법 세션 소관] — 뽀로로반 22번 submissions.corrections에 객체/비문자열 필드가 저장된 경로(AI 파싱 or 규칙 병합) 확인. 표시 방어는 step420 완료. **착수 계획: 해당 제출물 corrections 원본 덤프 확보 → 비문자열 필드 모양으로 AI 파싱(parseAIJson 잘린 JSON 복구) vs 규칙 병합(koreanRules) 경로 판별 → 재발 방어를 gate-korean-rules.js 케이스로 추가.**
- **게이트 스위트 prompts.server.js 케이스 확장** [맞춤법 세션 소관] — step411 게이트는 koreanRules만 커버. 채점 프롬프트 3종의 핵심 지시(문장수 제한·가감표기 금지·규칙 11 등) 포함 여부 스모크를 확장(같은 스크립트 or 별도 파일).

**[방학 본공사 — 대형/별도 설계 세션]**
- **시사·뉴스 기반 주제** (저작권 주의: 원문 불가, AI가 초등용 재구성). 무료 바구니.
- **브리핑 결과 화면** [설계 미정] — 브리핑 근거가 된 '지난 글 실제 결과'를 보여주는 화면. 사용자도 그림 미정 — 그림 잡히면 착수.
- **커뮤니티 설계 세션** — 교사 커뮤니티/공유 확장.
- **결제 PG + 메일 인프라** — 국내 PG 구독 연동, 트랜잭션 메일.
- **소셜 로그인** — 구글 → 카카오 → 네이버 순. §12-1(한 이메일=한 계정)과 정합.

**[대형 항목 — 진행 상태]**
- **범용 알림 센터**: ✅1차(step348 교사·관리자, 🔔+60초 폴링) ✅2차(step358 학생 도장·코멘트). 남은 것: 3차=실시간 채팅(별도 설계, 아동 안전·PII).
- **맞춤법 파이프라인 B(수정본 corrections 승계)**: 📋 **미착수(백로그 유지).** A(서버 이전 step350)·C(자동 감시 step359~362)는 완료. B는 `rewriteGrading`에 prevCorrections 넘겨 "첫 글에서 잡힌 오류가 수정본에서 사라지는" 들쭉날쭉 제거. **prompts.server.js 수정이라 병렬 맞춤법 세션 종료 확인 후 착수.** grep 확인: prevCorrections 코드상 미사용(진짜 미착수).

**[대기 — 저순위]**
- DB 부분 UNIQUE 인덱스(중복 제출 후속, 보류): 별개 글 8건 충돌로 미적용. 현 방어=코드 가드(한-화면 연타만). "두 기기/두 탭 동시 제출"은 무방비. 급하지 않음.
- 맞춤법 전체일괄(runGrammarBatch, 3곳) vs 단일검사 공존 — grammar-backfill 페이지 정리 여부 추후 판단.
- 회색지대 발견성 배지·admin 집계뷰 / 전체 UI 폴리시 / A3 교사 평판 표시(개인정보 trade-off).
- **AI 비용 2단 모델 구조 검토** — 싼 모델 1차 + 애매한 것만 상위 모델. 사용량 커져 비용 아플 때 착수.

**[완료 2026-07-09~10 — 다시 만들지 말 것]**
> ⚠️ 이 구간 step 번호 중복 다수(두 세션 병렬). **해시가 유일한 권위.** 매핑표:
> | step | 메인 세션 | spell 세션 |
> |---|---|---|
> | 425 | (426으로 회피) | 38bd129 규칙 2건 |
> | 427 | a48ecbe pickStr | f9103e5 String() 통일 |
> | 430 | 6815741 비밀번호 | 1d3cb02 죽은코드 제거 |
> | 431 | da466a1 학급→글 | 02dd5c6 프롬프트 게이트 |
> | 432 | ce2b111 쪽지 수정삭제 | e5203e3 만점 프롬프트 |
> | 435 | 0ca3a1f 접속중 | 404c91c 지않 가드 |
> | 436 | 6cd5fff 점수조정 | 9a46707 이월 인자 |
> | 441 | 8de4bdc escapeHtml 공용화 | cf7bda7 날짜 주입 |
> | 442 | fe94837 이월 배관 | 4da6bd4 3인자 재설계 |

- ✅ **쪽지 시스템 전체(step422~424·428·432·434·439)**: messages·message_thread_status 테이블+RLS,
  notifications CHECK 'message' 추가. 교사 ✉️(헤더)+/teacher/messages, 관리자 쪽지 탭(스레드·처리됨·
  마스킹 캡쳐 모드), MessageBell 교사·관리자 배지, 수정·소프트삭제(sender 본인 API /api/message-edit,
  "(수정됨)"은 양쪽 표시), '대화 중' 필터(교사발 존재, admin 본인 제외, 기본 선택), is_bulk 일괄 구분
  (관리자 화면만 📢 회색 — 교사 화면은 일반 쪽지로 보임), 비대칭 읽음 표시(관리자만 봄), 입력칸 자동
  확장(최대 10줄)+수동 조절.
- ✅ **일괄 쪽지 발송 실행(2026-07-09)**: A 문구(의견 요청)→전원 249명, B 문구(막힌 곳)→미정착 166명
  추가 수신(1통 83명/2통 166명 — 1차 대상 체크 실수로 전원 발송, 실해 낮음 판단).
  /api/admin-messages-bulk: {이름} 치환(fillName, 빈 이름 방어)+미리보기+N confirm.
- ✅ **작업 B 완성(파이프라인 B, step442~443 + spell 9a46707·4da6bd4)**: 수정본 채점에 직전 채점 이월.
  최종 인터페이스 = rewriteGradingPrompt 3인자(prevScore·prevCorrections·prevFeedback — spell이
  prevGradingText 문자열안을 구조화로 재설계, 메인 f4c7fe3이 배관 연결). 서버(ai.js)가 직전 제출을
  service role로 직접 조회(클라는 topicId 식별자만 전달 — 재료 조작 차단), 일관성 규칙(고친 항목 점수
  하락 금지 등). **점수역전 감시**: 지적 감소+총점 하락 시 correction_alerts에 suspect_type '점수역전'
  기록만(보정 금지). CHECK 제약 없음 확인됨.
- ✅ **채점 신뢰 개선(spell e5203e3·cf7bda7)**: 만점 허용 명시+90%↑ 감점 사유 필수(채점 3종) /
  오늘 날짜(KST) 주입 — "2025년 자료를 미래로 오지적" 실사례 차단. 게이트 24케이스(REWRITE·DATE 그룹).
- ✅ **교사 점수 조정(병기형, step436~438)**: submissions.teacher_score·teacher_score_at.
  AI 점수(total_score) 불변 — 통계(그래프·랭킹·참조선)는 AI 점수 유지, 대표 표시만 교체.
  교사 상세 ✏️ 팝오버(접힘 무관, 2줄 배치), 학생 화면 "✔ 선생님이 확인한 점수" 배지+AI 병기, ↺ 되돌리기.
  RLS는 기존 sub_update(step147) 재사용. 실사용 요청자=정윤정(서울중대초).
- ✅ **홍보용 리뷰 파이프라인(step422~423)**: review 카드 고지 문구("익명 인용될 수 있어요" — 체크박스
  없이 고지만, 마스킹하면 개인정보 아님 판단) + 관리자 사전 신청 탭 하단 📸 캡쳐 목록
  (maskTeacherLabel: "경기 ○○초 신○○ 선생님", 실명 병기 토글).
- ✅ **공유 주제 가져옴 배지(step426 메인 45593c4)**: topic_copies 내 기록 기반 ✔ 배지(인라인+사이드
  패널). "다시 가져오기 confirm"은 미구현 수용(배지로 충분).
- ✅ **비문자열 corrections 종결(427×2·429·426spell)**: 입구 정규화(spell)+catch 폴백 정규화(f344202)+
  표시 pickStr 4곳(a48ecbe)+isContained String()(f9103e5). 전 경로 문자열 보장.
- ✅ **비밀번호 UX(step430 메인)**: PasswordInput 공용(👁 토글, forwardRef) + 변경·가입·재설정 실시간
  길이·일치 표시(로그인은 👁만).
- ✅ **관리자 운영 도구**: 학급→글 보기 딥링크+드롭다운 검색 축소+학급 지정 시 2000건(step431 메인) /
  접속 중 표시(step435 메인 — profiles.last_seen_at, MessageBell 폴링 편승 5분 하트비트, 임퍼소네이션
  기록 안 함) / escapeHtml 공용화·툴팁 따옴표 수정(step440·441 메인).
- ✅ **spell 게이트 확장**: gate-korean-rules 51케이스(지않 가드 404c91c 포함), gate-prompts 24케이스.

**[완료 2026-07-10 오후 추가 — 다시 만들지 말 것]**
> 번호 중복 추가: 443(메인 이월배관 f4c7fe3 / spell 규칙12 efc0da0), 450(메인 잘림수리 / spell 호칭 3f5bd8f)
- ✅ **일괄 쪽지 직접 선택 모드(step444, 124eee9)**: 검색+체크+칩, 기존 발송 흐름 재사용.
- ✅ **Gemini 모델 장애 해소(step446, c8d38fa)**: 2.5-flash-lite 신규 사용자 중단(404) →
  전 체인 제거, callGemini 404 폴백 신설(기존엔 폴백 없이 사용자 에러 직결 — tutorChat 실장애 원인),
  감지식 소문자·'no longer available' 보강. 실장애: 인천고잔초 6-3 챗봇 5회 실패 → 해소·쪽지 발송.
- ✅ **작업 B 실검증 통과**: 뽀로로반 초안→지적만 고쳐 재제출→점수 유지 확인(사용자 직접).
  김민구·정윤정 완료 쪽지 발송.
- ✅ **규칙 12 오교정 금지(spell efc0da0→b3d2a2e)**: 조사 떼기·%띄우기·어치·가운뎃점·복합명사 핑퐁
  5유형 금지. step448에서 NO_CORRECT_LIST 단일 소스로 추출해 재평가·수정본 채점에도 반영(핑퐁의
  실제 무대). 오타 규칙 2건(다같이·편한함, 9eeea88). 게이트 55(koreanRules)·46(prompts).
- ✅ **챗봇 품질·잘림(step449·450 양 세션)**: 실질 도움 원칙(다음 한 걸음 필수·주제 연결 질문·
  이어쓰기·호칭 금지) + maxTokens 500→1000·미완성 꼬리 제거 휴리스틱. 배관은 원래 완비였음
  (topicTitle·currentText·history 전달 중 — 메인 조사).
- ✅ **학교망 vercel.app 차단 판별법 확립**: 폰(통신사망) 접속 대조 → 서비스 정상/학교망 문제 즉시 판별.

**[재발 방지 규칙 — 신규 3건]**
- **spell 세션 시작 시 첫 명령 = pwd 확인. literacy-class-spell 폴더 아니면 진행 금지.**
  (7/9 실제로 메인 폴더에서 구동 중이었음 — step390 유실 사고와 동일 전제. 새 세션으로 재기동 완료.)
- **일괄 발송 전 confirm의 N을 예상 대상 수와 반드시 대조.** (7/9 1차 발송이 87명 예상인데 249명
  발송 — N 대조 안 해서 미정착 교사 이중 수신.)
- **커밋 직전 git fetch 후 origin/main 로그로 step 번호 확인.** (이틀간 중복 9건 — 해시가 권위이나
  번호 혼란 최소화.)

**[DB 수동 적용 추가분(마이그레이션 파일은 기록용)]**
messages(+edited_at·deleted_at·is_bulk, 415건 소급) / message_thread_status /
notifications CHECK 'message' / profiles.last_seen_at / submissions.teacher_score·teacher_score_at

**[종료 — 다시 만들지 말 것 (step308~418 완료 목록)]**
> ⚠️ step407·409·410은 두 세션 번호 중복. 알림/브리핑 세션 커밋: 407=c511e7d · 409=fe5b189 · 410=1361426. (맞춤법 세션: 407=1bdfc74 · 409=c329053 · 410=27fbda5)
- ✅ **핸드오버 갱신(step419)** + **학생 퀴즈 크래시 수정(step420)**: /student/quiz corrections 비문자열 필드 .trim() 크래시 → pickStr 헬퍼 방어(표시만, koreanRules 미접근). 실사용자(뽀로로반 22번) 발생 건.
- ✅ **koreanRules 회귀 게이트 스위트(step411, 맞춤법 세션)**: `scripts/gate-korean-rules.js` 34케이스(DETECT 18·오탐방지 10·MERGE 5·하위호환 1). **lib/koreanRules.js 수정 시 커밋 전 `node scripts/gate-korean-rules.js` 전체 PASS 필수**(CLAUDE.md에 절차 명시). 규칙을 의도적으로 바꾸면 게이트 기대값도 같은 커밋에서 갱신.
- ✅ **교사 활동 대시보드(step414)**: 관리자 선생님 탭에 활동 4단계 분류(🟢활성/🟡식어감/🔴이탈위험/⚪미정착, 상수 ACTIVE_DAYS=7·COOLING_DAYS=14 — 방학엔 조정) + 요약 카드 4장 클릭 필터 + 정렬 셀렉트 + 단계 통합 배지·진단 문구. DB 무변경(파생 계산). step418에서 행 밀도 복구(2단 배치+버튼 가로 1줄).
- ✅ **미정착 원인 지도(SQL 분석, 2026-07-08)**: 교사 249명 중 수업 도달 83(활성 42). 벽 3개 — 학생 등록 92 / 주제 등록 36 / 첫 수업 실행 32. **API 키 가설 기각**(실행 벽 74명 중 68명이 키 보유). 늦은 가입 탓 아님(미정착 중 6/20 이후 가입 16명뿐).
- ✅ **다음 걸음 카드(step415~418)**: 교사 상태별 온보딩 설문·안내. review(수업 3회+, 인라인 배너, 😀🙂😐+한줄) / no_students(모달, 3버튼) / no_topics(모달, 추천 주제 버튼) / no_class_run(모달, 활용 레시피: 아침 활동·교과 연계). 평생 1회(onboarding_responses, unique(teacher_id,card_type)), ✕·오버레이·ESC=dismissed. admin도 노출(관리자 배지로 구분). review good → 사전신청 이어묻기(step418, submitPreorder 재사용, soso/bad엔 지갑 질문 금지).
  - ⚠️ DB 수동 적용: onboarding_responses 테이블+RLS(본인 insert/본인+admin select/update·delete 차단). 기록용 migrations/step415 파일 있음.
  - 첫 실전 반응(2026-07-08): 방혜린 교사 — no_topics 버튼 클릭 → 1분 내 주제 등록 성공(상태가 no_class_run으로 전이) → 온보딩 카드 유효성 첫 증거.
- ✅ **교사 아침 브리핑(step402~409) — 구독 간판 완성**: 홈 진입 시 lazy 생성 → 종 알림. 직전(임계값: visible 학생 70%·최소 2명) 채점완료 주제의 채점요약 → AI({weakness, student_line}) → 2층 문구(교사 안내 + 학생에게 읽어줄 문장, \n 분리 저장) → 종에서 학생 문장 파란 박스 렌더. 주제당 1회 캐시(classes.morning_briefing_source_topic_id/text). 임퍼소네이션·API키 없음 시 스킵. 프롬프트=lib/briefingPrompt.server.js(스키마 포함, gemini.js 미접근), ai.js taskType 'briefing'. **프롬프트 규칙: 지난 주제 소재 언급 금지, 범용 글쓰기 기술만(step407)**. 뽀로로반 실검증 완료.
  - ⚠️ DB 수동 적용 3건(마이그레이션 파일 아님): classes 브리핑 컬럼 2개 / **notifications_type_check 제약에 'briefing' 추가(이거 빠지면 알림 조용히 실패 — step402 사고 원인)** / notifications.dismissed_at.
  - 캐시 재생성: 해당 학급 morning_briefing_source_topic_id/text를 null로(테스트 시 반 id로 좁혀 UPDATE).
- ✅ **알림 종 개선(step408~409)**: 개별 x 소프트 삭제(dismissed_at, 목록·카운트 쿼리 필터) / 타입별 이모지 아이콘 원 / 안읽음 강조 / '모두 읽음' 항상 표시(안읽음 0이면 비활성) / briefing body \n 분리 박스 렌더.
- ✅ **검증 스킬+커밋 보고 규칙(step410)**: .claude/skills/verify-ui-change/SKILL.md + CLAUDE.md 커밋 보고 첫 줄 규칙.
- ✅ **username DB 유니크 제약**: profiles_username_unique 수동 SQL 적용 완료(중복 0 확인 후). [대기열 소형]에서 제거.
- ✅ **학생 삭제 반쪽 패턴 조사**: 버그 아님 확정 — 학생은 소프트삭제만(auth deleteUser 없음), step387류 auth 잔존 불가능. [방학 본공사]에서 제거.
- ✅ **"찾기 요청함" 문구**: near-no-op 판단으로 스킵 확정. [대기열 소형]에서 제거.
- ✅ **문체 피드백: 프롬프트 규칙 11(step403) 단독 판단.** `isStyleChange` 필터는 393신설→400제거→401복원→**409최종제거**로 폐기. 데이터 분석상 옳은 통일 지적("모여 있다→모여 있어요")·맞춤법 교정("해결했습다→해결했습니다")까지 오차단해 제거. 틀린 문체 교정은 프롬프트 규칙 11이 예방하고, cron이 다른 유형 오교정을 계속 수집. ⚠️ 다시 손대기 전 §7·§1 경고줄 먼저 읽을 것(같은 자리 반복 수정 이력 — 필터 재신설 지양).
- ✅ **안/않 과차단 수정(step405)**: `isInvalidAnhToAn` 조기 가드로 '안'+공백+2글자 용언("안 지나"·"안 고파") 정당 교정 통과. "안 아"(1글자)는 계속 차단, "안 아서"(2글자) 잔여 누수는 감수(감시로 사후 대응). 이산 학생 실사례 해소.
- ✅ **C-2 차단 기록 맥락화(step398·399)**: correction_alerts에 `blocked_user_id`·`blocked_essay_excerpt` 저장(ai.js, 컬럼 Supabase 수동 추가) + 관리자 의심 교정 탭에서 학생 정보(배치 조인)·발췌 표시(admin/index.js). displayStudentName(미동의=닉네임), '글 보기'는 submission_id 있을 때만. ※배포 이전 차단 기록은 두 컬럼 null이라 여전히 '정보 없음'.
- ✅ **오른쪽 추천 패널 인기 배지(step394, 병렬 세션)**: '다른 선생님' 탭 오른쪽 추천 패널에도 인기순 정렬+🔥 배지(SuggestionLogPanel.js·topics.js).
- ✅ **교사 인증 정비(step381·383~387)**: 실이메일 가입 전환·재설정 페이지 / 가입 폼 제출 버그(DOM 실제값) / 이메일 검증 우회(앵커드) + 도메인 선택 UI / 계정 복구 3종(이메일 등록·아이디 찾기·재설정 쌍 검증) / 영구 삭제 반쪽 버그(auth 잔존) 수정 + admin 이메일 등록. 재설정 메일 실왕복 6단계 검증 완료.
- ✅ **인기 주제(step390 도입 → step391 정리)**: `topic_copy_counts` RPC로 '다른 선생님' 탭에서 2명 이상 가져간 상위 3개에만 🔥 인기 배지 + 인기순. `item.isPopular`·`buildSharedFlat`(topics.js). 모달·버튼은 정리 시 제거. 현재 해당 주제 0개라 배지 미표시(정상). ※step390은 병렬 세션 origin 재작성으로 유실→`8c68a50` 백업 복원 이력.
- ✅ **주제 수정 잠금(step385)**: 제출물 있는 주제는 제목·루브릭 편집 잠금(채점 일관성 보호) + 수정 목록 진입.
- ✅ **수익화 사전 신청(step380·382)**: preorders 테이블 + 교사 카드(가격 없는 2버튼) + 관리자 명단·카운트.
- ✅ **학생 화면 재설계(step363~377)**: 피드백 결과 재배치(의견 상단·접힘) / 채점 완료 상단 스크롤 / 글 기록 단일 뷰 / 채점 피드백 길이·눈높이 / 다시쓰기 체크리스트 / 온보딩 영구 숨김 / 첫 글 예시 저장 누락 수정.
- ✅ **맞춤법 파이프라인 A·C + 차단망(step327·350·354·355·359~362·373·375·378·398·399·405·407·409)**: A 서버 이전 / C 오교정 자동 감시(correction_alerts·cron·관리자 탭·차단 기록·발췌 맥락 확대 step407) / 안·않 차단망 강화 및 과차단 수정(step378·405) / 문체 필터 제거해 프롬프트 규칙 11 단독화(step409) / CORRECTIONS_RULES 범위 제한 / 였다·이였다·되다·시키다·의 규칙 / 학생 맞춤법 퀴즈 1차(step361).
- ✅ **알림 센터 1·2차(step348·358)**.
- ✅ **성장 그래프 3단 재설계 + 학년 맥락 보정(step342~346)**: 결론 카드·상대성장 그리드·개별 모달 / 학년 참조선 RPC(step346 grade 누락 수정).
- ✅ **교사 우리 반 랭킹 + 담임 도장(step323·325·330)**.
- ✅ **관리자 대시보드 최적화(step333·334)**: admin_class_stats RPC / 마지막 로그인 비차단.
- ✅ **동의 화면 B안 재배치 + 동의서 실명 칸(step340·341·344)** / 동의서 일괄 인쇄(step337).
- ✅ **교사 대시보드 신규/정착 분기(step316·335·336)** / SetupChecklist 잠금 해제(step318).
- ✅ **주제 가져오기 출처 원저자 로그 기록(step326)**.
- ✅ 문서/인프라: gitignore 정리(step339) · 미추적 마이그레이션 편입(step338) · 스냅샷 로컬화(step356) · 보고 규칙 v2 문서화(step366).
- ❌ 학년별 채점 차등 → 데이터로 기각(2026-07-03). 대체=학년 맥락 보정(step345).
- ❌ 맞춤법 누락 자동수집 → 폐기(규칙 보강으로 대체).

## 워킹트리 상태 (2026-07-10)
- 메인 HEAD=f4c7fe3(step443) 이후 진행 중. spell은 literacy-class-spell 별도 폴더(정상화 완료).
- 두 세션 force-push 금지·커밋 전 pull --rebase 유지. Vercel 웹훅 1회 누락 이력(93fae57 빈 커밋으로
  재트리거) — 배포 안 뜨면 빈 커밋 트리거가 검증된 해법.
