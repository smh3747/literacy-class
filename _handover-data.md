# 핸드오버 데이터 (HEAD = b34bcbf (step307))

> 살아있는 마스터 인수인계서. 파일명 `_handover-data.md` 유지.

## 0. 작업/보고 폼 (★ 항상 이렇게 — 퍼니훈님이 좋다고 확정한 방식)
**Code 작업 결과를 받으면 이 순서로 보고:**
1. 결과 요약 — 무엇이 됐는지 + 커밋 해시·push 여부.
2. 핵심 검증 포인트 강조 — 특히 지시문에 박은 안전장치(임퍼소네이션 가드/PII 보호/로직 불변 등)가 지켜졌는지 짚기.
3. "확인하실 것" 체크리스트 — Vercel Ready 확인 + 화면에서 눈으로 볼 구체 항목.
4. 다음 순서 제시 — 남은 것 + 다음 할 일, 선택지 있으면 추천과 함께.

**작업 지시(Code 지시문) 전에는:**
- 추측 금지. 코드/데이터(스냅샷·grep·SELECT) 먼저 확인하고 지시.
- 지시문에 안전 제약을 명시적으로 박기(불변 대상, PII 보호, 가드 유지 등).
- 큰 작업·민감 영역은 plan mode 먼저(분석→승인→구현).
- 커밋 지시 시 반드시 "커밋하고 push까지" 명시 — Code가 push 빠뜨리는 경우 있음(step299에서 실제 발생).
- 배포 확인은 Vercel 대시보드에서 커밋 해시 Ready 직접 확인(`/api/version`은 stale, Code는 Vercel CLI 없음).

**소통 톤:** 결정·지시·결론은 짧고 직설. 원인 분석·설계 설명은 쉽고 자세하게(구조·예시). 존댓말·비서 포지션.
> 스냅샷 4개(`_snapshot/SNAPSHOT-{pages,components,lib,migrations}.md`)는 `node scripts/make-snapshot.js`로 최신화.
> pages 46파일 / components 24 / lib 24 / migrations 76.

