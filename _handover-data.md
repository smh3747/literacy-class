# 핸드오버 데이터 (HEAD = be59ae0 (step395))

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

## 2. lib/koreanRules.js — 함수 역할 + 줄 위치 (step393 기준 재확인)
| 함수 | 줄 | 역할(1줄) |
|---|---|---|
| `findRuleBasedErrors(text)` | `:10` | 정규식으로 AI가 놓친 맞춤법/띄어쓰기 보강 생성(문장부호 뒤 띄어쓰기, 할수있다, 안/않, 되/돼, ㄹ께요, 번째, 입니다/습니다, 조사 '의', 되다/시키다/하다 접미사, 였다·이였다, COMMON_TYPOS 등). |
| `isAndaVerbCorrection(o,c)` | `:429` | '안다' 활용형(안아·안고·안으며) 화이트리스트 — 안/않 차단망 과차단 방지(step378). |
| `isInvalidAnhToAn(o,c)` | `:450` | "맞는 '않'을 '안'으로 바꾸는" 오교정 판정(내부 가드). |
| `isImpossibleCorrection(c)` | `:489` | 불가능 형태 교정 fail-safe 필터('안 '+어미 등, step327). |
| `isStyleChange(o,c)` | `:499` | **문체개입 fail-safe 필터(step393 신설).** 반말 종결(-다/-어/-지 등) 원문을 존댓말(-습니다/-어요 등)로 바꾸는 교정을 폐기. 어미 형태 안 바뀌면·원문이 이미 존댓말이면 제외. mergeCorrectionsDetailed 최종 체인에서 drop_reason `문체개입`. |
| `dropAnhFalsePositives(corr)` | `:516` | mergeCorrections 안 타는 경로용 — 안/않 오교정 + 불가능형태 필터. (※문체개입 필터는 여기 미포함, 본체 체인 전용.) |
| `findOriginalRange(essay, original)` | `:527` | original을 본문에서 찾되 공백 무시 매칭→실제 구간 인덱스 환산. `{start,end,exact,ambiguous}` 또는 `null`. |
| `snapOriginalToEssay(c, essay)` | `:560` | AI correction의 original을 공백무시로 **유일하게** 찾힐 때만 본문 실제 문자열로 스냅. |
| `mergeCorrectionsDetailed(aiCorr, essay)` | `:576` | **본체(step360 신설).** 병합 + **폐기된 항목까지 `{corrections, dropped}`로 반환**. dropped는 correction_alerts 기록(작업 C-2, step362)에 쓰임. drop_reason: 안않오교정·불가능형태·문체개입(step393). |
| `mergeCorrections(aiCorr, essay)` | `:641` | 얇은 래퍼 — `mergeCorrectionsDetailed(...).corrections`만 반환(동작 불변). |

- **무의미 교정 필터(step273)** + **불가능형태 필터(step327)** + **문체개입 필터(step393)**는 mergeCorrectionsDetailed 안에 통합.

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
| `step382-preorders-response.sql` (+`-rollback`) | 사전 신청 응답 구분 `response text`('interested'/'not_sure', default interested). RLS 불변. |
| `step380-preorders.sql` (+`-rollback`) | 파운딩 멤버 사전 신청 `preorders`(teacher_id unique·created_at) + RLS(po_select 본인/admin, po_insert 본인 teacher). update/delete 정책 없음=차단. |
| `step272-topic-copies.sql` | 공유 주제 가져오기 출처 기록(topic_copies + RLS + topic_copy_counts() RPC). |
- **⚠️ DB 객체는 Supabase SQL Editor에서 수동 실행**(자동 적용 아님). 대부분 `IF NOT EXISTS`로 멱등.
- **마이그레이션 파일 없이 Supabase 수동 적용된 것**: 알림 센터(`notifications` 테이블·RLS·`create_notification` RPC, step348) / 오교정 감시(`correction_alerts` 테이블·pg_cron 일일 스캔, step359~362, submission_id nullable) / 담임 확인 도장(`teacher_stamp`, step323) / 관리자 통계 RPC(`admin_class_stats`, step333). → 스키마는 코드 커밋이 아니라 각 step 커밋 메시지 + 실제 Supabase에 존재.

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
- **CORRECTIONS_RULES 규칙 11(step395 강화):** 문체개입(반말→존댓말) 오교정 억제. "correction의 original·correction은 종결어미(말투)가 서로 같아야" 명시 + ❌ 예시. 상수 단일 소스라 세 프롬프트에 자동 반영. 이 규칙은 프롬프트=예방, `koreanRules` `isStyleChange`(step393)=fail-safe 차단으로 이중 방어.

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

