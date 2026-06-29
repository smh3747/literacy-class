# 핸드오버 데이터 (HEAD = dc8dc6f (step279))

> 살아있는 마스터 인수인계서. 파일명 `_handover-data.md` 유지.
> 스냅샷 4개(`_snapshot/SNAPSHOT-{pages,components,lib,migrations}.md`)는 `node scripts/make-snapshot.js`로 최신화.
> pages 46파일 / components 24 / lib 23 / migrations 76.

## 1. 현재 HEAD
- `dc8dc6f` — **step279: 공유 취소 기능(주제 목록 배지·버튼 + 추천 패널 버튼, 공통 함수 cancelTopicShare)**
- `7d02940` — **step278: 손제작 주제 공유 노출 강화(체크박스 강조 + 등록 후 확인 모달)**
- `5ed7b37` — **step277: 손제작 주제 추천 풀 공유(옵트인+합성 로그, topics.js 단일, 마이그레이션 없음)**
- `febf86b` — **step276: '수있/수없' 띄어쓰기 규칙을 ㄹ받침 판정으로 일반화(생길수있·알수있 등 포함)**
- `4bb6af7` — step275: koreanRules에 '입니다/습니다 앞 띄어쓰기' 규칙 추가(fixedPatterns)
- `da1d08c` — step274: 교사 맞춤법 배너 문구 부드럽게 + 글씨 `text-sm` + 'AI 모델 자동전환' 안내 4곳 제거
- `2e7fecf` — step273: 맞춤법 AI 보조 안내문구 + 교사 재평가 배너 + 무의미 교정 제거
- 직전: `f7a8989` step272(공유 가져오기 출처 기록), `97f421d` step271(재평가 규칙 통일+번째), `cb974f6` step270(공백 허용 매칭).

## 2. lib/koreanRules.js — 함수 역할 + 줄 위치
| 함수 | 줄 | 역할(1줄) |
|---|---|---|
| `findRuleBasedErrors(text)` | `:10` | 정규식으로 AI가 놓친 맞춤법/띄어쓰기 보강 생성(문장부호 뒤 띄어쓰기, 할수있다, 안/않, 되/돼, ㄹ께요, **번째**(step271), **입니다/습니다**(step275), COMMON_TYPOS 등). |
| `isInvalidAnhToAn(o,c)` | `:242` | "맞는 '않'을 '안'으로 바꾸는" 오교정 판정(내부 가드). |
| `dropAnhFalsePositives(corr)` | `:255` | mergeCorrections 안 타는 경로용 안/않 오교정만 필터. |
| `findOriginalRange(essay, original)` | `:266` | original을 본문에서 찾되 정확일치 실패 시 공백(`\s`, 전각공백) 무시 매칭→본문 실제 구간 인덱스 환산. `{start,end,exact,ambiguous}` 또는 `null`. |
| `snapOriginalToEssay(c, essay)` | `:299` | AI correction의 original을, 공백무시로 본문에서 **유일하게** 찾힐 때만 본문 실제 문자열로 스냅(correction·reason 불변). |
| `mergeCorrections(aiCorr, essay)` | `:308` | AI corrections → 안/않 필터 → snap → `findRuleBasedErrors` 병합(중복 회피) → **무의미 교정 필터** 후 반환. |

- **무의미 교정 필터(step273)**: `lib/koreanRules.js:336-344` (mergeCorrections 끝, `return ai.filter(...)`).
  - 기준: `String(original).trim() === String(correction).trim()` 이면 제거. 내부 공백/글자가 다르면 유지. original 없으면 제거.

## 3. lib/regrade.js — mergeCorrections 사용
- import: `lib/regrade.js:7` `import { mergeCorrections } from './koreanRules'`
- 사용: `lib/regrade.js:125`
  `corrections: mergeCorrections(Array.isArray(result.corrections) ? result.corrections : [], submission.essay_text)`
- → 재평가도 첫글·수정본과 동일하게 규칙 보강 + 무의미 필터 적용(step271에서 dropAnhFalsePositives→mergeCorrections 통일).

## 4. lib/notices.js — 상수 2개 전문 (step274 반영)
```js
export const GRAMMAR_NOTICE_STUDENT =
  '✏️ 맞춤법 표시는 AI가 도와주는 거예요. 가끔 놓치거나 잘못 짚을 수 있으니 참고만 하고, 헷갈리면 선생님께 물어봐요.'

export const GRAMMAR_NOTICE_TEACHER =
  '맞춤법·띄어쓰기 표시는 AI가 도와드린 거예요. 완벽하진 않아 가끔 놓치기도 하니, 마지막엔 선생님께서 한 번 봐주시면 좋아요. 결과가 아쉬우면 아래에서 다시 검사할 수 있어요.'
```