## 1. 현재 HEAD
- `b34bcbf` — **step307: 운영자용 주제 공유 추적 뷰(admin/index.js "🔗 주제 공유 추적" 탭). topic_copies nested select 조인(가져간교사 copied_by_teacher_id→profiles / 원본교사 source_log_id→topic_suggestion_logs.teacher_id→profiles / 주제=suggestions[source_index].title). "[가져간교사]←[원본교사]의 주제(날짜)" 최신순+원본교사별 집계. admin 전용(RLS), 조회만. ※주의: "공유 가져오기 버튼"으로 온 것만 잡힘(직접 입력 복사는 topic_copies에 기록 안 됨).**
- `3ba20e3` — **step306: 신규 교사 온보딩 P1 — SetupChecklist "다음 할 일 하나" 강조(nextStep=steps.find(!done) 맨위 큰 카드, 나머지 소형+진행바). 완료판정·action·숨김로직·props 불변, 표시구조만.**
- `a89ebd1` step305(핸드오버 §0 작업폼) · `f043fcc` step304(CLAUDE.md 작업원칙 추가).
- ⚠️ **병렬 세션 진행 중**: 별도 claude.ai 대화 + 별도 Claude Code로 맞춤법 수정(lib/koreanRules.js·prompts.server.js 전담). 이 세션과 파일 안 겹침. **커밋 전 `git pull --rebase` + git log로 step 번호 확인 필수**(번호 충돌 방지). 맞춤법 세션 결과는 다음에 확인.
- `1694ea7` — **step303: 동의 허브 3구획(온라인/종이/제출 대등 카드) + 두괄식 + 안내문복사/하이클래스 시각분리(consent.js·ConsentPanel.js, 로직 불변)**
- `5b2e34f` — **step302: 대시보드 배너 두괄식(심의·동의 결론 먼저, 대시 제거) + 학생 로그인 안내 2구획 분리(학생용/교사용, index.js·StudentLoginInfoCard.js)**
- `35dd489` — **step301: 맞춤법 토스트 조기소멸 버그 수정(flashGrammarToast useRef로 타이머 겹침 방지 — A→B 연속검사 시 낡은 타이머가 새 토스트 지우던 것)**
- `95b061d` — **step300: 맞춤법 단일검사 완료 토스트 클릭→그 학생 글로 이동(토스트 {msg,targetStudentId} 객체화, goToGrammarTarget, 전체일괄은 비클릭)**
- `138ea71` — **step297: 맞춤법 단일검사 토스트 문구(N번 학생명·첫글/수정본·교정 X→Y개, displayStudentName 마스킹 준수)**
- `ffce2e4` — **step299: 맞춤법만 다시검사 품질을 정식검사와 동일화(원인=경량프롬프트+temp0.7+구모델. CORRECTIONS_RULES 단일소스 추출 + grammarStrict 타입 신설: taskType grading·temp0. recheckGrammarOne만 전환, 전체일괄 grammarOnly 불변)**
- `1681eb5` — **step294: 동의서 인쇄 양식 복구(ConsentDocument props 제거→빈양식, step292 부작용). +step296(sign-line height 고정), +step298(min-height→height로 밑줄 격자정렬)**
- `f021cc6` — **step292: 동의서 인쇄화면 동의현황(미동의 N명, getEffectiveProfile 전환·consentStats 조회) + 툴바 라벨 풀어쓰기(w-24)**
- `e13c820` — **step293: 맞춤법 일괄검사를 학생글보기 편입(grammar-backfill 루프 재사용, 백그라운드·비차단, 우하단 토스트). ※단일검사(step295 recheckGrammarOne)와 별개로 전체일괄 유지**
- `173c388`·`3fb7841` — **step290·291: 교사 대시보드 우측 세로 툴바(데스크탑 lg+만) + 패널 3개(로그인/키/설정) 단일 aside 드로어. step291: drawerOpen→activePanel(버튼별 1개만) + 라벨. SetupChecklist 동선 guideToPanel 재연결, 임퍼소네이션 가드**
- `2529c50` — **step289: 학부모 동의 노출 2곳 제거(학급설정 ClassSettings·대시보드 카드) — 학생관리 동의 페이지로 일원화, GrayZonePanel/ConsentPanel은 students/consent.js에 존재해 유실 없음**
- `af685ef` — **step288: 배너 '학생 등록하러 가기' deeplink(students.js effectiveMode에 ?mode= 우선 반영)**
- `4d44df4` — **step287: 교사 대시보드 안내 배너 2개(학운위 심의·학부모 동의) + 학생 등록 안전 3단계 시각화**
- `31d4fab` — **step286: admin submissions 활성/휴지통/전체 토글(보기 목록 전용) + 휴지통 행 표시**
- `2ae71cc` — **step285: 맛보기 'AI 점수·피드백 보기' 펼치기 유도(화살표 통통+힌트, CSS만)**
- (step284 = SQL 중복정리 91행 hard delete에 예약된 번호, 코드 커밋 아님)
- `dc8dc6f` — **step279: 공유 취소 기능(주제 목록 배지·버튼 + 추천 패널 버튼, 공통 함수 cancelTopicShare)**
- `7d02940` — **step278: 손제작 주제 공유 노출 강화(체크박스 강조 + 등록 후 확인 모달)**
- `5ed7b37` — **step277: 손제작 주제 추천 풀 공유(옵트인+합성 로그, topics.js 단일, 마이그레이션 없음)**
- `febf86b` — step276~ 이하 맞춤법 규칙(수있/수없·입니다 띄어쓰기 등) 및 공유 관련. (상세 생략)

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