**[★다음 작업 — 새 대화 1순위]**
- **인기 주제 랭킹 = ✅완료(step390 도입 → step391 정리).** 새 1순위는 미지정 — 아래 **[대기열 소형]** 또는 **[방학 본공사]**에서 골라 지시.
  - **현재 상태**: `topic_copy_counts` RPC(읽기 전용)로 '다른 선생님' 탭에서 한 주제를 **2명 이상** 가져간 **상위 3개**에만 🔥 인기 배지 + 인기순 정렬. 배지 대상 판정=파생 플래그 `item.isPopular`, 평탄화·정렬=헬퍼 `buildSharedFlat`(둘 다 `pages/teacher/topics.js`). 모달·헤더 버튼은 step391에서 제거(전부 인기로 떠 무의미했음).
  - **현재 인기 주제 0개**(신명훈 본인 것 1개뿐이라 '다른 선생님' 탭에서 제외됨) → 배지 안 뜨는 게 정상. 데이터 쌓이면 자동 노출. 병목(교사 첫 주제 등록률 56.5% 미달)용 장치라 인기 주제 생기면 등록 유도 효과.

**[★수익화 로드맵 (2026-07-03 확정, 2026-07-06 사전 신청 착수)]**
- 전제: 고객=교사 B2B. 무료=현행 전부(개인 API 키). 유료 후보(교사 개인 구독): ①키 없이 바로 사용(AI 비용 대납) ②검증 수업·창체 레시피 팩 ③성장 리포트 PDF.
- 구조: 단일 구독 '다온클래스 플러스'. 크레딧은 고원가 단발 작업(손글씨 스캔) 애드온 전용.
- 가격(가설): 월 4,900원 / 연 39,000원('1년 39,000원, 하루 100원꼴'). **→ ★가격은 방학 중 확정 후 관심자에게 첫 공개(§12-3).**
- 파운딩 멤버: 출시 공지일 이전 가입+학생 1명 이상 등록 교사. 혜택=첫해 연 19,000원+가격 인상 미적용.
- **✅ 사전 신청 카드 착수(step380·382):** 가격 없는 2버튼(관심 있어요/아직 잘 모르겠어요) + 관리자 명단. **현재 interested 2명.** `preorders` 테이블 배포됨. → 신청률 보고 PG 연동 착수 판단.
- 신규 기능 3바구니 규칙: ①매일 습관·학생용·네트워크→무료 ②교사 시간 절약·외부 산출물→플러스 ③고원가 단발→크레딧. 기존 무료 소급 잠금 없음.

**[대기열 — 소형]**
- **username DB 유니크 제약** — 앱 코드 가드만 있고 DB 레벨 unique 없음(교사 username). 추가 검토.
- **"찾기 요청함" 셀프 재설정 안내 문구** — 아이디/비번 찾기 흐름 안내 문구 다듬기.
- **step385 주제 수정 3개 눈 확인** — 제출물 잠금 반영된 주제 수정 UI 실물 확인(밀린 눈 확인).
- **주제 수정 의견 준 교사 회신** — 피드백 준 교사에게 반영 회신.

**[방학 본공사 — 대형/별도 설계 세션]**
- **시사·뉴스 기반 주제** (저작권 주의: 원문 불가, AI가 초등용 재구성). 무료 바구니.
- **교사 아침 브리핑** — "오늘 학생들에게 해줄 말". ★구독 간판 후보(플러스 바구니).
- **커뮤니티 설계 세션** — 교사 커뮤니티/공유 확장.
- **결제 PG + 메일 인프라** — 국내 PG 구독 연동, 트랜잭션 메일.
- **소셜 로그인** — 구글 → 카카오 → 네이버 순. §12-1(한 이메일=한 계정)과 정합.
- **조사만: 학생 삭제도 반쪽 패턴인지** — step387이 교사 영구삭제 auth 잔존을 고쳤는데, 학생 삭제에도 같은 auth 잔존 버그가 있는지 확인 필요.

**[대형 항목 — 진행 상태]**
- **범용 알림 센터**: ✅1차(step348 교사·관리자, 🔔+60초 폴링) ✅2차(step358 학생 도장·코멘트). 남은 것: 3차=실시간 채팅(별도 설계, 아동 안전·PII).
- **맞춤법 파이프라인 B(수정본 corrections 승계)**: 📋 **미착수(백로그 유지).** A(서버 이전 step350)·C(자동 감시 step359~362)는 완료. B는 `rewriteGrading`에 prevCorrections 넘겨 "첫 글에서 잡힌 오류가 수정본에서 사라지는" 들쭉날쭉 제거. **prompts.server.js 수정이라 병렬 맞춤법 세션 종료 확인 후 착수.** grep 확인: prevCorrections 코드상 미사용(진짜 미착수).