## 5. migrations — 최신 5개(스텝번호 기준)
| 파일 | 한 줄 설명 |
|---|---|
| `step272-topic-copies.sql` | 공유 주제 가져오기 출처 기록(topic_copies 테이블 + RLS + topic_copy_counts() RPC). |
| `step219-consent-notice-intro.sql` | 동의 안내(개인정보) intro 문구 관련. |
| `step209-consent-source-create.sql` (+`-verify`) | 동의 출처(consent source) 컬럼/구조 생성·검증. |
| `step206-self-signup.sql` (+`-rollback/-verify`, `-D-backfill/-rollback/-verify`) | 자가 가입(self-signup) 관련. |
| `step205-feedback-reply.sql` (+`-rollback/-verify`) | 피드백 답변(reply) 기능. |
- ※ step205·206 일부는 워킹트리에 untracked로 존재(아직 커밋 안 된 SQL 포함). step272-topic-copies.sql은 f7a8989(step272) 커밋에 포함됨.

## 6. topic_copies (step272)
- **테이블 컬럼**: `id`(uuid pk), `source_log_id`(→topic_suggestion_logs), `source_index`(int), `copied_by_teacher_id`(→profiles), `copied_topic_id`(→topics, nullable), `copied_at`(timestamptz). **UNIQUE(source_log_id, source_index, copied_by_teacher_id)** — 같은 교사 중복 방지.
- **RLS 정책명**: `tc_insert_own`(INSERT, `copied_by_teacher_id = auth.uid()`), `tc_select_own_or_admin`(SELECT, 본인 행 + admin).
- **집계 함수**: `topic_copy_counts()` — SECURITY DEFINER, `(source_log_id, source_index)`별 `COUNT(DISTINCT copied_by_teacher_id) AS n_teachers` 반환(원작자/가져간이 비노출). `GRANT EXECUTE ... TO authenticated`.
- **INSERT 위치(코드)**: `pages/teacher/topics.js:527` `supabase.from('topic_copies').insert({ source_log_id, source_index, copied_by_teacher_id: user.id, copied_topic_id: r.data.id })` — 신규 topic 등록 성공 블록 안, `copiedSource?.logId` 게이트, 실패는 `.catch`/`copyErr` 무시(등록 흐름 안 막음). `copiedSource` 상태는 `:119` 선언, `applyFromLog`에서 "다른 선생님" 카드일 때만 set.
- ⚠️ DB 객체는 Supabase에서 수동 실행 완료 전제(자동 적용 아님).

## 7. 휴면 코드 — grammar 모델 체인
- 정의: `lib/gemini.js:142` `grammar: ['gemini-2.5-flash','gemini-3-flash-preview','gemini-3.1-flash-lite','gemini-2.5-flash-lite']` (채점 메인과 다른 모델 우선).
- 라우팅: `pages/api/ai.js:220` `grammarOnly` → `opts = { taskType: 'grammar', maxTokens: 2000 }`.
- **현재 사용처**: 자동 채점(grading/rewriteGrading)에서는 **호출 안 됨**(step268→269 롤백으로 자동 grammarOnly 분리 철회). 유일 사용처는 **교사 수동 "맞춤법 일괄보강"** `pages/teacher/grammar-backfill.js:142` `callAI('grammarOnly', ...)`. → 자동 채점 경로 기준 사실상 **대기 상태**(향후 "학생 요청→교사 승인 재검사"에서 사용 예정).

## 8. 교사 재평가 배너 (step273~274)
- 위치: `pages/teacher/submissions.js` — 맞춤법 배지("맞춤법/띄어쓰기 N개") 직후, amber 배경 배너.
  - 문구: `{GRAMMAR_NOTICE_TEACHER}` 들어간 `<p className="text-sm text-amber-800 ...">`(step274에서 `text-[11px]`→`text-sm`).
  - CTA: `<button onClick={() => regradeOne(s, selectedStudent.profile.realname)}` / 라벨 `regrading === s.id ? '🔄 평가 중...' : '🔄 다시 평가하기'`, `disabled={regrading === s.id || bulkRegrading}`.
- **기존 "🔄 이 글 다시 평가" 버튼 유지**(동일 `regradeOne(s, selectedStudent.profile.realname)` 호출). 배너는 별도 추가, 둘 다 같은 함수.
- `regradeOne` 정의: `submissions.js:424` (confirm→`regradeSubmission(sub, selectedTopic, uid, {withExample:true})`). **함수 자체 미수정** — 배너는 호출만.