**[★수익화 로드맵 (2026-07-03 확정)]**
- 전제: 고객=교사 B2B. 무료=현행 전부(개인 API 키).
- 유료 후보(교사 개인 구독): ①키 없이 바로 사용(AI 비용 대납 → 온보딩 최대 이탈 지점 제거) ②검증 수업·창체 레시피 팩(C방향) ③성장 리포트 PDF 내보내기(상담·생기부용). 이후 학교 라이선스(증빙=동의서 인쇄, 학년 넘는 성장 데이터).
- 실행 순서:
  1) ✅학년별 채점 차등은 데이터로 기각(2026-07-03): 학년내 반편차(σ8~12, 6학년 35~90점)가 학년간 차이(4~10점)를 압도. 점수 연속성 깨는 비용 > 효과. 대체 = 학년 맥락 보정(step345·346, 채점 불변).
  2) ✅유료 경계 결정 완료(2026-07-03) — ★실행 보류: 지금은 유료화하지 않음. 기능·사용자 축적 우선. 아래는 실행 시점에 꺼내 쓸 확정안.
     - 구조: 단일 구독 '다온클래스 플러스'. 크레딧은 핵심 기능에 부적합(사용 계량 불안이 매일 쓰는 습관을 죽임 — 경쟁사 한도 과금 기각과 같은 논리). 크레딧은 고원가 단발 작업(손글씨 일괄 스캔 등) 애드온 전용으로만.
     - 가격(가설, 사전 신청 카드로 검증 후 확정): 월 4,900원 / 연 39,000원. 연간을 전면에('1년 39,000원, 하루 100원꼴' 프레임). 근거: 교사 자비 결제 심리 저항선 ~5천원, 원가 여유 커서 이 단계는 ARPU보다 전환율·입소문 우선.
     - 파운딩 멤버: 대상=출시 공지일 이전 가입+학생 1명 이상 등록 교사(SQL 일괄 판정). 혜택=첫해 연 19,000원+향후 가격 인상 미적용. 구현=profiles 플래그, 결제 시 자동 적용(쿠폰 마찰 없음). 공지 프레임='무료는 전부 그대로 + 새 층 추가'(유료 전환 아님을 명확히).
     - 신규 기능 3바구니 판정 규칙(앞으로 모든 새 기능에 적용): ①매일 습관·학생용·네트워크 효과 기능→무료(성장 엔진, 잠그지 않음. 예: 맞춤법 퀴즈·주제 공유·학생 기능) ②교사 시간 절약·외부 제출 산출물·번거로움 제거→플러스(예: 키 대납·레시피 팩·성장 리포트 PDF·수행평가 모드) ③AI 원가 크고 가끔 쓰는 단발 작업→크레딧 애드온(예: 손글씨 일괄 스캔. 구독자에게 월 소량 기본 제공). 기존 무료 기능 소급 잠금 없음.
     - 실행 시점 첫 걸음: 사전 신청 카드('플러스 준비 중'+가설가+신청 버튼 클릭 기록)로 수요 검증 → 신청률 보고 PG 연동 착수.
  3) (실행 보류 중 — 2번 확정안 참조) 결제 최소 구현(국내 PG+구독, 소셜 로그인 동시).
  4) 병행: A2(재확인 SQL 통과 시)·알림 센터 설계.
- 원칙: 유입·정착 기능(손글씨·퀴즈·시사 등)은 의식적으로 후순위(그 칸은 이미 강함).

**[퍼니훈님 아이디어 백로그 (2026-07-02)]**
- 학년별 채점 기준(4/5/6학년 차등) → ✅데이터로 기각(2026-07-03, 위 로드맵 1 참조). 대체=학년 맥락 보정(step345 완료).
- 이전 피드백 반영 여부 (퍼니훈님, 2026-07-03): 1단계(안전) = 다시쓰기 채점 시 이전 피드백을 컨텍스트로 전달, 점수 불변, 피드백에 '지난 피드백 반영' 코멘트 섹션 추가. ⚠️prompts.server.js 수정이라 병렬 맞춤법 세션과 조율 후 착수. 2단계(별도 설계) = 배점화 여부 결정. 기존 점수 체계 보존 위해 별도 보너스 분리안 검토. 채점 일관성 주의.
- 통합 알림창+실시간 채팅(학생↔담임만, 교사↔관리자. 기존 알림 센터 백로그와 통합. 아동 안전·PII 설계 필수, 알림 먼저→채팅 2단계) → 별도 설계 세션
- 손글씨 스캔 업로드(저학년, Gemini 이미지 인식) → 백로그
- 맞춤법 퀴즈(쌓인 교정 데이터 재활용, 빨리 끝낸 학생용) → 백로그
- 시사·뉴스 기반 주제 추천(저작권 주의: 기사 원문 제공 불가, AI가 초등용 재구성한 읽기 자료+주제 방식) → 백로그
- 자유 글쓰기/수행평가 글쓰기 구분(주제 유형 태그부터 시작 가능) → 백로그
- 개인별 데이터 기반 피드백(어휘 다양성·문장 변화·자주 틀리는 유형·강점. ※심리 진단/뇌과학 분석은 미성년 민감정보·정확성 리스크로 기각, 이 방향으로 흡수) → 백로그
- 장기 비전: 학년이 바뀌어도 이어지는 성장 데이터 구조(인재관리 시스템의 첫 벽돌) → 장기
- ★운영 원칙: 화면 배치 변경은 배치안을 먼저 사용자에게 컨펌받은 뒤 지시문 작성(step335 순서 재배치 → step336 원복 교훈).