**[대기 — 저순위]**
- DB 부분 UNIQUE 인덱스(중복 제출 후속, 보류): 별개 글 8건 충돌로 미적용. 현 방어=코드 가드(한-화면 연타만). "두 기기/두 탭 동시 제출"은 무방비. 급하지 않음.
- 맞춤법 전체일괄(runGrammarBatch, 3곳) vs 단일검사 공존 — grammar-backfill 페이지 정리 여부 추후 판단.
- 회색지대 발견성 배지·admin 집계뷰 / 전체 UI 폴리시 / A3 교사 평판 표시(개인정보 trade-off).

**[종료 — 다시 만들지 말 것 (step308~395 완료 목록)]**
- ✅ **문체개입 오교정 이중 차단(step393·395)**: 반말→존댓말로 문체를 바꾸는 오교정(생각한다→생각합니다 등)을 ①프롬프트 규칙 11 강화(step395, 예방)와 ②`koreanRules` `isStyleChange` fail-safe 필터(step393, 확정 폐기·drop_reason 문체개입)로 이중 차단. correction_alerts 7/6분 재발에 대응. 배포 후 발생 빈도 모니터링 대상.
- ✅ **오른쪽 추천 패널 인기 배지(step394, 병렬 세션)**: '다른 선생님' 탭 오른쪽 추천 패널에도 인기순 정렬+🔥 배지(SuggestionLogPanel.js·topics.js).
- ✅ **교사 인증 정비(step381·383~387)**: 실이메일 가입 전환·재설정 페이지 / 가입 폼 제출 버그(DOM 실제값) / 이메일 검증 우회(앵커드) + 도메인 선택 UI / 계정 복구 3종(이메일 등록·아이디 찾기·재설정 쌍 검증) / 영구 삭제 반쪽 버그(auth 잔존) 수정 + admin 이메일 등록. 재설정 메일 실왕복 6단계 검증 완료.
- ✅ **인기 주제(step390 도입 → step391 정리)**: `topic_copy_counts` RPC로 '다른 선생님' 탭에서 2명 이상 가져간 상위 3개에만 🔥 인기 배지 + 인기순. `item.isPopular`·`buildSharedFlat`(topics.js). 모달·버튼은 정리 시 제거. 현재 해당 주제 0개라 배지 미표시(정상). ※step390은 병렬 세션 origin 재작성으로 유실→`8c68a50` 백업 복원 이력.
- ✅ **주제 수정 잠금(step385)**: 제출물 있는 주제는 제목·루브릭 편집 잠금(채점 일관성 보호) + 수정 목록 진입.
- ✅ **수익화 사전 신청(step380·382)**: preorders 테이블 + 교사 카드(가격 없는 2버튼) + 관리자 명단·카운트.
- ✅ **학생 화면 재설계(step363~377)**: 피드백 결과 재배치(의견 상단·접힘) / 채점 완료 상단 스크롤 / 글 기록 단일 뷰 / 채점 피드백 길이·눈높이 / 다시쓰기 체크리스트 / 온보딩 영구 숨김 / 첫 글 예시 저장 누락 수정.
- ✅ **맞춤법 파이프라인 A·C + 차단망(step327·350·354·355·359~362·373·375·378)**: A 서버 이전 / C 오교정 자동 감시(correction_alerts·cron·관리자 탭·차단 기록) / 안·않 차단망 강화 및 과차단 수정 / CORRECTIONS_RULES 범위 제한 / 였다·이였다·되다·시키다·의 규칙 / 학생 맞춤법 퀴즈 1차(step361).
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

## 워킹트리 상태
- **HEAD=be59ae0(step395)까지 전부 커밋·push 완료. origin/main=로컬 동기화 확인됨. 워킹트리 clean.**
- ⚠️⚠️ **병렬 맞춤법 세션 운영 원칙(중요·갱신):** 맞춤법 세션은 이제 **별도 폴더(`literacy-class-spell`)에서 실행** — 같은 origin(GitHub) 공유하되 워킹디렉토리는 분리됨. 과거 **같은 폴더를 공유했을 때** amend/force-push로 서로 커밋을 덮어써 **커밋 유실 사고 발생(오늘 step390이 유실됐다가 백업 `8c68a50`에서 복원)**. **→ 앞으로 두 세션 모두 `force-push` 절대 금지, 일반 `push`만. 커밋 전 `git pull --rebase` 먼저.**
- ⚠️ Code가 커밋 후 push 빠뜨리는 경우 있음 — 커밋 지시 시 "push까지" 명시.
- untracked(미커밋, 급하지 않음): `_report*.md`·`_snapshot/`(로컬 산출물, gitignore 처리됨). `scripts/make-snapshot.js`·`FEATURE-MAP.md`는 저장소 편입 완료(step338·339).