## 9. 학생 안내(step273) 참고
- 첫 글 피드백: `pages/student/index.js` 맞춤법 블록에 `GRAMMAR_NOTICE_STUDENT` 안내(재평가 버튼 없음).
- 공용 카드: `components/StudentFeedbackCard.js` 맞춤법 목록(`corrections.length>0`일 때만) 아래 `GRAMMAR_NOTICE_STUDENT`. admin 화면도 공용.

## 10. 제품 존재이유
- 아침 주제글쓰기 검사에 교사가 **50분~1시간** 소요 → 피드백 위축·형식화. 이를 막아 **'내실 있는 피드백 + 교사 편의'** 둘 다 확보하는 것이 제품의 뿌리. 수익화(교사 B2B)는 그 위에 얹은 비즈니스 모델.

## 11. 확정 사실
- **폴백 채점은 거의 일어나지 않음**(무료 한도 충분). 따라서 **채점 누락·점수 변동은 폴백이 아니라 AI 자체의 변동성**이다.
- 그 변동성은 `koreanRules` 규칙으로 **'모양이 일정한 패턴'만** 보강 가능. **임의 띄어쓰기(의미 기반 끊기)는 규칙으로 불가** — AI 담당.

## 12. 다음 작업
- 구체적 백로그는 **§13으로 일원화**(중복 제거). 완료 항목 상세는 각 step 커밋(`git log`) 참조.
- **회색지대 남은 설계(미구현, 설계만):** ①admin 전체 집계·진행률 뷰(읽기 전용 `consent-grayzone-summary` API, cross-class 일괄쓰기는 의도적 배제) ②per-class 패널 발견성(교사 대시보드/students에 N명 배지+링크) ③(경미) 그레이존 판정에서 `(동의 철회)`-only 행 제외 보정. ⚠️ "777"은 코드 어디에도 없는 외부 수동 집계치(전 학급 합산) — 앱 내 식별은 학급 단위뿐.

## 13. 백로그 (다음 할 일 — 항상 여기만 보면 됨)
> ⚠️ 매 작업 세션 종료 시 이 §13을 갱신할 것(끝낸 항목은 '종료'로 이동, 새 할 일 추가).

**[지금 손댈 수 있음]**
- A2 — "N명 사용" 배지 + 인기순 정렬 (topic_copies/topic_copy_counts 기반). 해자 핵심.
  ※ A1(공유) 구현 후 시간 지났으니 데이터 쌓였는지 SQL 먼저 확인 → 쌓였으면 구현.
- 교사 대시보드 리디자인 — 로그인 첫 화면. 전환·정착 직결. (먼저 plan mode 현황 분석)
- B1 — AI가 놓치는 맞춤법 패턴 규칙화. 상시. 글 보다 걸리면 koreanRules에 추가.

**[수익화 — 의사결정 진행 중]**
- 첫 유료 가치 방향: "교사의 빈 종이를 없앤다(판단 피로 제거)". 후보 C='이 앱을 수업·창체에서 이렇게 써보세요'식 활용법 안내(검증된 레시피, AI 창작 아님). 유료 vs 무료정착은 미정.
- 결제 시스템 / 소셜 로그인(Google→Kakao→Naver): 수익화 관문. 출시 시점 유보 중.
- 원칙: 교사가 "무조건 이득·편함"을 느낄 때만 지불. 학생·학부모용 가치(문집 등)는 교사 지불 동기 약함.

**[대기]**
- A2 데이터 1~2주 / 회색지대 G1·G2(발견성·admin뷰)는 사용자 늘면.

**[보류]**
- 전체 UI 폴리시 패스(기능 안정 후 마지막).
- A3 만든 교사 평판 표시(개인정보 trade-off).

**[종료된 항목 — 다시 만들지 말 것]**
- ✅ 회색지대 교사 판정 UI(step237/240, 안전 확인 완료).
- ✅ 손제작 주제 공유 올리기·내리기(step277/278/279).
- ✅ 맞춤법 입니다/수있 규칙(step275/276).
- ❌ '맞춤법 누락 자동수집(A)' — 원천 데이터 없어 무거움. B1 규칙 보강으로 대체(폐기).

## 워킹트리 상태
- HEAD=dc8dc6f(step279)까지 전부 커밋·push 완료(이 문서 갱신 커밋 별도).
- untracked: `_report*.md`, `_snapshot/`, `FEATURE-MAP.md`, `scripts/make-snapshot.js`, `migrations/step205·206-*.sql`.