**[지금 진행 중 — 새 대화 1순위]**
- A2 — "N명 사용" 배지 + 인기순 정렬 (topic_copies). **[2026-07-01 데이터 확인 완료 → 대기 확정]** 결과: total_copies 11 / distinct_copiers 8 / distinct_sources 11. 원본 주제 11개가 각각 딱 1번씩만 복사됨 = **"여러 명이 쓴 인기 주제"가 0개.** 지금 만들면 "N명"의 N이 다 1이라 초라(역효과). → 인기 주제 생길 때까지 대기. 재확인: select source_log_id, count(*) from topic_copies group by 1 order by 2 desc; 상위 2 이상이면 구현.
- 출처 추적 확장 (선택): step307로 admin 조회 뷰는 완료. 단 **"공유 가져오기 버튼"으로 온 것만 잡힘**. 강수현 케이스처럼 남의 주제를 눈으로 보고 직접 입력한 복사는 topic_copies에 기록 안 됨. 이걸 잡으려면 (가)가져오기 버튼 유도 or (나)사후 내용매칭 필요. ⚠️(나)는 AI추천으로 우연히 같은 주제 받는 경우와 구분 안 돼 위험(틀린 추적). A2와 묶어서 판단 — 지금은 보류.

**[대형 항목 — 별도 설계 세션 필요]**
- ★ 범용 알림 센터. **✅1차 완료(step348): 교사 알림 3종(맞춤법 완료·신고·관리자 답장), 헤더 🔔+60초 폴링, notifications 테이블+RLS+create_notification RPC 배포됨.** 남은 것: 2차=학생 알림 확장, 3차=실시간 채팅(별도 설계 세션, 아동 안전·PII). ※발단: 맞춤법 토스트를 "딴 글 보다 돌아가는" 용도로 쓰다가 "모든 알림 통합" 니즈로 확장됨.

**[수익화 — 의사결정]**
- → **★수익화 로드맵(§13 상단, 2026-07-03 확정)으로 통합.** 방향 C(레시피 팩)는 로드맵 유료 후보 ②로 흡수. 문집 등 학생·학부모용 가치는 철회(교사 지불동기 약함, 교사 본인이 편해질 때만 지불).

**[대기]**
- ⚠️ DB 부분 UNIQUE 인덱스(중복 후속, 보류): (user_id,topic_id,attempt) where deleted_at is null로 걸려 했으나, 별개 글 8건이 제약과 충돌. md5(essay_text) 유니크 대안 검토했으나 미적용. 현 방어=step283 코드 가드뿐(한-화면 연타만). "두 기기/두 탭 동시 제출"은 무방비. 급하진 않음.
- 회색지대 G1·G2(발견성 배지·admin 집계뷰).
- 맞춤법 전체일괄(step293 runGrammarBatch, 학생글보기 주제헤더 + grammar-backfill 페이지 + 대시보드 툴바) — 단일검사(step295~301)와 공존 중. 셋 다 유지할지 grammar-backfill 페이지 정리할지는 추후 판단.

**[보류]**
- 전체 UI 폴리시(기능 안정 후) / A3 교사 평판 표시(개인정보 trade-off).

**[종료 — 다시 만들지 말 것]**
- ✅ 교사 대시보드 신규/정착 분기 — step316 setupDone 기반 구현됨(step335 순서 재배치→step336 원복 이력).
- ✅ 그레이존 판단 UI 리파인(step349, 개별 확인 다이얼로그·일괄 제거·0명 안내).
- ✅ mergeCorrections 서버 이전(step350, ai.js 병합·클라 6곳 제거 — 아래 후속 작업 A 완료).
- ✅ QR 로그인 개선(step352·353, 명렬표 분기·회원가입 탭 숨김·번호→아이디 자동완성·존댓말).
- ✅ **동의서 일괄 인쇄(step337)** 감사 증빙 1인 1페이지(동의 완료=valid만). print.js 신설 + ConsentDocument `bulk` prop. 권한=submissions와 동일(getEffectiveProfile+RLS+임퍼소네이션 PII 차단).
- ✅ **학생 랭킹 3등 압축+내 기록/전체보기(step337)**.
- ✅ **온라인 동의 화면 B안 재배치(step340·341)** 히어로 안내보내기(①복사→②하이클래스 단계유도) + 안내문·비밀번호 접힘 카드. step341: 복사 후 강조 유지(copiedAnno 자동해제 제거, 저장 시 리셋) + 접힘 어포던스.
- ✅ **성장 그래프 3단 재설계(step342·343)** 결론 카드 + 상대성장 그리드/스파크라인 + 개별 모달(◀▶·Esc·방향키). 지표=상대 점수(최종−학급평균), 판정 ±3. 로딩·인증·displayName 불변.
- ✅ **동의서 이름 칸 실명 전용(step344)** 미동의 학생은 닉네임 폴백 대신 빈칸(ConsentDocument 안에서만 규칙 교체, 헬퍼 불변).
- ✅ **이번 세션 트랙 B — 문구 두괄식 + 구조 분리 (step302~303):**
  · step302 대시보드 배너 2개(심의·동의) 두괄식(결론 먼저) + 대시(—) 제거 + 학생 로그인 안내 2구획(📄학생용 안내문+복사 / 🧑‍🏫선생님 안내방법+설정버튼, 파란/amber 배경). index.js·StudentLoginInfoCard.js. 로직 불변.
  · step303 동의 허브(students/consent.js) 3구획 대등 카드(🔗온라인/🖨종이/📄제출) + 인트로·ConsentPanel 배너 두괄식 + 안내문복사vs하이클래스 "안내문 보내기" 박스로 시각분리(용도 설명 포함). ConsentPanel 소비자 consent.js 단독 확인. GrayZonePanel 불변.
  · ★두괄식 원칙: 결론 먼저, 대시(—)·과한 콜론 금지, 짧은 문장, AI 티 안 나게(선생님 말투).
- ✅ **이번 세션 맞춤법 트랙 (step293·295·297·299·300·301):**
  · step293 전체일괄 검사를 학생글보기 편입(백그라운드·비차단, 우하단 토스트). grammar-backfill 루프 재사용.
  · step295 단일 글 "🔍 맞춤법만 다시 검사"(recheckGrammarOne) — 배너 "다시 평가하기" 옆, 첫글/수정본 각각. corrections만, 점수 불변.
  · step297 토스트 문구(N번 학생명·첫글/수정본·교정 X→Y개, 마스킹 준수).
  · **step299 핵심 — 단일검사 품질을 정식검사와 동일화.** 원인=grammarOnly가 정식과 3가지 다름(경량 프롬프트 / temperature 0.7 / 구모델 gemini-2.5-flash). 해결=CORRECTIONS_RULES 상수를 gradingPrompt에서 바이트동일 추출(단일소스) + grammarStrict 타입 신설(taskType 'grading'·temp 0·같은 모델). recheckGrammarOne만 grammarOnly→grammarStrict. **전체일괄(runGrammarBatch)은 grammarOnly 그대로**(채점 500 RPD 풀 보호). lib/prompts.server.js·pages/api/ai.js·submissions.js.
  · step300 토스트 클릭→그 학생 글 이동(토스트 {msg,targetStudentId} 객체, goToGrammarTarget이 topicStudents에서 최신 corrections 그룹 조회 후 openStudent 재사용). 전체일괄 토스트는 targetStudentId 없어 비클릭.
  · step301 토스트 조기소멸(1~2초) 버그 — flashGrammarToast가 호출마다 clearTimeout 없이 새 setTimeout 겹쳐 걸어 A→B 연속검사 시 낡은 타이머가 새 토스트 지움. useRef(grammarToastTimer)로 이전 타이머 clear.
- ✅ **이번 세션 화면 정리 (step289~294, 296, 298):**
  · step289 학부모 동의 노출 2곳 제거(ClassSettings·대시보드 카드) — students/consent.js로 일원화. GrayZonePanel/ConsentPanel은 consent.js에 존재해 유실 없음.
  · step290·291 교사 대시보드 우측 세로 툴바(데스크탑 lg+만, 모바일 현행). 패널 3개(로그인/키/설정) 단일 aside 드로어, activePanel로 버튼별 1개만. 라벨 풀어씀(step292 w-24: API 키 관리/학생 로그인 안내/학급 설정/오류 신고함/맞춤법 일괄 검사/삭제된 글 확인/도움말). 신고함·쓰레기통·도움말도 툴바로(lg:hidden). ★SetupChecklist 동선 guideToPanel 재연결, 임퍼소네이션 가드(🔑/⚙️ = !isImpersonating).
  · step292 동의서 인쇄화면 동의현황(미동의 N명, getEffectiveProfile·consentStats).
  · step294·296·298 동의서 인쇄 양식 정렬 — step294 ConsentDocument props 제거(빈양식 복구, step292 부작용). ②학년/반 채우기는 step296(grade+className 넘김, 지난번 grade 없이 className만 넘겨 깨졌던 것 수정). ①밑줄 격자정렬 step298(sign-line min-height→height 고정 1.6rem, "(인)" justify-end. em이 폰트크기 상대라 11px칸만 짧던 것). ConsentDocument는 공용(서명이미지는 순수 img라 고정높이 영향 없음).
- ✅ step285~288(맛보기 펼치기·admin 휴지통토글·대시보드 배너·등록 deeplink), 학생 중복제출 정리(91행 hard delete, 1437명 영역), step283 클라 가드, step280~282 맛보기 샘플카드. (상세는 git log)
- ❌ 맞춤법 누락 자동수집(폐기, 규칙보강으로 대체).

## 맞춤법 파이프라인 완성 작업 (별도 세션 — ai.js·student/index.js 다른 작업 정리 후 착수)

목표: 첫 글↔수정본 검출 들쭉날쭉 제거 + 브라우저 옛 번들 잔재 문제 근본 해결.
순서 중요: 반드시 A → B 순서로 (A로 옮긴 서버 코드 위에 B를 얹어야 이중작업 없음).

### A. mergeCorrections 서버 이전 — ✅ 완료(step350)
- 현재 mergeCorrections는 클라이언트 5곳에서 실행됨 (student/index.js 532·805, grammar-backfill 147, submissions.js 614, regrade.js 125) — 배포해도 옛 탭은 옛 규칙 사용.
- pages/api/ai.js에서 corrections를 생성하는 type(grading, rewriteGrading, regrade, grammarOnly, grammarStrict) 응답 반환 직전에 mergeCorrections(result.corrections, essay)를 서버에서 수행하도록 이전.
- 클라이언트 5곳의 mergeCorrections 호출 제거 (서버가 이미 병합한 결과를 받으므로).
- 하위호환 주의: 배포 순간 옛 클라이언트(병합을 자기가 함) + 새 서버(이미 병합함)가 겹쳐도 mergeCorrections는 멱등(두 번 돌려도 결과 동일)이라 안전 — 단, 커밋 전에 멱등성 실제 검증 필수.

### B. 수정본 채점에 이전 corrections 승계 (= 이전 피드백 반영 1단계)
- 상태: A(서버 이전) 완료로 토대 마련됨. prompts.server.js는 병렬 맞춤법 세션(step351·354·355)이 최근까지 활동 — 그 세션 종료 확인 후 착수.
- 목적: "첫 글에서 잡힌 오류가 수정본에서 사라지는" 방향의 들쭉날쭉 제거 (검출 단조증가 보장).
- student/index.js: callAI('rewriteGrading', ...) payload에 prevCorrections 추가 — 이미 상태에 있는 첫 글 corrections에서 {original, correction}만 추림 (프롬프트를 짧고 명확하게 유지하기 위함).
- pages/api/ai.js: prevCorrections destructure (선택 필드, 없어도 에러 아님 — 하위호환).
- lib/prompts.server.js rewriteGradingPrompt: prevCorrections 인자 추가 + "이전 검사에서 아래 표현이 오류로 지적됨. 수정본에 같은 표현이 남아 있으면 반드시 다시 포함, 고쳐졌으면 포함 금지" 블록 + overall '좋아진 점'을 이 목록 근거로 연결. CORRECTIONS_RULES 상수는 불변.

### C. 맞춤법 품질 모니터 (오교정 자동 감시 — 사람이 챙기지 않아도 되게)
- 배경: 오교정("않기→안 기" 등)이 6/29부터 쌓였는데 7/2에야 우연히 발견됨. 현재는 수동 SQL 감시 쿼리(주 1회 Run)로 대응 중이나 사람 기억 의존이라 지속 불가.
- C-1: correction_alerts 테이블 신설(submission_id, original, correction, reason, 의심유형, created_at, resolved). pg_cron으로 일일 스캔 — 의심 패턴: correction이 '안 '+어미(불가능형태), reason에 존댓말/문체(문체개입), original 대비 correction 길이 +15자 초과(과도한변형). 기존 cron-trash-cleanup 패턴 참고.
- C-2: 서버(pages/api/ai.js)의 fail-safe 필터(isImpossibleCorrection)가 교정을 폐기할 때 같은 테이블에 기록 — AI의 오교정 시도가 자동 수집되어 프롬프트 이상 조기 경보 역할.
- C-3: 관리자 페이지에 "의심 교정 (N)" 배지/탭 — 미해결(resolved=false) 건수 표시, 목록 확인 후 해결 처리. 기존 "에러 (N)" 탭 패턴 재사용.
- 효과: 오교정 발견이 "우연"에서 "익일 자동"으로. 운영자가 챙길 루틴 0.

### 공통 안전 규칙
- 커밋 게이트: 규칙/프롬프트 변경 시 정상 문장 오탐 0 + 기존 검출 유지 검증 통과 후에만 커밋 (이번 세션 step322·324·327 방식).
- 6975 학급 시연 필수: 오류 포함 첫 글 제출 → 일부만 고쳐 수정본 → 안 고친 오류가 수정본에서도 잡히는지.
- 학생 페이지 수정은 최소한으로, 제출·저장 로직 불변.

## 워킹트리 상태
- HEAD=b34bcbf(step307)까지 전부 커밋·push 완료. origin/main 동기화 확인됨.
- 이번 세션(step289~307) 커밋 완료. step304 CLAUDE.md·step305 핸드오버·step306 SetupChecklist·step307 admin 공유추적.
- ⚠️ **병렬 맞춤법 세션 진행 중**(별도 대화+Code, koreanRules.js·prompts.server.js). 그쪽 커밋이 섞여 들어올 수 있으니 다음 세션 시작 시 git log로 최신 상태 먼저 확인. 이 세션에서 커밋할 때도 git pull --rebase 먼저.
  · 이번 세션 커밋: step289 2529c50, step290 173c388, step291 3fb7841, step292 f021cc6, step293 e13c820, step294 1681eb5, step296(sign-line)·step297·step298(밑줄정렬)·step299 ffce2e4·step300 95b061d·step301 35dd489, step302 5b2e34f, step303 1694ea7. (일부 커밋해시는 §1 참조)
  · step284는 SQL 정리에 예약된 번호(코드 커밋 아님 — 91행 hard delete는 수동 SQL).
  · ⚠️ Code가 커밋 후 push 빠뜨리는 경우 있음(step299에서 발생) — 커밋 지시 시 "push까지" 명시할 것.
- untracked(미커밋, 급하지 않음): `_report*.md`(19개), `_snapshot/`, `FEATURE-MAP.md`, `scripts/make-snapshot.js`, `migrations/step205·206-*.sql`. 세션 정리 시 .gitignore 처리 판단.
