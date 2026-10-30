# 핸드오버 데이터 (HEAD = 8375d65 (step652, main) + 이 갱신 문서 커밋(step653). ⚠️번호 중복 4건(10/28~30 병렬): 649(spell 1b42105 복합어분리 / main 7607417 신고 사유 칩) · 637(spell bfbdd5a 문체 한 방향 / main 2cf6264 학생 진입 A) · 641(spell 4b713eb 학년 인자 / main e6ac481·b822e64 auth-bounce) · 644(spell fac04c4 교정 규칙 정합 / main 1aede54 429 판정). 640은 spell e485d18 단독(main의 640 작업은 641로 번호 이동). 616~635 구간 0건. 이전 중복 step611 spell c88edb0(핸드오버 문서) / main 8fd8149(전국 주제 카드) · step608 spell f957602(규칙 (타)(파)) / main fb7dc11(lib/changeFacts.js·notationOnly). 597·598은 §1 595~601 블록, 590·591은 §1 582~593 블록 참조. 해시가 권위)

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
- **검증 원칙(10/15 확정)**: 6975는 **장난 글 재현 전용**. 일상 검증 = **엿보기(보기) + 본인 반(누르기)**. UI 커밋은 verify-ui-change 스킬 + 실제 화면 열어보기(빌드 통과만으로 완료 보고 금지).

**소통 톤:** 결정·지시·결론은 짧고 직설. 원인 분석·설계 설명은 쉽고 자세하게(구조·예시). 존댓말·비서 포지션.
> 스냅샷 4개(`_snapshot/SNAPSHOT-{pages,components,lib,migrations}.md`)는 `node scripts/make-snapshot.js`로 최신화(로컬 산출물, step356에서 추적 제거 — gitignore라 커밋 불가).
> 💻 컴퓨터 경로 리마인드: 집 PC 워킹디렉토리는 `C:\Users\ddh91\Documents\GitHub\literacy-class` (학교 PC와 폴더 경로 다름 — 세션 시작 시 pwd 확인).

## 1. 현재 HEAD
> **[다음 세션 시작 안내 — spell]** (10/15 갱신: spell 622 문체 통일 결정화·623 띄어쓰기 글자 보존 + main 624 styleUnify 표식 — 아래 §1 616~625 블록과 §13 10/8 블록 게이트 현황이 최신. spell 백로그 1건 = 체크리스트 ④ 수정본 무감점 범위에 문법·활용 오류 명시.) spell 백로그 0건, 관찰 모드. **관찰 대상 최신판은 §13 [★spell 갱신 2026-08-24] 블록이 권위**(이 줄의 구판 목록 대체). ✅step560 '문체역행' dropped 기록은 8/21 송림초에서 첫 등장 확인(필터가 실제로 막는 정상 신호 — 이중 방어 검증 완료·종결). 잔여 관찰: step521 종합의견 사유 / '거→것' 재발 / step542 불가능형태 / step550·555·556·559 효과(만점·95점 이상 비율 추이, '완벽'류 소멸) / 섞인 문체 재검출(step577) / 신규 규칙 7종(step575) / '밖에' 소멸(step576). 새 재료 나오면 기존 순환(확인→원류 차단→게이트 편입)대로. **수단 A(미검출 전수조사)는 월 1회 재실행 권장 루틴.**
> ⚠️ **문체 오교정 방어 변천 요약(step393~409→560)**: 프롬프트 규칙 11(예방)과 koreanRules `isStyleChange`(fail-safe 차단+기록)의 왕복이 있었다. isStyleChange 필터는 step409에서 최종 제거(옳은 통일 지적·맞춤법 교정까지 오차단). 이후 프롬프트 측 방어는 규칙 11 step403판(4원인 차단)+규칙 12(NO_CORRECT_LIST, step443~485 — 반말→존댓말 단정 금지 편입)로 확장. **현재 상태(step560) = 프롬프트 예방에 더해 코드 레벨 결정적 차단이 재도입됨. 단 과거 필터와 달리 문장 단독 판정이 아니라 essay 문체 다수결(countSentenceStyles, 반말 압도일 때만) — 섞인 글 통일 지적·오타 교정은 보존.** 아래 개별 항목은 이력이므로 최신 결론만 볼 거면 이 줄과 §7·§13을 보라.
- **★완료 트랙 step653~661 (2026-10-30 오후, 가시성 3건 / 관리자 엿보기 상위 글 창 수리·열람 계측 / spell 문체 방향 왕복 종결·'아니다' 정합)** — 커밋 단위 요약(전부 push 완료, git log 8375d65..origin/main **11건** 전수 대조로 미기재 0):
  - `a557215` step653(main): 핸드오버 추가(637~652 트랙 + §13 [★초안 유실 사고] + 배포 규칙 09~15시 밖 + ⑪ 서버 측 초안 저장 검토). 문서만.
  - `b52ed9c` [spell] step653: **문체 통일 방향을 존댓말 우선으로 고정(존댓말→반말 금지)** — 반말 다수 글에서도 존댓말 소수 문장은 두고, 반말→존댓말 통일 문구를 허용. (→ 656에서 철회.)
  - `1f2bf55` step654: **관리자 "⏱ 채점 시간" 칩 가독성** — 전문 용어 제거: 머리 한 줄 문장(`lib/gradingTiming.js` headlineOf·interpretTimings·fmtSecKo), 열 이름 보통(절반)/거의 모두(95%)/가장 오래/1분 넘음 + ⓘ 툴팁, 경로 칩 툴팁, 0은 초록, 표 아래 한 줄 해석. gate-grading-timing 22→25. 집계 로직 불변.
  - `424904b` step655: **교사 글 모음 가시성** — 학생 글 보기 주제 상단 "📚 지금 반 친구들에게 보이는 글 (N)" 묶음(순위·실명·닉네임·점수·자동/선생님 선택·🙈 빼기=기존 togglePeerShare) + 👀 학생이 보는 화면 미리보기(PeerShareCard, 닉네임만) + 교사 홈 "오늘 N건 제출" 펼침에 "📚 친구들에게 보이는 글 N편 → 학생 글 보기". 선정 알고리즘·API 불변.
  - `d1f114d` [spell] step656: **반말 위주 글 문체 교정 양방향 금지로 복귀(653 허용 문구 철회)** — 637 원칙(반말 다수 글은 문체 교정 0)으로 되돌림. 10/30 반말 위주 글 "아니다→아니에요" 10건이 계기.
  - `5d33f2c`+`1009513` step657(main): **관리자 오류 탭을 사람이 읽는 형식으로** — `lib/errorHumanize.js`(순수: mergeLogs 같은 사용자·작업·60초 안 클라 ai_call+서버 api_error 쌍·반복을 한 카드 "N번 시도", 대표 로그=upstream 동봉 서버 로그 우선, 번역표 happenedOf 안전/네트워크/타임아웃/503/429/JSON/진입 사유, seenOf 학생 체감 문장, groupByDay KST·같은 학급 3건 이상 묶음 머리, daySummary) + gate-error-humanize 19. 탭: 오늘 요약 줄·날짜 구분선·조치 필요만 펼침·무시 가능 `<details>`·영어 원문·JSON은 "자세히 ▸". 기록 구조·분류기·필터 불변. 1009513은 주석 번호 정정(spell 656과 충돌).
  - `be31a9d` [spell] step658: **문체역행 필터를 반말 다수 글 전체로 확장**(발동 조건 formal≤1 → plain>formal) — 반말 다수 글의 반말→존댓말 교정을 코드 레벨에서 전부 차단(drop_reason '문체역행').
  - `aadfef2` [spell] step659: **'아니다'를 반말 종결로 분류** — countSentenceStyles·isStyleRegression에서 '아니다' 끝을 '니다' 존댓말 규칙보다 먼저 반말로(분포·문체역행 사각지대 제거). 핸드오버 §13 "아니다→아니에요" 10건의 원류.
  - `86ea654` step660(main): **관리자 엿보기 상위 글 창 0편 수리 + 학생 열람 계측** — 원인: `supply-ranking.js` admin 분기(step582)가 동결본 없으면 `winners: []` → 관리자 소개 글 패널 12편(승인 11·거절 1)인데 학생 엿보기 창은 "아직 소개할 글이 없어요"(학생 본인 계정은 3편 정상, 김서환 조건 재현). 수리: `lib/showcaseRanking.server.js` peekShowcase(aggregateShowcase를 rankPool·attachEssays·loadShowcaseRows로 추출, 같은 풀·순서·후보, showcase INSERT·AI 검토·동결 쓰기 0) → admin도 승자 3명 + `adminPreFreeze` 유지 → 학생 모달·TeacherShowcaseModal 안내 1줄 "엿보기 화면이에요. 아직 검토 전인 글은 여기 표시되지 않아요." 계측: 학생 본인 토큰 + `view:true`(창 열기만, fetchMyRank·history 제외) + winners≥1 → `supply_showcase_views` 1행(student_id·supply_topic_id·created_at) + `migrations/step660-supply-showcase-views.sql`(**적용 대기**) + 관리자 패널 "👀 학생 열람 N회". 소개 창 성공 열람 기록은 이전엔 없었음(peer_share_views는 글 모음 전용).
  - `b4d2be7` step661: **styleUnify 끝맺음 판정에 '아니다' 예외·끝 기호 ; : 추가(spell 659 정합)** — `lib/styleUnify.js` endsFormal/endsPlain '아니다' 끝=반말, TAIL_RE에 ; :("할것이다.;" 표식 누락 3건 해소). 표식 조건·순서·필드 불변. gate-style-unify 12→17.
  - ⚠️ **번호 중복 3건(해시가 권위)**: 653(spell b52ed9c · main a557215) · 656/657(spell d1f114d=656, main 5d33f2c는 656으로 커밋 뒤 657로 주석 정정) · 658(spell be31a9d. main의 "step658 지시"는 660으로 이동). 이력 순서는 b52ed9c→a557215→1f2bf55→424904b→d1f114d→5d33f2c→1009513→be31a9d→aadfef2→86ea654→b4d2be7.
  - 10/30 분석(커밋 없음, `_last-report.md` 참조): ⓐ 소개 창 선정 조건 전수표·깔때기(뽀로로반 33→16 approved, 0 되는 단계 없음) ⓑ 동의 기준 불일치 consent_received(ConsentPanel) vs realname(소개 창) — 현재 1명 ⓒ 날짜 비교는 전부 KST(`lib/kstDate.js`·`showcaseRanking.server.js:13-16`).
- **★완료 트랙 step637~652 (2026-10-28~30, 진입 속도·튕김 수리 / 채점 지연 분석·측정·수리 / spell 문체 한 방향·무감점 범위·학년 인자·교정 규칙 정합·복합어분리 / 신고 가시성·빠른 엿보기·신고 사유 구조화 / 초안 유실 사고 → 저장 슬롯)** — 커밋 단위 요약(전부 push 완료, git log e32f673..origin/main **21건** 전수 대조로 미기재 0):
  - `2cf6264` step637(main): **학생 진입 수리 A** — `/api/supply-adopt`를 비차단으로(응답 adopted에 방금 받은 오늘 주제에 없는 id가 있을 때만 챌린지 카드 1회 재조회, 주제 선택·글 불변) · `lib/entryAuth.js` 신설 `queryWithAuthRetry`(진입 profiles 조회가 401/PGRST30x/JWT면 refreshSession 1회 → 같은 조회 1회 재시도, 학생 홈·getEffectiveProfile·관리자 홈 3곳) · `logAuthBounce`(로그인으로 보내기 직전 error_type `auth_bounce`, 분류기 "🟤 진입 튕김" 조치 필요, gate-safety-block 59) · `Promise.allSettled` 1건 → `Promise.all(map catch)`(iOS 12).
  - `06fd1f7` step638: **교사·관리자 진입 수리 B** — 교사 홈 직렬 11왕복 → 2라운드 병렬 3왕복(topics count 중복 제거, 조회별 safe 분리) · 관리자 loadAll 직렬 14 → 첫 배치 13 병렬(15→2왕복), 담임·작성자 학급은 첫 배치 전량에서 매핑, 추천 공유·주제 공유 추적·비번 요청·에러로그 학생 번호는 해당 탭 첫 진입 때 로드(loadAll 재호출은 로드된 것만 갱신). error_logs는 "24h 에러" 카드 때문에 첫 배치 유지(지시 대비 차이) · getUser → getSession(getEffectiveProfile·관리자 checkAuth, 소비자 25곳 확인. 교사 홈 복구 이메일 판정만 getUser 유지).
  - `4b64165` step639: **진입 측정 C** — `@vercel/speed-insights` ^2.0.0 + `_app.js` `<SpeedInsights />` · 교사·관리자 홈에 학생 홈과 같은 `[perf]` 로그(profile·라운드·총계).
  - `bfbdd5a` [spell] step637: **문체 통일 강제를 반말→존댓말 한 방향으로 제한** — `buildStyleLine` minority==='formal'(반말 다수·존댓말 소수) 분기 신설: "반말 위주의 글입니다. 문체 교정을 하나도 만들지 마세요. … 독자에게 말 거는 문장·부탁·인용은 존댓말로 둬도 됩니다." 반환. 존댓말 다수→반말 소수 통일 강제·동률·단일 문체 분기 불변. 배경 10/14~28 반말 위주 글의 반말→존댓말 10건·존댓말→반말 어색 7건. gate-prompts 163→168.
  - `e485d18` [spell] step640: **수정본 신규 무감점 범위에 문법·활용 오류 명시** — 수정본 채점 (마) 첫 문장 "맞춤법·띄어쓰기·문장부호 오류" 뒤에 "와 문법·활용 오류(어미나 조사를 잘못 쓴 것. 예: '놀는게', '먹을려고')" 삽입(계약 2.0 원칙 ③, 10/15 하락 1건 70→65 '놀는게'). gate-prompts 168 유지(계약 문구 39→40), korean 200 유지.
  - `e6ac481` step641(main): **진입 튕김 익명 기록 API** `pages/api/auth-bounce.js` — 토큰 불필요(세션 없음·토큰 거절 튕김도 기록), 서비스롤 insert, step165 api_rate_limit 패턴 버킷 `auth_bounce` 분당 30·일 300/IP, 입력 화이트리스트(reason·screen·status·code 40·error 200·role), user_agent는 요청 헤더, role 'unknown'·user_id null(PII 없음) · `logAuthBounce`를 이 API 호출로 교체(발사 후 망각·같은 screen|reason 60초 1회) · 세 홈 no_session도 기록 · `cron-trash-cleanup` api_rate_limit 2일 정리.
  - `b822e64` step641: 주석 번호 정정(e6ac481 안의 'step640' → 'step641', 병렬 세션 640과 충돌 해소). 주석만.
  - `d9d50cb` step642: 핸드오버 갱신(637~641 트랙 7건 + §13 문체개입 판정 정정 블록 + 체크리스트 ⑤⑥ 종결 + 게이트 10/29 + 번호 규칙). 문서만.
  - `2b404cc` step643: **채점 대기 시간 실측** — `migrations/step643-grading-ms.sql`(submissions.grading_ms integer·grading_path text, 선택 적용·멱등, **10/29 적용 완료**) · `lib/gradingTiming.js`(순수: deriveGradingPath 우선순위 error_then_retry>fallback>retry_N>pending>inline, summarizeTimings 일별 KST·학급별 n/p50/p95/max/60초 초과, nearest-rank) + gate-grading-timing 22 · `lib/gemini.js` 성공 반환에 `__attempts` 메타(총 시도 수, 로직 불변) · 학생 홈: 측정 시작=확인 대화상자 통과 직후(연타 잠금 자리), 종료=callAI 반환, insert 뒤 별도 update(컬럼 미적용이면 실패 무시), gradeFailRef로 실패 후 재시도 판정, 안전 필터 차단 저장은 미측정 · 관리자 의심 교정 탭 "⏱ 채점 시간" 칩(최근 14일, class_id만, 3,000건 상한 — 머리 요약·경로 분포·일별/학급별 표, 60초 초과 빨강). 지시 대비: 시작점을 버튼 클릭이 아닌 대화상자 통과 직후로.
  - `4b713eb` [spell] step641: **채점·수정본 채점·예시 글 프롬프트의 "초등 5학년" 고정을 학급 학년 인자(grade)로** — `gradeWords(grade)`(1~6 정수 외·미전달 → 5), gradingPrompt·rewriteGradingPrompt·exampleEssayPrompt에 `grade = null` 인자, correctionsRules에 `{ grade }` 옵션(규칙 5). 미전달 시 바이트 동일. gate-prompts 168→175. 호출부 연결은 main 645.
  - `1aede54` step644(main): **AI 429 판정을 errorDetails로 + 일일 한도 서버 기억 + 수정 화면 예시 버튼** — `lib/quotaError.js`(순수: classifyQuotaError — quotaId PerDay=일일·PerMinute=분당, 메시지 꼬리 JSON 복구, legacy 'per day'만; retryWaitSec — retryDelay 올림·상한 20초, 없으면 3·6·9; nextPtMidnightMs) + gate-quota-error 19 · `lib/gemini.js` callGeminiStructured: 일일 판정·대기 교체(분기 구조·maxRetries·타임아웃 불변 — 바뀐 동작은 "분당 429가 즉시 폴백 대신 백오프"와 대기 시간뿐), 한도 기억을 서버 모듈 Map `${hashKey(apiKey)}|${model}` → PT 자정 TTL(키별, 종전 window 가드 no-op 수리), getQuotaHitModels(apiKey)·markQuotaHit(apiKey, model) 서명 변경 · 학생 홈 `showDeferredExample` 공용 핸들러 + 수정 화면(step 'rewrite') 예시 블록 3분기(만드는 중/본문/보류 안내+📖 예시 작품 보기). gate-safety-block 59 유지. 503→폴백 전환은 보류. **작업 2 보고 정정**: SDK는 details를 메시지에도 덧붙이며 실제 버그는 분당→일일 오판이었다.
  - `fac04c4` [spell] step644: **수정본 채점 corrections 규칙을 첫 글 correctionsRules 단일 소스로 정합** — 자체 7항 + 헤더 [문체 분포]/[띄어쓰기] 주입 제거, `correctionsRules(rewriteEssay, { grade, subject: '수정본' })` + "13. 같은 오류가 여러 번 나오면 각각 다 잡으세요" 로 교체(최소 교정 (라)·표현 제외 (다)·규칙 4·9·10·11 포함). correctionsRules에 `subject` 옵션(기본 '학생 글'이라 grading·grammarStrict·grammarOnly 불변). 직전 지적 재포함 (아) 유지. gate-prompts 175→200(REWRITECORR 6 + BUILD/RULES 합류).
  - `6228b28` step645: **pending 적체 해소 + 학급 학년 서버 조회 전달** — `lib/strictCheck.server.js` partitionSweep(순수: 24시간 지난 pending은 교사당 상한 무관 전부 만료, 보완 대상만 교사당 4) + sweepPending 2단계(ⓐ 만료 일괄 skipped update 1회·in 절 500·summary.expired ⓑ 24시간 안·10분 지난 pending 오래된 순 30건 보완) + gate-strict-sweep 5. 배경: 오래된 pending 30건 중 24건이 한 교사라 밤마다 4건만 종결 → 95건 적체 · `pages/api/ai.js` getClassRow(classId: classes.teacher_id·grade, 인스턴스 메모 10분) — grading의 getClassTeacherId 조회를 대체(재조회 0), rewriteGrading·exampleEssay 1회, 세 프롬프트에 `grade`(1~6 정수, 아니면 null) 서버 전달, 클라이언트 payload 학년은 받지 않음(지시 변경으로 학생 홈 payload 수정은 되돌림).
  - `42eaf9a` step646: 핸드오버 갱신(637~645 트랙 13건 + §13 블록 4개 + 체크리스트 ①~⑨ + 게이트 10/29 마감). 문서만.
  - `e7e5b9b` step647: **관리자 "🚨 학생 신고" 행 인라인** — 칩 열 때 1회 조회에 topic_id·report_reason·feedback_overall·total_score·max_score·attempt 추가(글 본문·실명 미조회). 각 행 2줄: 1줄 기존 배지·라벨(담임 엿보기/학생 글 탭, 클릭 불변)·시각 + **"👁 학생 화면"**(새 탭 `/student?as={user_id}&topic={topic_id}` — 633 학생 엿보기 + `?topic=` 딥링크로 그 글의 피드백 화면) + "✅ 해결"(미해결만). 2줄 💬 사유 80자 · 🤖 종합의견 60자 · 점수/만점·N회차(점수 null "🟣 점수 없음").
  - `690a4b5` step648: **관리자 빠른 엿보기 검색** — `pages/api/admin-peek-search.js`(admin-last-logins 인증 관행: getUser → role admin 아니면 403, POST 외 405, 토큰 없음 401. q 2자 미만 → items [], 공백 토큰 전부 포함 일치, 교사 먼저 최대 20건. 교사 `학교 반 · 이름 선생님` → `/teacher?as=` / 학생 `학교 반 N번 · 닉네임` → `/student?as=`. **학생 실명 미반환**) + `components/AdminPeekSearch.js`(SchoolAutocomplete 관행: 300ms 디바운스·2자 최소·늦은 응답 폐기·바깥 클릭·↑↓ Enter Esc, 클릭 → 새 탭) + 관리자 제목 줄 오른쪽 배치. 실검증: GET 405·토큰 없음/잘못된 토큰 401(curl). 관리자 양성 경로는 미검증.
  - `7607417` step649: **피드백 신고 사유 구조화** — `lib/reportReason.js`(순수: REPORT_TAGS 5 = 점수가 이상해요 / 맞춤법 지적이 틀렸어요 / 내 글에 없는 말을 해요 / 무슨 말인지 모르겠어요 / 기타, `buildReportReason` → "[태그] 상세"(40자 절단, 목록 밖 null), `parseReportReason`(구 자유 입력 tag null), `isDailyLimitReached(3)`) + gate-report-reason 9. 학생 홈 "🚨 이 피드백 이상해요" → prompt() 대신 칩 모달(1개 필수, 선택 입력 40자, 엿보기 비활성). 글당 1회(reported)·**하루 3회**(본인 행 reported_at ≥ KST 자정 count, 조회 실패 시 막지 않음) 초과 안내. 저장 컬럼·담임 종·관리자 알림(631) 불변, SQL 없음(report_reason 재사용). 관리자 신고 행 태그 배지. 담임 신고함 표시 불변("[태그] 상세" 그대로).
  - `832e388` step650: 핸드오버 추가(637~649 트랙 17건 + §13 [★신고 144건 판독] + 체크리스트 ⑦ 교체·⑩ spell 이관 3건). 문서만.
  - `1b42105` [spell] step649: **사전 등재 합성어 분리 교정 차단(복합어분리)** — `lib/koreanRules.js` COMPOUND_WORDS 13(어린아이·매일매일·가전제품·여름방학·겨울방학·우리나라·하나하나·이것저것·점심시간·집안일·생일선물·생일잔치·학교생활, 표준국어대사전 등재 합성어만) + `isCompoundSplitCorrection`, mergeCorrectionsDetailed에 복합어분리 필터(drop_reason '복합어분리', 붙이는 방향은 허용 → 왕복 종결). `lib/prompts.server.js` NO_CORRECT_LIST 복합명사 줄을 COMPOUND_WORDS 단일 소스로. 배경: 10/29 신고 판독 오교정 왕복 26건(⑩ⓐ 종결).
  - `6e229f6` step651: **초안 금고 → 게임식 저장 슬롯** — `lib/draftSlots.js`(순수, storage 주입): 키 1개 `draftSlots:{userId}`, upsertSnapshot(현재 슬롯 갱신 / |글자 수−baseChars|≥80 또는 3분 경과면 새 슬롯 / 빈 글 저장 안 함), prune(주제·단계별 5·전체 20), loadSlots(구 `draft:*`·`essay_backup_*` 1회 이관), saveSlots(용량 초과면 절반 재시도, 실패 false) + gate-draft-slots 14. 학생 홈: 구 초안 함수 7개·복원 배너·readDraft 블록 제거, 자동 저장(1.5초·pagehide·**visibilitychange**)은 현재 슬롯 갱신, 제출 성공·차단 저장·수정본 제출 때 그 주제·단계 슬롯 삭제, 저장 실패 1회 안내. **"📂 저장된 글 (N)"** 첫 글·수정본·"주제 없어요" 카드 상시 → 목록(제목·시각·글자 수·첫 60자)·미리보기·같은 주제·단계면 [불러오기](지금 글 있으면 confirm 후 먼저 저장) 아니면 [복사하기]. **오늘 주제 조회 error를 throw → 재시도 화면**(종전 0행 오판 → 빈 화면).
  - `8375d65` step652: **글쓰기 중 새로고침·전환 방지** — `components/VersionChecker.js` isWriting: `body[data-writing="1"]`이면 글자 수 무관 true(자동 새로고침 금지, 배너만). 학생 홈: step write/rewrite+주제 있음이면 body.dataset.writing='1'. `confirmLeaveDraft`(쓰던 글 먼저 저장 → "쓰던 글이 있어요. 다른 주제로 넘어갈까요?") + `switchTopic`으로 주제 전환 버튼 4곳 교체, 쿼리 감시자(종 알림)는 취소 시 URL을 지금 주제로 되돌림.
  - ⚠️ **번호 중복 4건(해시가 권위)**: 637(spell bfbdd5a · main 2cf6264) · 641(spell 4b713eb · main e6ac481·b822e64) · 644(spell fac04c4 · main 1aede54) · **649(spell 1b42105 · main 7607417)**. 640은 spell 단독. 이력 순서는 2cf6264→06fd1f7→4b64165→bfbdd5a→e485d18→e6ac481→b822e64→d9d50cb→2b404cc→4b713eb→1aede54→fac04c4→6228b28→42eaf9a→e7e5b9b→690a4b5→7607417→832e388→1b42105→6e229f6→8375d65.
- **★완료 트랙 step627~635 (2026-10-15, 채점 지연 수리 3 + 운영자·교사 가시성 6)** — 커밋 단위 요약(전부 push 완료, git log b0775cc..HEAD 9건 전수 대조로 미기재 0, 번호 중복 0):
  - `3cecc16` step627: **피크 시 호출 1회화** — `lib/peakWindow.js`(학급별 요청 시각 창 60초, 이번 포함 3건째부터 피크, 인스턴스 메모리) → grading 분기에서 피크면 전용 검사 인라인 생략(pending, 보완 큐 그대로) + `INLINE_GUARD_MAX=3`(인라인 전용, 백필 GUARD_MAX=5 유지) + 응답 `__exampleDeferred`로 예시 작품 자동 생성 보류 → 학생 카드 "📖 예시 작품 보기" 온디맨드(`lib/exampleDefer.js`). `[strict-inline]` 로그에 `peak=`. gate-peak-window 12. 베껴쓰기 감지(예시 비교) 코드는 원래 없음.
  - `07e13cb` step628: **쓰로틀 학급 키별 분리** — `lib/apiThrottle.js` 전면 교체: 키 해시(djb2) 버킷·14 RPM·요청 안 대기 1회 최대 20초(재귀 없음, 초과는 상류 429 백오프) · `computeWait`/`capWait` 순수 export · 머리 주석을 "서버 실행·인스턴스 메모리"로 정정. gemini.js 3곳 `throttleApiCall(apiKey)`. gate-api-throttle 14. 오류 분류기 변경 없음(그 로그는 console 전용).
  - `3a136aa` step629: **대기 안내 3단계 + 잠금 유예** — 제출 버튼 spell(0~6초)→grade(6~20초)→queue(20초~ "⏳ 친구들 글이 함께 줄 서 있어요. 조금만 기다려 주세요", 인원 수 없음). `checkTimeLock`에 `code` 추가, `lib/lockGrace.js` canUseLockGrace: 버튼 시점 통과 기억 → 채점 실패 뒤 종료 이후 재시도도 5분 안 1회 허용(저장 성공 시 기록 삭제, 서버 불변). 교사 잠금 옵션 아래 "제출이 한꺼번에 몰리면 AI 채점이 1~2분 줄을 설 수 있어요. 종료 시각에 3분 여유를 두면 좋아요." gate-lock-grace 10. 수정본 버튼은 단계 문구 없음(미적용).
  - `32e4b44` step630: 교사 홈 "✉️ 운영자에게 쪽지" 카드 — 헤더 💬 의견과 같은 FeedbackModal·feedback 테이블 재사용. prop `replyHint`로 교사 홈 경유에만 "답장은 🔔 알림으로 와요."(학생 의견엔 답장 경로가 없어 거짓 안내 방지). 엿보기는 assertWritable로 차단.
  - `c831171` step631: 학생 피드백 신고 → 관리자 종 + 카드 — `pages/api/feedback-report-notify.js`(service role, 본인 제출·reported=true·2분 이내 재검증, type `report` 재사용 — CHECK 11종, 제목 "🚨 피드백 신고 · 학교 반 번호", 링크 담임 엿보기 신고함, 본문·실명 없음). 대시보드 "🚩 신고(미해결)" 카드(reported=true·미삭제, 그리드 8열). "🙋 알리기"는 담임 전용 유지(긍정 신호, 관리자 소음).
  - `bbb6c2e` step632: **교사 글 카드 전국 소개 배지** — `pages/api/showcase-status.js`(교사 본인 주제·admin 조회, 제출 id in 절 봉인) + `lib/showcaseStatus.js`(approved&!hidden 🌏 전국에 소개 중 / pending 🔍 검토 중 / rejected 🚫 보류 title=사유 120자·닉네임이면 "닉네임을 바꾸면 다시 검토돼요" / approved&hidden 🚫 비공개 안내 — 4번째 상태). 글 모음 배지 줄 끝에 나란히. 주제 상단 "🌏 전국 소개 N편 · 📚 반 친구들에게 N편". gate-showcase-status 13.
  - `86e3644` step633: **관리자 학생 화면 엿보기** — 학생 4페이지 `?as={student_id}`. 선행 전수표: submissions 쓰기 8·rpc create_notification 4(미차단)·callAI 4(미차단)·fetch POST supply-adopt/supply-report/strict-backfill(배지 폴링=서버 쓰기)·localStorage 초안·Tutorial·auth.updateUser·signOut. 처치: `getEffectiveProfile(select, { allowedRoles })`(기본값 종전) · `lib/supabase.js` Proxy rpc 차단(읽기 허용 목록 READ_RPCS 4종: grade_avg_stats·topic_copy_counts·topic_like_counts·admin_class_stats) · `callAI` 전역 throw · errorLog 무기록 · 배너 kind='student' · StrictPendingBadge disabled · 서버 `asStudentId`(peer-share list·supply-ranking locked/myRank, admin만, 열람 계측 미기록). 학생 본인 경로(?as= 없음)는 종전 getSession 그대로. 쓰기 버튼은 보이되 disabled, 닉네임·비밀번호·Tutorial·TutorChat 미렌더, logout→/admin. 진입점: 교사 학생 관리 이름 칸 "👁 학생 화면 엿보기"(관리자가 볼 때만) / 관리자 학생 글 탭 각 행 👁(학생별 탭 부재 대체). **교사 엿보기 회귀 확인 필요**(TOP5·성장 그래프 rpc).
  - `63b6570` step634: 학생 의견 답장 전달 — saveReply가 작성자 학생이면 admin_reply 제목 "운영자 답장이 왔어요"·링크 /student. 학생 홈 맨 위 파란 배너 "💬 운영자 답장이 왔어요 (N건)" + 답장 보기/✕ 닫기(=/api/feedback-mark-read 본인 행만). 교사 경로 불변. `classes.feedback_reply_visible_to_students`(step205, 미사용)는 게이트로 안 씀(백로그).
  - `c2029bc` step635: **학생 신고 전체 이력** — 선행 확인: 담임 ✓ 확인 완료가 reported_at·report_reason을 **지우고 있었음** → reported=false만(둘 보존, 10/15 이전 해결분 복구 불가). `migrations/step635-report-resolved-at.sql`(선택, 해결 시각 컬럼 — 코드는 별도 update 시도·실패 무시). 의심 교정 탭 칩 "🚨 학생 신고"(의심 교정 0건이어도 칩 표시): 총/미해결 건수·필터 전체/미해결/해결·한 줄 = 상태·학교 반 번호·주제·신고 시각(·해결 시각)·본문 없음. 미해결 클릭 → 담임 엿보기 신고함 `?as=&sub=`(ring 강조·스크롤), 해결 → 학생 글 탭. "✅ 해결"(관리자, sub_update admin 허용). 🚩 카드 클릭 → 이 칩.
  - 번호 중복 없음. 이력 순서는 3cecc16→07e13cb→3a136aa→32e4b44→c831171→bbb6c2e→86e3644→63b6570→c2029bc.
- **★완료 트랙 step616~625 (2026-10-12~15, 챌린지 배너 문구·우리 반 글 모음 1단계·문체 통일 결정화·열람 계측)** — 커밋 단위 요약(전부 push 완료, git log 177abbd..HEAD 10건 전수 대조로 미기재 0):
  - `9a5336c` step616: 챌린지 안내 문구 정리 — 교사 홈 배너 제목 "🌏 전국 글쓰기 챌린지"("새 기능" 제거) + "최근 주제: '…' (M/D)" 1줄(614 fetchSupplyList 재사용·pickLatestSupply, 없으면 생략) + 설명 교체 + 버튼 "🔔 새 주제 자동으로 받기"/"나중에" 유지. 발행 목록 조회는 checkAuth 1회로 배너(엿보기 포함)·원클릭 카드 판정 공용(페이지당 API 1회). 교사 화면 '발행' 표현 전부 "올라와요" 계열로 교체.
  - `dc86204` step617: 배너 설명을 **좋은 점 2줄** 앞세우기("✅ 주제를 직접 만들지 않아도 돼요 … 자동으로 들어와요." / "✅ 아이들이 다른 학교 친구들의 잘 쓴 글을 읽어볼 수 있어요 (닉네임으로 소개돼요).") + 마지막 회색 한 줄 "지난 주제는 주제 관리에서 언제든 가져다 쓸 수 있어요." 문구만(조건·동작·계측 불변).
  - `8dff4a3` step618: 배너 첫 줄 대시(—)를 마침표로(문구 원칙: 대시 금지). 문구만.
  - `acc22e5` step619: **우리 반 글 모음 1단계 ① 배관(화면 없음)** — `migrations/step619-peer-share.sql`(classes.peer_share_enabled·peer_share_show_score 기본 false + peer_share_overrides add|exclude, RLS 정책 없음=서버 전용, **10/12 적용 완료**) + `lib/peerShareSelect.js`(주제별 학생 최고점 attempt≤2 상위 5·동점 선착, 제외=점수 null·paste·숨김·미동의(realname 공백)·삭제·작성자 미존재; exclude는 자동에서 뺌, add는 자격 재검증) + `pages/api/peer-share.js`(POST list|show|hide, 학생=담임 주제만·OFF→enabled:false·본인 제출 없음→locked, 응답=순번·닉네임·본문·mine(+설정 시 점수)만, student_id·실명·submission_id 미포함) + `lib/peerShareClient.js` + gate-peer-share 11. **선행 확인 ⓐ: submissions RLS(sub_select, step147)가 같은 학급 행을 이미 학생에게 열어 두므로 이 API는 본문 숨김이 아니라 열람 조건 강제·선정 단일화 역할(§13 글 모음 블록·체크리스트 ⑤).**
  - `2215506` step620: ② 교사 화면 — 학생 글 보기 주제 상단, OFF && 채점 글 5편 이상이면 켜기 카드("📚 이 주제 잘 쓴 글 5편을 반 친구들에게 보여줄까요? …" + "📚 우리 반 글 모음 켜기"=classes.update 학급 전체 ON) → ON이면 상태 줄 "✓ 우리 반 글 모음이 켜져 있어요. 자동 N편 + 선생님 선택 M편." 글 카드 도장 행 아래: 동의 전 회색 / "🙈 글 모음에서 빼기"(+"📚 자동 선정" 배지) / "📌 글 모음에 추가". 엿보기는 버튼 비활성·배지만. ClassSettings "📚 우리 반 글 모음" 토글 + 하위 "친구 글에 점수도 보여주기"(기본 OFF). 교사 홈 "오늘 N건 제출" 펼침 끝에 OFF 학급만 안내 1줄.
  - `a45fbb9` step621: ③ 학생 화면 — `components/PeerShareCard.js`("📚 우리 반 친구들 글 (N편)", 닉네임(+"(나)")·<details> 📖 글 읽기·점수(설정 시)·"🙋 선생님께 알리기"(본인 제외, 세션 1회), 0편이면 미렌더). student/index.js 제출 후·재진입·수정본 직후 loadPeerShareFor(반 주제만, 챌린지 제외) → 피드백 블록 안 챌린지 상위 글 뒤·다시 쓰기 앞. history.js 상세 진입 시 1회(주제별 캐시). 알리기=create_notification type 'message' 재사용, 제목 "📚 N번 학생이 친구 글을 선생님께 알렸어요", 링크 /teacher/submissions?topic=.
  - `d6bee95` [spell] step622: **문체 통일 검출 결정화** — koreanRules `countSentenceStyles` 반환 확장(minority·minoritySentences ≤5, 따옴표 안 마스킹 제외·대화문 오교정 차단) + prompts `buildStyleLine(essay)` "[문체 분포 — 서버 계산, 사실로 취급] … 소수 문장 M개는 … 통일하는 교정을 반드시 포함 / 일관된 글: 하나도 만들지 마세요 / 동률: 한쪽으로만 / 판정 2문장 미만 생략"을 5종 프롬프트에 주입(CORRECTIONS_RULES const→`correctionsRules(essay)` 함수), 규칙 11(가) 재작성(2/3 문구 삭제·"[문체 분포]를 따르세요"), (나) 삭제·(라) 예외 단서, NO_CORRECT_LIST 중복 정리. 게이트 korean 174→183 / prompts 121→148. 배경: 존댓말 12+반말 1문장 글 통일 교정 미생성(10/12·8/20).
  - `a263a5f` [spell] step623: **띄어쓰기 교정의 글자 보존(이중 방어)** — koreanRules `hasLongNoSpaceRun(≥40)`·`checkSpacingIntegrity`(공백·문장부호 제외 글자열 동일 또는 편집거리 ≤2) → mergeCorrectionsDetailed '띄어쓰기변형' 폐기 + prompts `buildSpacingLine` "[띄어쓰기 — 서버 계산] … 글자를 하나도 빼거나 바꾸지 마세요 … 고유명사는 붙여 둡니다"(`buildFactLines`로 [문체 분포]→[띄어쓰기] 순, 5종). 게이트 korean 183→200 / prompts 148→163. 배경: 10/2 송림초 23번 공백 없는 글 통째 교정에서 "등등을"·"싶었다도" 삭제·"우리은행" 분리(고유명사 분리는 글자가 같아 코드로 못 잡음 → 프롬프트 몫).
  - `f37013c` step624: **문체개입 감시 오탐 제거** — `lib/styleUnify.js` `tagStyleUnify(corrections, essay)`: minority 있을 때 original이 소수 문장에 포함·correction 끝맺음이 다수 문체면 `{ styleUnify: true }` 표식(비해당 불변). ai.js 규칙 병합 직후(grading·rewrite·regrade·grammarOnly·grammarStrict 공통) + strictCheck.server backfillOne. `_sql/step624-scan-correction-alerts-style-unify.sql`(**수동 실행 — 적용 여부 커밋에 기록 없음, 다음 세션 확인**): scan_correction_alerts '문체개입' CASE·WHERE에 styleUnify≠'true'. gate-style-unify 12. 배경: 622 이후 옳은 통일 교정(10/8 송림초 "마쳤다→마쳤습니다")이 의심 교정 탭에 적재.
  - `12e36d5` step625: **글 모음 열람 계측** — `migrations/step625-peer-share-views.sql`(`peer_share_views` class_id·topic_id·view_date·created_at, FK 없음, RLS select admin만·쓰기 정책 없음) + /api/peer-share 학생 list 응답에 글 1편 이상 실릴 때 1행(학생 ID·본문·점수 없음, 실패 무시·응답 불변) + 관리자 통계 타일 아래 한 줄 "📚 우리 반 글 모음: 켜진 학급 N · 최근 7일 열람 M"(ON 학급 수는 이미 받은 classes 행에서, 열람은 head count). **SQL 미적용(10/15) — 적용 전엔 0·0.** 삭제 줄 0·lint Error 0·build 통과.
  - 번호 중복 없음(10건 전부 단일). 이력 순서는 9a5336c→dc86204→8dff4a3→acc22e5→2215506→a45fbb9→d6bee95→a263a5f→f37013c→12e36d5.
- **★완료 트랙 step611~614 (2026-10-08~12, 전국 챌린지 접근성·주제 공유 품질)** — 커밋 단위 요약(전부 push 완료, git log f774166..HEAD 15건 전수 대조: 603~610 10건은 아래 블록에 기재돼 있어 미기재 0):
  - `c88edb0` [spell] step611: 핸드오버 갱신 — 603~610 트랙 §1 병합(문서만).
  - `8fd8149` step611: **주제 관리 상단 "🌏 최근 전국 주제" 카드** — 표시=발행 이력 있음+학생 1명 이상+7일 숨김 아님. ①"📥 이 주제 가져오기": 오늘 발행분(published_at 오늘 KST 창)이면 step477 원클릭(/api/supply-adopt force)과 같은 경로, 지난 주제면 제목·설명·rubrics(합100 보정)·min_length만 폼에 채움(일반 주제, source_supply_id 없음, AI 0). 같은 원본·같은 제목이 있으면 "✓ 이미 등록된 주제예요". ②"🔔 새 주제 나오면 자동으로 받기"(OFF일 때만)=classes.auto_supply_enabled update+supply-adopt 즉시(교사 홈 ON 직후와 동일). ①② onboarding_responses 'challenge_topics_card'/'clicked' 1회. 교사 홈 505 배너를 같은 원클릭으로 통일(설정 이동 제거). **"매일" 7곳 교체**(ClassSettings 라벨·설명·confirm, 홈 배너·원클릭 카드, 랭킹 탭). 학생 "안 쓴 지난 글"에서 챌린지 복사본 제외(쿼리 `.is('source_supply_id', null)`). 신설 `pages/api/supply-list.js`(발행 목록, service role, 안전 컬럼만)·`lib/supplyBands.js`(bandsForGrade·pickLatestSupply — 같은 날 공통·학년별이면 학년별 우선)·`lib/supplyClient.js`(adoptTodaySupply·fetchSupplyList·fetchTopicSource — 교사 홈 joinSupplyTopic·maybeSupplyAdopt도 이걸로 교체).
  - `2190b5b` step612: 단일 등록 폼 안 **"🌏 전국 주제 모음 (N)" 접힘 섹션** — 발행일 내림차순 `M/D · 학년대 · 제목` + [📥 가져오기](오늘 배지·✓ 등록됨). 가져오기=611 함수 재사용. 같은 제목이면 confirm "같은 제목의 주제가 이미 있어요. 그래도 가져올까요?". 원클릭 완료 표시를 원본 id Set으로 통합.
  - `74321f5` step613: **공유 주제 선택 시 원 주제 기준·설명·최소 글자 수 재사용(AI 0)** — 신설 `pages/api/topic-source.js`(resulting_topic_id 있는 로그만, description·rubrics·min_length+학급 grade, 교사 실명·teacher_id·class_id 미반환). applyFromLog가 등록된 공유 추천이면 채우고 rubricGen 생략, 404·실패면 기존 AI 경로. copiedSource→topic_copies·notify_topic_copied·익명 표시 불변. 폼 위 "{N}학년 선생님이 만든 기준이에요. 필요하면 고쳐 쓰세요."(학년 없으면 "다른 선생님이…") + 합계≠100 경고 1줄. 운영 설정 미복사.
  - `3aa933a` step614: 교사 홈 원클릭 카드(step477 maybeShowSupplyCard)의 공급 원본 조회를 클라이언트 직접 SELECT(RLS top_select상 교사 0행 가능성)에서 `/api/supply-list`+isToday로 전환(노출 조건·클릭·계측 불변) + 관리자 온보딩 라벨 `challenge_topics_card: '🌏 전국 주제 카드'`. 전환 전 0행 여부는 교사 토큰 없어 미실측(정책 텍스트 근거).
  - ⚠️ **번호 중복 1건(해시가 권위)**: 611(spell c88edb0 문서 / main 8fd8149 카드). 이력 순서는 c88edb0→8fd8149→2190b5b→74321f5→3aa933a.
- **★완료 트랙 step603~610 (2026-10-02~10-08, 퀴즈 핫픽스·린트·AI 안전 필터·spell 규칙 4종·'표기만 변경' 내용 동결·문체역행 치환)** — 커밋 단위 요약(전부 push 완료, git log 34a03b8..HEAD 10건 전수 대조):
  - `e3c57a7` step603: 학생 퀴즈 'ruleKeys is not defined' 긴급 핫픽스(598 c96fd73 회귀, 10/1 19:44~10/2 전면 불능). / `71212e4` step603: 체크리스트 ④에 한 줄(문서만).
  - `f7e8b6f` step604: 린트 도입(.eslintrc.json + `npm run lint`, 빌드는 ignoreDuringBuilds라 Vercel 무영향). 기존 Error 3건(students.js clearSelection no-undef ×2·StudentLoginInfoCard rules-of-hooks)은 보고만.
  - `a55b305` [spell] step605: 규칙 4종 — ㄹ받침+수+있/없(공백 또는 조사 도·는·가·밖에·만 뒤만, 앞 글자 실·철·말·별·골·술 제외) · 이였→이었('아니였' + 받침 명사 16 화이트리스트, 고양이였다·종이였다·민준이였다 보호) · 방학때→방학 때(점심때·저녁때·그때·이때·한때·제때 NO_FP) · 안/않 조사 확장(이/가→이/가/은/는/도, -지/-치+보조사 뒤 '않나'는 제외). 게이트 138→170.
  - `0fd9595` step606: AI 안전 필터 차단 우아한 처리 — detectSafetyBlock(blockReason·finishReason SAFETY/PROHIBITED_CONTENT 등)→422 AI_SAFETY_BLOCKED 즉시(재시도·폴백 0), 글 보존(total_score null + graded_with_model 'safety_blocked'), 학생 보라 안내 카드, 담임 알림, 관리자 분류기 '🟣 AI 안전 필터'(lib/errorClassify.js 추출), migrations/step606(점수·피드백 DROP NOT NULL), gate-safety-block 56. / `877aecb` step607: 랭킹·통계·성장 그래프·생기부가 점수 null 행 제외(0점 왜곡 방지).
  - `f957602` [spell] step608: rewriteGradingPrompt 규칙 11에 **(타) 항목 점수 변경은 그 항목의 변경 문장 인용 필수·전 항목 일괄 ±1 금지 / (파) [변경 사실]이 '표기만 변경'이면 맞춤법·문법 항목만 조정·나머지 동결**(해당 항목 없으면 전부 동결). [변경 사실]에 '표기만 변경' 줄(changeFacts.notationOnly 우선, 없으면 added/removed 공백·문장부호 제거 비교로 자체 판정). 게이트 119→120.
  - `fb7dc11` step608(main): **`lib/changeFacts.js` 추출** — 글자 수가 공백·문장부호 제외, 문장 비교는 **포함 판정**(마침표 없던 한 덩어리 ↔ 나뉜 여러 문장도 같은 내용이면 추가·삭제 아님), notationOnly(정규화 동일 또는 편집거리 ≤ max(3, 1%)·최대 6 — 됬→됐·조사 교정 수준)·addedCount·removedCount·normEditDistance. gate-change-facts 20 + replay 스크립트.
  - `a9c2a8e` [spell] step609: 문체역행 필터 — '~입이다' 오타(입니다·이다 혼동) + '~입니다' 교정이 반말 압도 글에서 통째로 폐기되던 것을 **'이다'형 치환 통과**("말입이다→말이다", "때문입이다→때문이다"; 9/3·10/8 실사례). reason이 '입니다'를 말하면 반말 기준 문구로 교체. '~이에요' 교정은 기존대로 폐기, 반말 글 아니면 분기 안 탐. 게이트 170→174.
  - `7096fdf` [spell] step610: [변경 사실] 판정 순서 — **notationOnly === true가 '변경 없음'보다 우선**(메인 608 포함 판정으로 표기만 고친 글이 추가 0·삭제 0·글자 수 동일이 되어 맞춤법 항목까지 동결되던 것 수정), false+동일→'변경 없음', 필드 부재→폴백. 추가·삭제 줄은 'N개(앞 5개만 표시)' 실제 개수(addedCount·removedCount). 게이트 120→121.
  - (참조) `8690e20` [spell] step590 규칙 3종('-고 싶다' 띄어쓰기·관형사+곳·조사 '라는' 받침 가드)은 582~593 블록, `5271ae7` [spell] step596 계약 2.0(직전 본문·변경 사실 주입, 하락엔 인용 강제)과 598~601 메인(퀴즈 / 이중 호출: 맞춤법 전용 선행→채점 주입·교사 60초 가드 ≤5·pending 보완·일일 크론 스윕 / 학생 안내: 2단계 버튼·⏳ 배지·30초 폴링 — Vercel Hobby라 2분 크론 미구현)은 아래 595~601 블록에 등재.
  - ⚠️ **번호 중복 1건(해시가 권위)**: 608(spell f957602 규칙 (타)(파) / main fb7dc11 changeFacts.js). 이력 순서는 e3c57a7→71212e4→f7e8b6f→a55b305→0fd9595→877aecb→f957602→fb7dc11→a9c2a8e→7096fdf.
- **★완료 트랙 step595~601 (2026-09-16~10-02, 수정본 채점 계약 2.0 완성·첫 채점 이중 호출·퀴즈 안전화·실험 스크립트)** — 커밋 단위 요약(전부 push 완료, git log 9256b56..HEAD 9건 전수 대조):
  - `a1a89f9` step595: 수정본 채점 입력에 직전 글 본문 + 서버 계산 변경 사실 추가(배관) — fetchPrevGrading에 essay_text, computeChangeFacts(공백 제외 글자 수·deltaPct·추가/삭제 문장 각 5개·120자), rewriteGradingPrompt에 prevEssay(2000자 상한)·prevScores·changeFacts 3인자 전달. 배경: 9/16 6975 실사례(직전 본문 없이 "분량이 줄었다" 거짓 사유).
  - `5271ae7` [spell] step596: **수정본 채점 계약 2.0** — rewriteGradingPrompt가 595의 3인자를 받아 [직전 글 본문]·[직전 항목 점수]·[변경 사실(서버 계산, 사실로 취급)] 블록 주입. '첫 글'→'직전 글'(학생 대면 '지난 글'), 항목 점수 출발점=직전 항목 점수, 반영 판정 근거=추가된 문장 인용, 변경 없음→동일 점수+'지난 글과 같아요'. 신규 무감점은 기계적 오류(맞춤법·띄어쓰기·문장부호)로 축소, 내용 훼손 추가(장난·무의미 글자)는 인용 시 감점 허용. 하락 허용 4종 열거 폐기 → "하락 근거 규칙"(추가/삭제 문장 인용 필수·변경 사실 모순 금지·인용할 문장 없으면 하락 불가). gate-prompts FACTS 5케이스 114→119 PASS.
  - `a49b3f8` [spell] step597: 실험 스크립트 `scripts/experiment-strict-vs-grading.js` 신설 — 첫 채점(통합) vs 맞춤법 전용(grammarStrict) 검출 건수 비교(이중 호출 도입 근거). DB select만·lib import만. 당시 로컬 시스템 키 없어 AI 비교 미실행.
  - `e48e123` step597: score_drop_reason 스키마 설명을 계약 2.0에 맞춤 — "직전 글 대비 추가되거나 빠진 문장을 따옴표로 인용한 한 문장", 인용할 문장 없으면 빈 문자열 ""(지시의 'null' 대신 — 스키마가 non-nullable STRING+required이고 서버가 string만 사유로 읽어 문자열 "null"이 학생 종합의견 앞에 붙는 사고 방지). 설명 문구만.
  - `c96fd73` step598: 맞춤법 퀴즈 출제 재료 안전화(`pages/student/quiz.js`) — 10/1 학생 의견 3건(보기 동일 "여름 방학"·정답 "안 는"·문맥 없음). 저장 corrections에 mergeCorrectionsDetailed 재적용(현행 필터를 과거 저장분에도) + 정규화 키(NFC·특수공백) 비교 + correction_alerts 의심 기록 제외(fail-open) + 규칙기반 검출 쌍 우선 + findOriginalRange로 위치 확실한 것만 출제·앞뒤 40자 문맥 1줄(교정 위치 빈칸). "않는→안 는"은 현행 koreanRules가 정상 차단함을 확인(과거 저장분) — 규칙 변경 없음.
  - `130cdf7` step599: 실험 스크립트에 `--model`·`--list-models` 옵션 + 표현 다듬기 의심 집계(공백 제외 편집거리 ≥3, 어림값). **실측(15편)**: 저장 94 / strict 3.1-flash-lite 116(+23%) / strict 3.5-flash-lite 122(+30%). 눈으로 본 오교정·깨진 출력: 3.1 1건 / 3.5 7건(바받침할·1옮기고·내용 단어 교체 등) → **3.5 탈락, 3.1 유지**. 3.1 재실행이 기존 116과 정확히 일치(temp 0 재현성).
  - `df52b48` [spell] step598: 무의미 교정 정규화(저장 단계에서 "여름 방학"=NBSP 유형 원천 차단) + '않나+용언' 과차단 수정(9/30 동북초 "매연이 않나오면" ×5). gate-korean-rules 갱신.
  - `8f5820a` step600: **첫 채점 이중 호출 배관** — 신설 `lib/strictCheck.server.js`(runStrictCheck: grammarStrict 조건·모델 3.1-flash-lite 고정·재시도 0·타임아웃 8s/보완 20s, countRecentGradings 교사 60초 집계, unionCorrections 전용 검사 우선 dedup, ensureStrictColumn 컬럼 확인 캐시, backfillOne·sweepPending). ai.js grading: 컬럼 OK·교사 최근 60초 N≤5면 전용 검사 인라인 → 결과를 gradingPrompt ruleErrors에 주입 → 채점 후 union 병합 → 응답 `__strictStatus`(done/pending/skipped). 신설 `pages/api/strict-backfill.js`(폴링 트리거, 본인/담임/관리자). cron-trash-cleanup에 sweepPending 단계. student/index.js insert에 strict_status/strict_at(플래그 있을 때만). `migrations/step600-submissions-strict-status.sql`(10/2 적용 완료). **Hobby 플랜(크론 2개·일 1회 제한)이라 2분 크론 미구현 → 학생 폴링 + 일일 스윕으로 대체.**
  - `34a03b8` step601: 이중 호출 학생 안내 — 제출 버튼 2단계 문구("🔍 맞춤법을 꼼꼼히 확인하고 있어요…" → 6초 뒤 "📝 글을 평가하고 있어요…", 시간 근사) + 신설 `components/StrictPendingBadge.js`(pending 배지 "⏳ 맞춤법을 꼼꼼히 다시 보고 있어요. 잠시 뒤 밑줄이 더 추가될 수 있어요." + 10초 뒤 첫 호출·30초 간격·최대 10분 폴링 → done이면 밑줄 갱신·배지 제거) — 학생 피드백·글 기록(내 글 보기·원문 비교) 소비 + 교사 제출물 카드 회색 칩 "⏳ 맞춤법 보완 대기". 표시·폴링만.
  - ⚠️ **번호 중복 2건(해시가 권위)**: 597(spell a49b3f8 실험 스크립트 / main e48e123 스키마 설명) · 598(main c96fd73 퀴즈 / spell df52b48 정규화·않나). 이력 순서는 a1a89f9→5271ae7→a49b3f8→e48e123→c96fd73→130cdf7→df52b48→8f5820a→34a03b8.
- **★완료 트랙 step582~593 (2026-08-24~09-15, 엿보기 랭킹 수리·오류 분류기·보고 규칙·카테고리 통일·수정본 채점 정책 전환)** — 커밋 단위 요약(전부 push 완료, git log 580..HEAD 전수 대조):
  - **[main 트랙]**
  - `256df15` step582: 전국 랭킹 엿보기 403 수리 — admin 동결본 읽기 허용(쓰기·키소비 차단 유지) + 모달 실패 인플레이스 처리 + 오류 로그 적재.
  - `36ab534` step584: 전국 랭킹 모달 담임 실명 주석 — 우리 반 동의 완료 학생만 실명(닉네임) 병기. 서버 부착·학생 응답 불변·엿보기 화면 일치.
  - `397bc55` step585: 관리자 오류 분류기 보강 — Load failed(사파리/iOS)=⚪ 네트워크, Script error.(교차출처)=⚪ 외부 스크립트(무시 가능). 패턴 추가만.
  - `bf52487` step586: 서버 AI 호출 실패 로그에 상류 원인 동봉 — status·오류 발췌(200자, key= 마스킹)·타임아웃 여부를 error_logs.context.upstream에 기록, 분류기가 upstream도 판정(+RESOURCE_EXHAUSTED→🟠 한도).
  - `510cb2a` step587: 보고 전달 규칙 정착 — v2 보고를 `_last-report.md`(UTF-8)로 덮어쓰기 규칙(CLAUDE.md) + `/report` 커스텀 명령(클립보드 복사) + gitignore 등재. 코드 변경 없음.
  - `7b9783b` step588: 수정본 채점 점수 하락 사유 구조화 — rewriteGrading 전용 스키마(essayFeedback+score_drop_reason) 그릇 신설. 하락+사유 → 종합의견 첫 문장에 결합해 학생 화면 노출, 모든 하락을 점수역전 감시에 기록, 관리자 탭 점수역전 칩. **※그릇만 있고 프롬프트 지시가 없어 실제 준수율 약 1/3 — spell 591에서 지시 편입.**
  - `200c704` step589: 주제 카테고리 단일 상수·4묶음(optgroup) 통일 — 친구 관계/가족 분리, 내가 만든 세상 흡수, 골고루 모드 묶음별 추출 + 복수 주제 등록 힌트·도움말(최유라 교사 의견). 서버 프롬프트·추천/등록 로직 불변.
  - `deac07a` step590: 점수역전 감시 한글화 + 표시 정책 — 감시 기록 문구를 관리자용 한글로(개발자 마커 제거), 사유 없음은 suspect_type '점수역전(사유 없음)', 사유 있음+하락 5점 이하는 생성 시 resolved=true(기록 보존·탭 비노출), 관리자 탭 '사유 없음만' 칩·진한 파란 배지·'직전 글 보기' 라벨. 배경: 12일 만에 293건 적체로 경보 기능 상실.
  - `8a22156` step591: score_drop_reason 준수율 원인 분리 — 감시 기록 reason 끝에 '합계 확인: 이번 AI N / 실제 M, 직전 AI P / 실제 Q' 절(모델 total vs 서버 scores 합), 관리자 카드는 불일치일 때만 🧮 표시. 스키마 필드 설명을 'scores의 합' 기준으로 보강. **확인 사실: 서버가 total을 scores 합으로 덮어쓰는 보정은 없음(학생 화면은 AI total을 캡만 하고 저장) → 하락 판정 기준 비대칭(직전=AI total, 이번=scores 합). 1주 관찰 후 판단.**
  - `fdc23b2` step593: 수정본 채점 계약 배관 — fetchPrevGrading select에 feedback_improve·improve_examples 추가, rewriteGradingPrompt에 prevImprove·prevImproveExamples 전달(없으면 null → 총평 폴백). spell 591의 2인자를 실제로 채움.
  - **[spell 트랙]**
  - `711396d` [spell] step583: 핸드오버 갱신 — 562~582 트랙에 spell 상세 병합, 수단 A 월 1회 루틴 등재, 관찰 목록 교체, 게이트 99·106 기록.
  - `8690e20` [spell] step590: 맞춤법 규칙 3종 추가('-고 싶-' 띄어쓰기·관형사+곳·조사 '라는' 띄어짐) — 8/28 실사례(가고싶은·어떤곳·여행지 라는 0건 검출→첫 채점 94점/수정본 90점 널뛰기). '라는'은 앞 글자 받침 가드. 게이트 103→115 PASS.
  - `6caf31e` [spell] step591: **수정본 채점 정책 전환 — "엄격화"→"조언 이행 계약"** (5원칙 상세는 §13 최상단 블록). 첫 글 조언(improve·improve_examples 신규 2인자, 미전달 시 총평 폴백) 항목별 반영/부분/미반영 판정, 신규 오류 감점 금지, 하락 허용 4종 외 금지, 하락 시 score_drop_reason 필수+overall 첫 문장=사유. 555·556 주입은 수정본 모드(자기모순 방지만), 만점 억제는 gradingPrompt 원칙 11로 이전. 게이트 106→114 PASS.
  - `999d6cb` [spell] step592: '잘 않나' 과차단 수정(9/1 인천산곡초 ×4) — original을 "잘 않나"→"잘 안 나"로 넓혀 생성 + isInvalidAnhToAn 화이트리스트. '않아→안 아' 등 차단 유지. 게이트 115→119 PASS.
  - ⚠️ **번호 중복 2건(main/spell 경합 — 해시가 권위)**: 590(main deac07a / spell 8690e20) · 591(main 8a22156 / spell 6caf31e). 이력 순서는 8690e20→deac07a→6caf31e→999d6cb→8a22156→fdc23b2.
- **★완료 트랙 step562~581 (2026-08-19~24, 온보딩 개선·엿보기 완성·제출 중복 사고 종결·spell 판정 원칙)** — 커밋 단위 요약(전부 push 완료):
  - **[main 트랙]**
  - `e0a3e4f` step562: no_students 카드 행동요령식 문구 교체 — 2단계 안내+'학부모 동의' 부담 단어 제거(문구만, 계측 불변).
  - `b33d68d` step563: 다음 걸음 모달 오버레이 클릭 닫힘 제거 — 실수 닫힘이 평생 1회 안내를 소멸시키는 누수 차단(✕·ESC만).
  - `38ce386` step564: 신규 교사 홈 다이어트 — 유료 사전신청 카드 수업 3회+ 문턱, 챌린지 배너 학생 1명+ 조건.
  - `fa743cb` step565: 모달 ✕=오늘만 닫기 + '다시 보지 않기' 체크박스. **dismissed 의미가 '명시적 거부'로 변경 — 깔때기 해석 시 주의(이전 dismissed=실수 닫힘 포함).**
  - `b62e019` step566: 체크리스트 주인공화 — "처음이세요? 첫 수업까지 5단계" 개명·필수 배지·10분 표기·최상단 이동·미완료 시 오늘만 닫기.
  - `0619e4f` step567: 관리자 탭 간 이동 뒤로 가기 수정(글 보기 replace→push + popstate 탭 동기화).
  - `449b217` step568: 엿보기 화면 일치 모드 — 교사 홈 온보딩 UI 표시 동일화, 쓰기 전면 차단(엿보기 표식 포함).
  - `70d5fae` step569 · `fbcb3a4` step570: 엿보기 8페이지 ?as= 지원(도움말·현황·성장·휴지통·신고함 / 주제·생기부 평어·맞춤법 일괄) — 읽기 대상 교사 전환 + 쓰기·AI 호출 전면 차단(관리자 키 소비 방지).
  - `b2a11d2` step574: 휴지통 실명 잠금(displayStudentName) + NotificationBell 엿보기 읽음 처리 조용히 생략.
  - `b7377cc` step578: 학생 제출 중복 insert 차단 — insert 전 존재확인·조회 error 오판 봉쇄·수정 허가 동률 안전화·지난 글 목록 갱신.
  - `e89703c` step579: 제출 비교 뷰 시간순 통일 — 정렬·라벨·비교 좌우·isLast를 created_at 기준으로(중복 attempt에도 자기모순 없게) + 관리자 ← 문구 교체·휴지통 제외.
  - `a7dba28` step581: 유료 사전 신청 UI 전면 제거 — 제품 내 수익화 메시지 0(공과금형 전환, 데이터·admin 명단 보존). (step580은 마감 문서 커밋 `56b87b8`.)
  - **[병렬 트랙 — 메인 571~573]** `c2369ac` step571 초안 금고(1.5초 저장+pagehide 플러시·수정본 복원 갭 수리·복원 배너 HH:MM·고아 키 정리) · `b1ebc50` step572 로그아웃 로컬 스코프(공유 크롬북 타기기 세션 사망 차단, 비번 재설정·계정 삭제만 global 유지) · `691af59` step573 callAI 401 자동 복구(세션 갱신 신선 토큰+1회 재시도) = **8/20 교실 사고(타기기 로그아웃→세션 사망→작성 중 글 유실) 대응 3종 + 백로그 '세션 만료 UX' 과제 해소.**
  - **[병렬 트랙 — spell]** `222e880` step569: **corrections 판정 원칙 승격**("유일한 기준: 원문이 틀렸는가") + **높임 교체 금지**(집→댁·에게→께, 8/19 실사례) / `b4ed4b9` step575: **미검출 전수조사(수단 A) 기반 규칙 7종 일괄 편입** — 시각·날짜·한번·우리반·그러고나서(표준형)·이로인해·안된다(오탐 가드: 제안된·고안된·참 안됐다) / `f4ea75a` step576: **'밖에' 핑퐁 금지** — 전수조사 발견(물밖에↔물 밖에 양방향 교정 공존), 조사(붙임)/명사구(띄움) 양방향 차단 / `21786a8` step577: step569 판정 원칙에 **문체 통일 예외 명시** — 원칙-문체조항 모순으로 섞인 글 통일 교정 침묵(8/20 실사례) 해소 / `d623a14` step563: NO_CORRECT_LIST 축약형(상세는 아래 552~560 블록 말미).
  - ⚠️ **번호 중복 3건(main/spell 경합 — 해시가 권위)**: 562(main e0a3e4f / spell d623a14) · 564(main 38ce386 / spell 정정 910a093) · 569(main 70d5fae / spell 222e880).
  - **[8/20 제출 중복 사고 — 종결]** 증상: 12번 학생 attempt=1 3행(비교 뷰 시간 역전·자기모순 배지). 원인 확정 ①insert 응답 유실→재클릭 이중 저장(22초 동점 쌍둥이) ②제출 이력 조회 error를 "미제출"로 오판→빈 폼→attempt=1 재삽입. **교훈: "조회 실패=없음" 추측 금지 — §0 원칙의 실증 사례.** 조치: 578(생성 차단)·579(표시 시간순 통일)·쌍둥이 1행 soft-delete(id 5ca35163-…, 8/21 10:41 KST, delete_reason 'dup-cleanup'). 후속 백로그는 §13 [사고 후속] 참조.
- **★완료 트랙 step552~560 (2026-07-23~24, 등록 병목·홈 가시성·채점 신뢰)** — 커밋 단위 요약(전부 push 완료):
  - `353ca6a` step552(메인): 학생 등록 병목 개선 — 다음 걸음 no_students 카드 문구 교체("학부모 동의 없이도 지금 바로"+명렬표 직행 딥링크 /teacher/students?mode=register+자가 가입 대안 한 줄, card_type·계측 불변) + 학생 0명 홈 배너(닫으면 익일 재표시, localStorage KST 날짜 키). **판정 기준: 등록 카드 따라감 11%→25%+, 판정은 개학 주간.**
  - `346974e` step553(메인): 교사 홈 "오늘 N건 제출" 펼침 — 최근 5명 미리보기(표시명·시각·점수·다시쓰기 표기), 6명 이상 "외 N명→제출 현황", 학생 줄 클릭 글 직행(?topic=&student= 기존 딥링크). count와 동일 필터(KST·숨김 제외).
  - `5c7448e` step554(메인): 교사 랭킹 화면 "🌏 전국 챌린지" 섹션(탭 구조가 아니라 3카드 아래 전폭 카드) — 참여 이력 목록+지나간 동결 순위 열람(핵심 목적). 참여 0명 복사본은 청소(step479)로 소멸 감수. 모달은 TeacherShowcaseModal로 공용화(step544 추출).
  - `575c4f0` step555(spell): 검사·채점 자기모순 차단 — koreanRules 자동 검사 결과를 채점 입력으로 주입(**ai.js 1차·재작성 배선까지 이 커밋에 포함**) + corrections↔점수 일관성 규칙(만점 금지, 감점 강제 아님). 비면 미주입 폴백(하위호환).
  - `68f17f1` step556(spell): 검사 요약 주입 가드 — 대표 예시 3건 제한·절대 표현 확장·다른 항목 번짐 금지 + 실사례('쥐죽은듯이')·공존 게이트.
  - ※ 메인의 "556 채점 호출부 배선" 지시는 **불필요 판정으로 종결** — 배선이 555에 이미 포함돼 있음을 코드로 확인(중복 작업 방지). 이후 556 번호는 spell 가드 커밋이 사용.
  - `9c5dcd0` step559(spell): 재작성 항목 상승 인용 강제 + 종합의견 복붙 방지 — 항목 점수를 올리면 rubric_reasons에 달라진 대목 따옴표 인용 강제, 인용할 변화 없으면 직전 점수 유지, 맞춤법 수정만으로는 맞춤법 외 항목 상승 금지, 종합의견 이전 총평 복붙 금지. **'근거 없는 변동 금지' 4중 축 완성(521 하락 사유→550 미수정 칭찬 금지→555 맞춤법 모순 차단→559 상승 인용).** 게이트 확장 PASS(gate-prompts 81/81). ※마감 지시문의 "spell 558=59a4c1e"는 오기재 — 이 내용의 실제 커밋은 559=`9c5dcd0`(해시가 권위).
  - `b7712a5` step560(spell): 반말 일관 글 문체역행 오교정 **코드 레벨 폐기** — countSentenceStyles로 essay 문체 다수결, 반말 압도(formal ≤1 && plain ≥3)일 때만 반말→존댓말 교정을 dropped('문체역행')로 폐기. 프롬프트 금지(step485) 후 재발 4건(7/23 대구범어초·7/24 신리초 등) 대응. 과거 isStyleChange(393→409 제거)의 문장 단독 판정 실패와 달리 섞인 글 통일 지적·'습다' 오타 교정은 보존. 게이트 83/83 PASS(신규 MERGE 4·STYLE 3).
  - `d623a14` step563(spell, 2026-08-19): NO_CORRECT_LIST 구어체 축약형(거→것·게→것이·건→것은·~거지→~것이지) 문어체 변환 금지 명시 강화 + 띄어쓰기 오류면 띄어쓰기만("필요한거지→필요한 거지"로만). 게이트 86/86 PASS(신규 5: "필요한 거지" 문구 검사). ※커밋 메시지의 "step562"는 오기재 — 같은 날 메인 `e0a3e4f`가 step562(no_students 카드 문구) 사용, 해시가 권위.
  - **⚠️정정(8/19, step564)**: 563의 '재발' 근거는 허위로 판명(claude.ai 데이터 미수신 상태에서 생성된 오류 — 당초 인용된 8/17 백석초 "필요한거지→필요한 것이지" 사례는 관리자 탭 원본 대조 결과 실존하지 않음. 실존은 7/20 여수송현초 "사먹는게→사 먹는 것이" 1건뿐). 규칙은 실존 단발 사례 기반 선제 강화로 재분류. '거→것' 유형의 실제 재발 여부는 계속 관찰.
- **★메인 세션 완료 트랙 step536~549 (2026-07-21~22, 정책·성능·생태계·안전)** — 커밋 단위 요약(전부 push 완료):
  - `458a871` step536: 학생 붙여넣기 기본 차단 + classes.allow_paste 학급 토글(마이그레이션 실행 완료). ⚠️**정책 변경: 전 학급 기본 차단.**
  - `8cf4359` step537: 관리자 학생 글 탭 초록 diff — lib/textDiff.js 공용화(교사 인라인 step474에서 추출).
  - `b30f6fd` step538: 챌린지 상위 글 즉시 응답 — AI 검토를 waitUntil로 응답 후 분리(@vercel/functions 신규 의존성) + 전국 본문 select 축소(후보 5명만 재조회).
  - `4b07590` step539: 학생 랭킹 3구간 표시(1~10등 그대로/~상위 50% 퍼센트/하위 50% 격려·성장형 — lib/rankDisplay.js, supply-ranking에 rankedPool 필드). ⚠️**정책 변경: 하위권 등수 비노출.**
  - `cd051db` step540: Vercel 함수 리전 서울(icn1) — 로그 실측 "Routed to Washington" 해소, 309ms 확인.
  - `f7f478e` step541: 공유 주제 인기 TOP 5 + ❤️ 좋아요(topic_likes 마이그레이션 실행 완료) + 원작자 익명 알림(notify_topic_copied RPC — 같은 주제 하루 1건, N명은 body).
  - `3bb668c` step543: TOP 5 사용 수 숫자 숨김(정렬 기준으로만 사용).
  - `20865f2` step544: 교사용 챌린지 전국 랭킹 진입점 + 모달(참여 수+상위 3 글, 내 순위·신고 없음).
  - `9b380fb` step545: "오늘 제출" 집계 KST 확인 — 이미 정상(step319부터 KST, PT는 AI 사용량 전용). 오인 신고 종결, todayStr 공용화·주석 명확화.
  - `e04d5f9` step546: 관리자 소개 글 패널 학생별 1행·순위 재계산(supply_showcase 구 행 잔존이 1위 다수·중복의 원인 — 표시 계층만 수정).
  - `49bb736` step548: ❤️ 토글 확대·카드 우하단 재배치 + TOP 5 하트 토글화(TopicLikeButton 공용).
  - `c316a8d` step549: 닉네임 안전장치 — 10자 입력 제한(NicknameChangeModal) + 소개 검토 프롬프트 닉네임 판정(showcaseReview.server.js — prompts.server.js 아님).
  - **검증·사건 기록(7/21~22)**: ✅아침 검증 3종 전부 실데이터 종결 — 청소(7420 복사본 소멸)·순위 동결(시상식 22명, 7/22 08:57 lazy)·🏅 당시 순위. 예약 발행 파이프라인(발행→자동 등록→🌏 알림) 실전 통과. / 사건: 예약 발행 date=생성일 버그(531 수정, 시상식 조기 동결 SQL 복구) · 장난 신고 1건(예솔 글 복구) · 조롱 닉네임 1건(호평초 6-6=배우자 반, 가정 전달로 지도, 글 거절 유지 — step549 안전장치의 계기) · "유령 제출" 신고는 오인(실제 오늘 제출)으로 종결. / 라이브: 시상식 챌린지 실참여 22명(뽀로로반+호평초 6-6), supply-adopt Android UA 다수 — 학생 모바일 사용 확인.
  - ⚠️ **번호 매핑(spell 세션 병렬 — 해시가 권위)**: 534=`8639539`(핸드오버 소품) / 542=`3c2283b`('안 아서' 교정 누수 차단) / 547=`0edec2b`(핸드오버·게이트 76케이스) / 550=`fafbd55`(재작성 관대화 교정 — 미수정 지적 칭찬·가점 금지, 상승 근거 요구, 게이트 5문구 추가) / 555=`575c4f0`(검사·채점 자기모순 차단 — 채점 전 findRuleBasedErrors 실행해 ruleErrors 주입(ai.js 배선 포함) + corrections↔점수 일관성 규칙, 만점 금지≠감점 강제) / 556=`68f17f1`(주입 요약 3건 제한·'하나도 없다' 절대 표현 금지·다른 항목 번짐 금지 + '쥐죽은듯이' 실사례·step521/550 공존 게이트 — gate-prompts 78케이스. 지시문의 555=3f4c7f1·556=8e41d02는 오기재, 이 해시들이 정본).
- **★메인 세션 완료 트랙 step523~533 (2026-07-20~21, 공급 운영·키 경계·직행 UX)** — 커밋 단위 요약:
  - `10c9e14` step523: 공급 주제 보관(published_at null)·미공개 행 편집(역파싱).
  - `05c9e4f` step524: 후보 카드 원클릭 보관(buildSupplyRow·candidateToDraft 헬퍼화).
  - `47ed321` step525: 원버튼 실뉴스 — 그라운딩 스카우트 2단계 호출(구 SDK google_search 실증), 실패 시 시기 지식 폴백, 🔎 배지.
  - `d8ab214` step526: 스카우트 429 즉시 모델 전환 + opts.models(Lite 우선).
  - `620cd8f` step527: 스카우트 실패 로그에 키 끝4·classId 진단 — 이 로그로 keyedClass 오용 발견.
  - `42ad3bb` step528: 🚨 관리자 공급 도구 3곳(원버튼·키워드·의견 요약)이 classes.find(has_api_key)로 타 교사 학급 키를 오용하던 문제 → 본인 학급 우선으로 수정.
  - `b18a143` step529: 관리자 운영 3type을 SYSTEM_GEMINI_API_KEY 우선으로 전환(미설정 시 학급 키 폴백). feedbackSummary에 admin 403 신설(기존 무검증). resolveApiKey allowMissingKey·role 반환 확장.
  - `1977e7e` step530: 발행 목록 학급별 채택·참여 현황 패널(/api/supply-status, PII 경계: 참여 수만) + 자동 등록 시 담임 🌏 종 알림(type 'message' 재사용, 일 1회 도배 방지) — 알림은 7/21 아침 실전 통과.
  - `de1d9c8` step531: 예약 발행 원본 date=공개일 수정(생성일로 저장돼 공개 첫날부터 마감 판정되던 버그. 실사례: 시상식 조기 동결 → SQL로 date 2건 정정 + supply_final_ranks 1행 삭제 복구 완료).
  - `6745591` step532: 수정 기회 요청 배너 → 최신 요청 주제 학생 목록 직행(?topic= 진입은 기존 구현 재사용).
  - `f98f177` step533: submissions syncUrl의 ?as=(엿보기) 유실 수정.
  - ⚠️ **사고 기록 — 타 교사 키 오용(중요)**: step462~464(공급 도구 신설)부터 528 전까지 관리자 공급 생성·의견 요약이 임의 교사 학급 키로 호출됨. 발견 경위: 실뉴스 429 추적 중 527 진단 로그. 피해 범위: 관리자 단독 사용·기간 약 1주·전부 무료 한도 내(과금·데이터 노출 없음). 그라운딩은 무료 키에서 거절돼 검색 소모 0. 처리: 528 응급 수정 + 529 구조 분리(SYSTEM 키). 피해 학급 특정·통지는 실피해 없음 판단으로 종결.
  - **인프라(2026-07-21)**: Gemini ai literacy 프로젝트(gen-lang-client-0006325650)에 선불 크레딧 25,000원 구매(자동 충전 OFF, 1년 만료). 새 키(끝 JH9w)를 admin 두 학급 class_secrets + Vercel SYSTEM_GEMINI_API_KEY에 등록, 구 키 삭제 완료. Gemini API는 2026-04부터 선불 결제제(후불은 Tier3+). / 관리자 계정 2개 존재 발견: 뽀로로반(7420)·5학년 1반(1936) — 정리 여부 미결(§13 백로그). / Claude Code 2.1.215 업데이트. Fable 5는 7/19 프로모션 종료로 플랜별 크레딧 정책 변경(맥스 플랜은 포함).
- **★메인 세션 완료 트랙 step468~521 (2026-07-16~20, 챌린지 시리즈 마감)** — 커밋 단위는 git log 참조(468=d8a5238 ~ 520=70a9281). 요약:
  - **루브릭 배점 합계 100 강제(468~471)**: 편집 UI 저장 차단·라벨 경고 + 채점 감지 로그 + 공급 자동 보정 + ➗ 100점 자동 맞추기 버튼(비율 유지)·primary 강조·차단 alert 후 자동 스크롤. 직전 ⓪ 긴급 건(합 110 → 105/110 채점 실사례) 해소.
  - **전국 글쓰기 챌린지 전체(477·486~518)**: ①2차 배관(학급 설정 토글·lazy 자동 등록 `supply-adopt`·교사 원클릭 카드·🌏 배지 / 공급 원본 격리·전일 미제출 청소·재공개 버튼·갈래 안내) → ②3차 랭킹·AI 공개 검토·신고(`supply-ranking` 상위3·검토 게이트 / 학생 랭킹 UI 🥇🥈🥉·원터치 신고 / 관리자 소개 글 모니터링·학급 소개 허용 토글·집계 직접 실행·제외 사유 카운트) → ③분리 재설계 A·B·C(학생 홈 별도 카드+내 순위 / 교사 결과 조회 3단 필터 / 통계·문구 분리·참여 2회 제한·🌏 배지 전수 통일·풀네임 통일) → ④순위 동결(`supply_final_ranks` 그날의 순위 확정 저장·기록 페이지 당시 순위 🏅) → ⑤법적 안전선(랭킹·소개 대상을 학부모 동의 완료 학생으로 한정 / 동의서 글 공유 조항 v2-challenge 문구 / `consent_version` 저장+버전별 조항 분기 렌더 / `profiles.showcase_opt_out` 학부모 거부 학생 소개 제외) → ⑥신고 시 관리자 종 알림(showcase_report, step518). 부속: 신기능 안내 배너+[자동 받기 켜러 가기] 버튼, '우리 반에만 공개' 문구·즉시 툴팁.
  - **KST 날짜 전역 버그(497·498)**: KST 브라우저에서 오후 3시부터 '오늘'이 내일로 넘어가던 전역 버그 수정 + `lib/kstDate.js` 헬퍼 통합(동작 무변경 리팩토링).
  - **학생 URL 새로고침 내성(513·514)**: 학생 화면 보던 주제·기록 페이지 보던 글 상세를 URL 동기화로 새로고침에도 유지.
  - **수정 기회 요청 왕복 알림(512·515·516)**: 학생 요청 버튼(`rewrite_requested_at`) → 교사 배지·요청 학생만 일괄 허용·홈 알림 → 허용 시 학생 종 알림(rewrite_allowed) → 알림 클릭 시 다시 쓰기 버튼 직행+3초 시각 강조.
  - **API 키 무효 알림(519)**: 무효 감지 → 담임 즉시 알림(api_key_invalid, 24시간 내 1회 도배 방지) + 학생에게 원인 안내.
  - **관리자 개인 쪽지(520=70a9281)**: 교사 검색해서 관리자가 먼저 쪽지 보내기.
  - **notifications type 11종 적용 완료**(notifications_type_check, Supabase 수동 갱신): 기존 7종(grammar_done·report·admin_reply·stamp·teacher_comment·briefing·message) + 신규 4종(rewrite_request·rewrite_allowed·showcase_report·api_key_invalid). ※코드 생성처 기준 rewrite_request는 아직 미사용 — 학생 요청 측은 `rewrite_requested_at` 배지·홈 파생 계산(제약에는 선등록).
  - ⚠️ **번호 충돌: spell 473·475~478·520(0c477cf=핸드오버 문서 커밋) — 해시가 유일한 권위.** 517은 커밋 없음(결번). **521 정정(step535): 결번 아님 — `d345578`(spell 세션, 재작성 점수 하락 시 종합의견 사유 명시 강제. 시간순은 525 이후 push됨).**
- `8221bb0` — **step485: 반말 글 존댓말 오교정 금지(`lib/prompts.server.js`+`scripts/gate-prompts.js`).** NO_CORRECT_LIST 끝에 단정 문구("반말체는 글쓰기에서 완전히 올바른 문체", 문체 교정은 두 문체가 실제로 섞였을 때 다수 쪽 통일만) 추가 — 5개 프롬프트 전파. 규칙 11 다수결 지시를 AI가 뚫던 재발 대응(인천송담초 7/13·14: "좋아하셔다→좋아하셨어요"·"모셔다 드렸다→모셔다드렸어요", reason "높임말을 사용하면 더 정중한 글"). 게이트 67케이스(신규 5경로 검사).
- `be998a8` — **step484: 않나 화이트리스트 조사 구조 일반화(`lib/koreanRules.js`+`scripts/gate-korean-rules.js`).** step477의 명사 열거(기억|생각)를 구조로 일반화 — '명사+조사(이/가)+않나'→'안 나'는 항상 통과(보조용언 '않'은 반드시 '-지 않나' 꼴이라 조사 뒤 불가). 단 '-지가 않나'(믿기지가)·'-치가 않나'(만만치가)는 조사 '가'여도 정당한 '않'이라 제외(fail-safe). 문화초 7/15 ×4("실감이 않나"·"상상이 않나" 옳은 교정 차단) 구제. 게이트 71케이스. ⚠️**step484 번호 중복: spell=be998a8 / 메인=f626ae4(동의 대기 배지) — 해시가 권위.** step478도 메인(3ed0fc7)이 사용.
- (step478~483·486~520 메인 세션 상세는 위 ★완료 트랙 블록 + git log 참조.)
- `b4f272d` — **step477: 안/않 가드 과차단 구제(`lib/koreanRules.js`).** isInvalidAnhToAn에 '기억/생각 않나'→'안 나' 화이트리스트 — "기억 안 나"의 '나'는 1글자 용언이라 step405 가드(2글자 요건)가 면제 못 하던 한계(서울선곡초 ×6 실사례). → step484에서 조사 구조로 일반화됨.
- `e1cb5e3` — **step476: 수정본 채점 일관성 2항(`lib/prompts.server.js`).** ①원래 있던 결함을 수정본에서 새 감점 사유로 삼기 금지(step442 지시 누락 복원) ②의견·점수 방향 모순 금지. 인천산곡초 72→58 실사례(안 고친 글이 14점 폭락).
- `91a0cbe` — **step475: 규칙 2건(`lib/koreanRules.js`).** ㄹ받침+'때' 띄어쓰기(살때→살 때. 물때·볼때기·그때·한때·제때·오만원권 오탐 가드)·숫자+만원(150만원→150만 원). 김지우 실사례.
- `261f34b` — **step474: 표현 다듬기 오교정 금지(`lib/prompts.server.js`).** NO_CORRECT_LIST에 뜻 같은 표현 교체('거→것', '있어서→있기 때문에') 금지 — 원문이 문법적으로 틀리지 않으면 불변경(허서준 실사례).
- `c7684a6` — **step473: 수정본 채점 항목 단위 유지** — 점수 상승은 실제로 고쳐진 항목에만(step456 후광 방지). (한 줄 — 상세는 §13 완료 목록.)
- (step444~446·452~472 — 쪽지 직접 선택·모델 장애 해소·admin 4종·비밀번호 강제 설정·주제 자동 공급 1차 등. spell분: 6631ccc step455 보상 규칙 / f2948c6 step456 자리 잡다 핑퐁+재인용 가드 / 9029394·3f5bd8f·6089584 step449~451 튜터 챗봇 품질·호칭·형식. 상세는 §13 완료 목록·git log.)
- `b3d2a2e` — **step448: 규칙 12 금지 목록 단일 소스화(`lib/prompts.server.js`).** NO_CORRECT_LIST 상수 추출 — CORRECTIONS_RULES(3경로)에 더해 인라인 규칙을 쓰는 regradePrompt·rewriteGradingPrompt(핑퐁의 실제 무대)에도 반영. 이후 474·485가 이 상수 위에 누적.
- `9eeea88` — **step447: 규칙 2건(`lib/koreanRules.js`).** '다같은/다같이'(다 같은. '바다같이' 조사 오탐 가드)·'편한함→편안함' 오타. 김지우 실사례.
- `efc0da0` — **step443: 오교정 금지 규칙 12 신설(`lib/prompts.server.js`).** 조사 떼기·% 띄우기·어치·가운뎃점·복합명사 핑퐁 5유형(14회 채점 실데이터). → step448에서 상수화.
- (step410~442 — 두 세션 병렬 구간(번호 중복 다수): 게이트 신설(411)·규칙 확장(425·435)·정규화(426·427)·프롬프트 게이트(431)·날짜 주입(441)·작업 B 3인자(442) 등. §13 [완료 2026-07-09~10]의 해시 매핑표가 권위.)
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

## 2. lib/koreanRules.js — 함수 역할 + 줄 위치 (step485 기준 재확인)
| 함수 | 줄 | 역할(1줄) |
|---|---|---|
| `findRuleBasedErrors(text)` | `:10` | 정규식으로 AI가 놓친 맞춤법/띄어쓰기 보강 생성(문장부호 뒤 띄어쓰기, 할수있다, 안/않, 되/돼, ㄹ께요, 번째, 입니다/습니다, 조사 '의', 되다/시키다/하다 접미사, 였다·이였다, 의존명사 는건(step425), 사리지다(step425), 다같은·편한함(step447), ㄹ받침+'때'·숫자+만원(step475), COMMON_TYPOS 등). |
| `isAndaVerbCorrection(o,c)` | `:514` | '안다' 활용형(안아·안고·안으며) 화이트리스트 — 안/않 차단망 과차단 방지(step378). |
| `isInvalidAnhToAn(o,c)` | `:535` | "맞는 '않'을 '안'으로 바꾸는" 오교정 판정(내부 가드). step405 조기 가드: '안'+공백+2글자 용언("안 지나")은 정당 교정으로 통과. **step477·484 화이트리스트**: '기억/생각+않나'와 '명사+조사(이/가)+않나'→'안 나'는 통과(조사 뒤 '않나'는 보조용언 불가). 단 '-지가/-치가 않나'(믿기지가·만만치가)는 정당한 '않'이라 제외. |
| `isImpossibleCorrection(c)` | `:598` | 불가능 형태 교정 fail-safe 필터('안 '+어미 등, step327). |
| `findOriginalRange(essay, original)` | `:612` | original을 본문에서 찾되 공백 무시 매칭→실제 구간 인덱스 환산. `{start,end,exact,ambiguous}` 또는 `null`. |
| `snapOriginalToEssay(c, essay)` | `:645` | AI correction의 original을 공백무시로 **유일하게** 찾힐 때만 본문 실제 문자열로 스냅. |
| `mergeCorrectionsDetailed(aiCorr, essay)` | `:660` | **본체(step360 신설).** 병합 + **폐기된 항목까지 `{corrections, dropped}`로 반환**. dropped는 correction_alerts 기록(작업 C-2, step362)에 쓰임. drop_reason: 안않오교정·불가능형태(문체개입은 step409에서 필터 제거로 사라짐). |
| `mergeCorrections(aiCorr, essay)` | `:731` | 얇은 래퍼 — `mergeCorrectionsDetailed(...).corrections`만 반환(동작 불변). |

- **무의미 교정 필터(step273)** + **불가능형태 필터(step327)**가 mergeCorrectionsDetailed 안에 통합. (문체개입 필터 isStyleChange는 step393 신설→409 최종 제거되어 없음. `dropAnhFalsePositives`도 step430에서 죽은 코드로 제거되어 없음. **step560에서 `countSentenceStyles`(순수 함수) 신설 — essay 문체 다수결로 반말 압도 글의 반말→존댓말 교정을 dropped('문체역행') 폐기. isStyleChange의 문장 단독 판정과 다른 방식이라 재신설 지양 경고와 충돌 안 함.**)
- **회귀 게이트 현황**: `scripts/gate-korean-rules.js` **83케이스**(step542 +5, step560 +7) / `scripts/gate-prompts.js` **81케이스**(step556까지 78, step559 +3) → step563 86케이스. **8/19~21 spell 커밋(563·569·575~577)으로 양쪽 케이스 수 추가 증가 — 정확한 최신 수는 각 스크립트 실행 출력이 권위.** CLAUDE.md 절차 유지 중 — `lib/koreanRules.js` 수정 시 gate-korean-rules, `lib/prompts.server.js` 수정 시 gate-prompts를 커밋 전 전체 PASS 필수(규칙을 의도적으로 바꾸면 기대값도 같은 커밋에서 갱신).

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
| `step635-report-resolved-at.sql` | 학생 피드백 신고 해결 시각 `submissions.report_resolved_at`(선택 적용, 멱등). 코드는 이 컬럼 update를 별도 호출로 시도하고 실패를 무시 → **미적용이어도 정상, 관리자 "🚨 학생 신고" 목록에 해결 시각만 비표시.** 체크리스트 ⑤. |
| `step625-peer-share-views.sql` | 글 모음 열람 계측 `peer_share_views`(class_id·topic_id·view_date·created_at, FK 없음 — 주제·학급 삭제 후에도 집계 보존) + RLS(select admin만 `psv_select_admin`, 쓰기 정책 없음=service role). **10/15 적용 완료.** |
| `step619-peer-share.sql` | 우리 반 글 모음 — `classes.peer_share_enabled`·`peer_share_show_score`(기본 false) + `peer_share_overrides`(topic_id·submission_id·action add\|exclude·teacher_id, unique) + RLS 정책 없음(서버 전용, supply_showcase 관행). **10/12 적용 완료.** |
| `step606-safety-blocked-nullable.sql` | AI 안전 필터 차단 글을 점수 없이 저장하기 위해 `submissions` 점수·피드백 컬럼 DROP NOT NULL(멱등). **10/6 적용 완료.** 차단 표식 = total_score null + graded_with_model 'safety_blocked'(기존 컬럼만). |
| `step600-submissions-strict-status.sql` | 첫 채점 이중 호출 상태 `submissions.strict_status`(null/done/pending/skipped, check) + `strict_at` + pending 부분 인덱스. **10/2 적용 완료.** 서버가 컬럼 존재를 확인한 뒤에만 기능을 켠다(미적용이면 종전 채점 그대로). |
| `step402-morning-briefing.sql` | 교사 아침 브리핑 저장(step402, 병렬 세션 신설). |
| `step382-preorders-response.sql` (+`-rollback`) | 사전 신청 응답 구분 `response text`('interested'/'not_sure', default interested). RLS 불변. |
| `step380-preorders.sql` (+`-rollback`) | 파운딩 멤버 사전 신청 `preorders`(teacher_id unique·created_at) + RLS(po_select 본인/admin, po_insert 본인 teacher). update/delete 정책 없음=차단. |
| `step272-topic-copies.sql` | 공유 주제 가져오기 출처 기록(topic_copies + RLS + topic_copy_counts() RPC). |
- **⚠️ DB 객체는 Supabase SQL Editor에서 수동 실행**(자동 적용 아님). 대부분 `IF NOT EXISTS`로 멱등.
- **마이그레이션 파일 없이 Supabase 수동 적용된 것**: 알림 센터(`notifications` 테이블·RLS·`create_notification` RPC, step348) / 오교정 감시(`correction_alerts` 테이블·pg_cron 일일 스캔, step359~362, submission_id nullable; **step398에서 `blocked_user_id uuid`·`blocked_essay_excerpt text` 2컬럼 수동 추가**) / 담임 확인 도장(`teacher_stamp`, step323) / 관리자 통계 RPC(`admin_class_stats`, step333) / **C-1 일일 스캔 함수 `scan_correction_alerts`(pg_cron 0 19 * * *) — step624가 `_sql/step624-scan-correction-alerts-style-unify.sql`로 교체본 제공(수동, 적용 여부 다음 세션 확인)**. → 스키마는 코드 커밋이 아니라 각 step 커밋 메시지 + 실제 Supabase에 존재.

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
- **★첫 채점 이중 호출(step600·601, 2026-10-02 SQL 적용)**: 첫 글 채점(ai.js type grading) 앞에 **전용 검사를 선행**해 결과를 gradingPrompt의 ruleErrors(자동 맞춤법 검사 요약 블록)에 주입하고, 채점 후 corrections에 합친다(original 기준 dedup, 전용 검사 우선). 공용 모듈 `lib/strictCheck.server.js`(서버 전용 — 클라 import 금지). 조건: grammarStrictPrompt + grammarOnly 스키마 + **모델 3.1-flash-lite 고정·재시도 0·타임아웃 8초**(수동 재검사의 체인 폴백과 다름). **교사 60초 가드**: 교사 학급들의 최근 60초 저장 submissions N≤5일 때만 실행(저장 기준이라 ~15초 지연 근사). N>5·429·타임아웃 → `strict_status='pending'`(현행 규칙 주입만), 일반 실패 → 'skipped'+error_logs(page 'api/strict'). **보완 큐**: Hobby 플랜(크론 2개·일 1회)이라 2분 크론 대신 ①학생 결과 화면 배지 폴링(`/api/strict-backfill`, 10초 뒤 첫 호출·30초 간격·최대 10분, 폴링이 보완 실행을 겸함) ②일일 크론 `cron-trash-cleanup`의 sweepPending(pending 10분+·교사당 4·총 30·50초 예산). 24시간 넘은 pending은 skipped 종결. **수정본·재평가 경로는 미적용(의도된 비대칭 — 계약 2.0 신규 무감점으로 학생 불이익 없음).** 근거: step597/599 실험(15편) 전용 검사 +23%, 편당 실제 오류 +2.2건, 오교정 1/6. 3.5-flash-lite는 오교정 7건으로 탈락. 비용: 첫 글 1편=호출 2회 → 교사 풀 500 RPD에서 일 250편 상한. ⚠️ `lib/apiThrottle.js` 인스턴스 전역 12 RPM 제한은 미수정(호출 2배로 "분당 호출 한도 보호" 대기 증가 가능 — 관찰). **실험 결과 상세(597/599, 15편, 10/8 정리)**: 통합 94 / strict 3.1 116(+23%) / 진짜 신규 33건(편당 2.2) / 다듬기 오교정 통합 6 vs strict 1. 3.5-flash-lite는 2회 실험에서 내용 변경 교정 재현(4건)+매회 다른 오교정(5건)으로 탈락, 3.1 유지. **운영 수치(10/8)**: 10/2 이후 첫 글 done 97%·pending 3%. 모델 3.1-flash-lite 무료 15 RPM/500 RPD, 교사 키 운영(**시스템 키 비용 전가 금지 — 무료 운영 원칙**).
- **CORRECTIONS_RULES 규칙 11(현재 step403판):** 문체 오교정 4원인 차단 — ①일관된 글은 문장 끝맺음 다수결로 판정해 문체 교정 금지 ②표현 다듬기(있어서→있기 때문에 등) 금지 ③마침표 없는 문장중간을 문장끝으로 단정 금지 ④내용 단어 교체(사건 해결이다→사건들입니다) 금지. **변천: step395 강화 → step397 "섞였을 때만 통일" → step403 4원인 차단.** 상수 단일 소스라 세 프롬프트 자동 반영. **문체 판단은 이제 이 규칙 11(프롬프트, 예방)이 단독 전담.** `koreanRules`의 fail-safe 필터 `isStyleChange`는 step409에서 최종 제거됨(옳은 통일 지적·맞춤법까지 오차단한 데이터 확인). 틀린 문체 교정은 여전히 프롬프트에서 예방하고, cron 감시(correction_alerts)로 다른 유형 오교정을 계속 수집. **(최신 상태 보정: step560에서 코드 레벨 차단이 essay 다수결형으로 재도입됐고, step609(`a9c2a8e`)에서 '~입이다' 오타+'입니다' 교정은 폐기 대신 '이다'형 치환 통과 — §1 변천 요약 참조.)**
- **NO_CORRECT_LIST(규칙 12, 오교정 금지 목록 — step443 신설→448 상수화, `lib/prompts.server.js:27`):** 단일 소스가 **5개 프롬프트에 전파** — CORRECTIONS_RULES 경유 3경로(gradingPrompt·grammarStrictPrompt·grammarOnlyPrompt) + 인라인 2경로(regradePrompt·rewriteGradingPrompt, 핑퐁의 실제 무대). 현재 항목 8개: 조사 떼기 / 숫자·% 띄우기 / '-어치·-짜리' 떼기 / 가운뎃점 변경 / 복합명사 핑퐁(제주지역) / '자리 잡다' 핑퐁+반대 재교정 금지(456) / 표현 다듬기 '거→것'(474) / **반말 글 존댓말 교정 금지(485 — "반말체는 완전히 올바른 문체" 단정, 규칙 11을 뚫는 재발 대응)**. 항목 추가 시 gate-prompts.js의 KEY_PHRASES(3경로)+R12_PHRASES(인라인 2경로) 양쪽에 검사 문구도 추가할 것.
- **★rewriteGradingPrompt 현재 체제 = 계약 2.0(`lib/prompts.server.js:293`, spell step596 + main step595 배관 + step597 스키마 설명):** 8인자 구조화 이월 — prevScore·prevCorrections·prevFeedback(step442) + prevImprove·prevImproveExamples(591·593) + **prevEssay(직전 본문 2000자 상한)·prevScores(직전 항목 점수)·changeFacts(서버 계산: 글자 수 N→M(±k%)·추가된 문장·삭제된 문장 각 ≤5개)(595·596)**. 2.0에서 바뀐 것: '첫 글'→'직전 글'(학생 대면 '지난 글'), 항목 점수 출발점=직전 항목 점수, 반영 판정 근거=추가된 문장 인용, 추가·삭제 0+글자 수 동일이면 동일 점수+'지난 글과 같아요', 신규 무감점은 기계적 오류(맞춤법·띄어쓰기·문장부호)만(내용 훼손 추가는 인용 시 감점 허용), **하락 허용 4종 열거 폐기 → 하락 근거 규칙(추가/삭제 문장 그대로 인용 필수·변경 사실과 모순되는 사유 금지·인용할 문장 없으면 하락 불가, 4종은 예시로 강등)**, score_drop_reason=인용 포함 한 문장(없으면 빈 문자열 "" — null 아님, 597)·overall 첫 문장=그 사유. 각 블록은 null·형식 불일치면 그 블록만 생략(기존 폴백 유지). 교훈: **모델에게 판단을 시키려면 재료(본문·사실)를 줘야 한다** — 4종 열거만 주면 거짓 사유를 지어낸다(9/16 6975 "대화의 양이 줄었다"). 아래는 1.0(591) 이력 — 정책은 "엄격화"→**"조언 이행 계약"**: ①첫 글 점수=기준선(같은 잣대·같은 엄격도) ②첫 글 조언을 항목별 반영/부분/미반영 판정, 반영분은 반드시 상승·미반영은 유지(559 인용 강제 → 반영 확인 의무로 대체) ③첫 글에서 지적하지 않은 신규 오류는 무감점('다음엔' 안내만; 555·556 주입은 자기모순 방지 전용) ④하락은 4종(분량 급감·주제 이탈·복붙·내용 삭제)만 허용 + score_drop_reason 필수 + overall 첫 문장=사유(칭찬 시작 금지) ⑤만점 억제는 첫 글 채점(gradingPrompt 원칙 11)으로 이전. 이전 일관성 규칙(442·455·456·473·476)은 이 계약 아래로 재편. 하락 사유 그릇은 `SCHEMAS.rewriteFeedback.score_drop_reason`(step588, 설명은 591에서 'scores의 합' 기준). 상한: 지적 20개+'외 N건', 총평 500자. **★608·610 보강(10/8, 송림초 82→99 실사례)**: 규칙 11에 **(타) 항목 점수 변경=그 항목의 변경 문장 인용 필수·전 항목 일괄 ±1 금지 / (파) [변경 사실]이 '표기만 변경'이면 맞춤법·문법 항목만 조정·나머지 동결**(해당 항목 없으면 전부 동결). changeFacts는 이제 `lib/changeFacts.js`(main 608 fb7dc11): 글자 수가 공백·문장부호 제외, 문장 비교는 포함 판정, `notationOnly`(정규화 동일 또는 편집거리 ≤ max(3, 1%)·최대 6)·`addedCount`·`removedCount` 포함. 프롬프트 판정 순서(spell 610 7096fdf): notationOnly===true → '표기만 변경' 줄(변경 없음보다 우선) / false + 추가 0·삭제 0·글자 수 동일 → '변경 없음' / 필드 부재 → added/removed 자체 판정 폴백. 추가·삭제 줄은 "추가된 문장 N개(수정본에만 있음, 앞 5개만 표시):" 실제 개수.

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

**[★10/28 재측정 — 접근성·글 모음 (10/8 기준선 → 10/28, 같은 SQL)]**
- 자동 받기 ON **6→8**(278 중, 발행은 했음) / 공유 가져가기 **16→16** / 글 모음 켠 반 **0→5**(공지 없이) / 열람 **95회**(카드 노출 횟수).
- 결론: **글 모음은 통함**(실물이 있는 스위치는 눌림). **챌린지는 공급 빈도가 병목** → 발행 루틴(매주 1편) 제안(체크리스트 ④). 카테고리 재검토 종료 유지.

**[★진입 성능·튕김 637~641 — 2026-10-28~29]**
- 분석(10/28, 읽기 전용): 첫 화면까지 직렬 왕복 **학생 6·교사 11·관리자 15**. 학생 홈이 쓰지도 않는 `/api/supply-adopt` 응답(함수 콜드+서버 쿼리 5~7, 최대 4초)을 동기로 기다림. 진입 profiles 401은 복구 없이 로그인으로 튕기고 기록도 없었음.
- 수리: 637 학생 supply-adopt 비차단(adopted에 새 id 있을 때만 챌린지 카드 재조회) / 638 교사 11→3·관리자 15→2 병렬화 + 탭 재료 지연 로딩, getUser→getSession(getEffectiveProfile·관리자) / 639 Speed Insights + 교사·관리자 `[perf]` 로그 / 진입 401 refresh 1회 후 재시도 + 튕김 로그 `auth_bounce`(637 클라 insert → 641 익명 서버 API, 분당 30·일 300/IP, 세션 없음·토큰 거절도 기록). 관리자 분류기 "🟤 진입 튕김".
- 사용자 체감 **"전보다 빨라짐"**. **엣지 튕김 원인 미확정**(DNS·학교 정책·QUIC 전부 아님, 보안 DNS는 정책 관리) → 1주 뒤 auth_bounce 사유별 집계로 판정(체크리스트 ②).
- 발견: 사용자 학교망에서 **vercel.app ERR_TIMED_OUT 실증** → 도메인 구입 트리거 발동(체크리스트 ③). 당분간 학교 PC는 크롬.
- Speed Insights: 10/29 이미 활성·수집 중(RES 99, 월 1만 건 중 122). **RES 99는 CSR 특성상 체감과 무관**(보조 지표). 체감은 각 홈 `[perf]` 총계.

**[★채점 지연·폴백 — 분석 2 + 수리 643~645 (2026-10-29)]**
- 실측(14일): 폴백 **26/2070(1.3%, 10/16 11건 급증)**. 주범 후보 **503 구글 혼잡 59건·60초 타임아웃 7건**(전부 3.1-flash-lite, 주로 수정본). error_logs에 429는 0건.
- 발견·수리: ⓐ **분당 429를 일일 한도로 오판**(종전 'PerProjectPerModel' 문자열이 분당 quotaId에도 포함) → 즉시 폴백 → 2순위(5 RPM) 실패 — errorDetails 판정·retryDelay 대기(≤20초)·서버 한도 기억(**644**) ⓑ 예시·채점 프롬프트 "초등 5학년" 고정 — spell 학년 인자(4b713eb) + 메인 서버 조회 전달(**645**) ⓒ 수정본 교정 규칙이 첫 글과 달라 밑줄 증가 — spell 정합(fac04c4) ⓓ pending 적체 70건대(교사당 4건 상한이 만료 종결에도 적용) — 만료분 일괄 종결(**645**) ⓔ 수정 화면 예시 버튼(**644**). **503→폴백 전환은 보류**(채점자 바뀜 비용).
- 작업 2 보고 정정: SDK 0.21은 429 details를 `errorDetails`와 메시지 꼬리 양쪽에 싣는다(작업 2의 "메시지에 없음"은 오류). 폴백 분기 자체(429·503 4회 실패 후 throw, 폴백은 타임아웃·404·일일 한도·MAX_TOKENS만)는 사실.
- ★**측정 체계 신설(643)**: `submissions.grading_ms`(제출 확정→AI 결과 수신 ms)·`grading_path`(SQL **적용 완료**) + 관리자 "⏱ 채점 시간" 칩(일별·학급별 p50/p95/최대·60초 초과). **교훈: 8월~10월 AI 과정 수정이 매번 새 불만을 낳은 공통 원인 = 실측 없음. 이후 처방은 이 숫자로**(체크리스트 ①).
- 쓰로틀 14 유지 여부는 **AI Studio 실제 RPM 확인 후**(미확인, 체크리스트 ⑤). 공식 문서는 무료 수치 미게재.

**[★초안 유실 사고 — 2026-10-30 (분석 → 651·652 수리)]**
- **증상**: 10/30 아침, 본인 반 학생이 쓰는 중 "로딩 중" 표시 → 빈 화면 → 복원 안내 없음. 서버 저장 0건, 오류 로그 0건.
- **분석 결론**(읽기 전용, `_last-report.md` 10/30 1차): ① **"로딩 중"은 페이지 전체 새로고침에서만 뜬다**(글 쓰는 중 loading을 켜는 코드는 "다시 시도" 버튼뿐; 세션 갱신·자동 받기·배지 폴링은 무관) ② **최유력 경로 = 오늘 주제 조회 error를 "0행"으로 오판**(652행 error 미검사) → "오늘은 글쓰기 주제가 없어요" 화면 → 초안 읽기 코드 미도달(초안은 기기에 남아 있음) ③ 복원 배너가 뜬 뒤 **한 글자만 쳐도 1.5초 뒤 옛 초안 덮어쓰기** ④ VersionChecker가 새 배포 감지 상태에서 **30자 미만 글은 탭 이탈 시 자동 새로고침** ⑤ **10/29 배포 18건이 12:00~14:36 수업 시간**에 나감. 그 밖에 키 불일치(다른 주제가 열림)·4개 초과 정리·저장소 실패·종 알림 클릭 confirm 없음.
- **처방**: **651 게임식 저장 슬롯**(`lib/draftSlots.js`: 주제·단계별 5개·전체 20개, 80자 이상 변화·3분 경과면 새 슬롯, 📂 버튼 상시(첫 글·수정본·주제 없음 카드), 구 초안 자동 이관, visibilitychange 저장, 조회 error → 재시도 화면) / **652 글쓰기 중 자동 새로고침 금지·전환 confirm**(VersionChecker body[data-writing], switchTopic·쿼리 감시자). 복원 배너·prev 키 방식은 폐기.
- **운영 규칙: 배포는 수업 시간(09~15시) 밖.** 10/30은 사용자 결정으로 **13:55 즉시 배포(위험 수용)** — 구버전 탭은 이번 한 번 30자 미만 자동 새로고침 가능, 글은 구 키로 남아 새 버전에서 📂로 이관.
- **실검증·유실 글 복구 결과: 사용자 확인 후 기입.**(실검증 항목: F5 → 📂 불러오기 / 계속 쓰기 → 슬롯 2개 / 와이파이 끊고 F5 → 재시도 화면 / 주제 없을 때 📂 / 전환 confirm / 새 배포 뒤 배너만. 유실 글: 그 기기·그 학생으로 진입 → 📂에 이관된 글 → 제출 0건이면 불러오기, 주제 바뀌었으면 복사하기.)
- 후속 후보: **서버 측 초안 저장(기기 간 복구)** — 체크리스트 ⑪.

**[★신고 144건 판독 — 2026-10-29 (읽기 전용 SELECT, 실명·본문 미조회, 사유 104건 손 분류 ±3)]**
- 총 144건(미해결 141, 2026-06-17~10-28, 7월 초 정점·10월 14건). **수정본 106 : 첫 글 38**(74%).
- 사유 유형 분포(144 기준): **빈 사유 28%(40)** · **장난 7%(10)** / **오교정 왕복·맞춤법 지적 오류 18%(26)**("가전 제품↔가전제품", "매일매일", "어린아이들", "'않습니다' 계속 틀리다고") / **내용 오독·예시 왜곡 15%(21)**("바통이 아니라 손 터치인데", "사촌인데 예시는 사촌누나") / **점수 불만 11%(16)**(수정 후 하락·안 오름) / **피드백 품질·요구 11%(16)**("너무 짧아요", "계속 고치래") / 이해 안 됨 4 · 문체·학년 3 · 기타 8. 빈 사유 평균 점수 70(최저).
- 집중 학급 상위 5: 동북초 5-2 12 · 대구범어초 4-1 11 · 송림초 5-6 9 · 대구범어초 4-8 6 · 신양초 6-4 6(상위 5 = 31%). 주제 1위 독서감상문 쓰기 10.
- **결론: 품질 6 : 안내 4.** 사유 있는 104건의 약 60%(63)가 오교정 왕복·내용 오독·점수 하락이라는 실질 불만이고 수정본 집중과 일치. 안내 문제(빈 사유+장난 50건, 35%)는 원터치 신고가 사유 없이 눌리던 UI 때문.
- 처방: ① **신고 사유 칩 필수 + 하루 3회(step649)** — 이후 신고는 "[태그] 상세"라 태그로 바로 집계 ② **spell 이관 3건**(복합어 띄어쓰기 오교정 왕복 · '않습니다/않아서' 미인식 · AI가 글에 없는 사실을 말하는 오독에 대한 사실 유지 규칙) — **spell 창 작업 중, 커밋 번호는 spell 보고로** ③ 이미 처방된 것: 학년(645)·문체 왕복(spell 637)·수정본 교정 규칙(spell 644)·무감점 범위(spell 640).
- 판정 계획: **11월 태그 기준 재판독**(같은 스크립트 + parseReportReason)으로 637~649 효과 판정 — 빈 사유 0 기대, 오교정 왕복·내용 오독 비율 감소 여부(체크리스트 ⑦).

**[★학생 의견 10/14~28 + 백로그 — 2026-10-29]**
- 송림초 5-6 "느려요" 다수(10/27 "빨라졌어요" 1건 혼재) / 김래오(대구범어 4-8) 3건 → ⓑⓒ로 종결, **답장 예정** / 이지안 "예시가 수정 때 안 떠요" → ⓔ / 김우진 "랭킹 전부 보고 싶어요" → 백로그.
- 학생 신고 **144건(미해결 143)** = 품질 데이터 — 샘플 판독 미착수(체크리스트 ⑦).
- 백로그: 비동기 채점(p50 결과 후 결정) / 503 폴백 정책 / 신고 목록 인라인(사유+AI 피드백 첫 줄)+👁 바로가기 / 관리자 빠른 엿보기 검색(학교·반·번호) / 챗봇 품질(사례 수집) / regradePrompt 교정 정합(spell) / 랭킹 전체 보기 / 학생 답장 배너 학급 토글 / RLS 조이기 / students.js 버그 / 인디스쿨 2탄 / 글 모음 2단계.

**[★문체개입 감시 판정 정정 + spell 637·640 — 2026-10-29]**
- 10/14~10/28 '문체개입' 미해결 38건을 글별 문체 분포(반말·존댓말 문장 수)로 전수 대조한 결과, step624 styleUnify 표식·스캔 함수·배포 모두 정상. "624 미작동"은 오판.
  ① 반말 위주 글(반말 13~17:존댓말 1)에서 AI가 반말→존댓말로 바꾼 진짜 개입 10건("아니다→아니에요") → 탭 노출 정상, 원인은 AI의 지시 불이행.
  ② 반말 위주 글에서 존댓말→반말 7건("하세요→해라", "때문입니다→때문이야") → 지시대로지만 어색, 표식은 -다 끝만 인식.
  ③ 존댓말 위주 글의 옳은 통일인데 표식 누락 3건(문장 중간 마침표 "장점.걸어가면…" ×2, 쌍반점 "할것이다.;") — 진짜 누락은 이것뿐.
  ④ 동률 2건(minority null). ⑤ reason에 '문체'만 들어간 비문체 교정(띄어쓰기·오타·내용) 16건.
- 처방: spell 637(`buildStyleLine` 반말 다수 분기 신설 — 양방향 문체 교정 금지, 존댓말 다수→반말 소수 통일 강제는 유지. gate-prompts 163→168), spell 640((마) 조항에 문법·활용 오류 추가. 10/15 하락 1건 '놀는게' 사례. 체크리스트 ⑥ 종결).
- 관찰(11월 중순): 10/29 이후 반말 위주 글의 문체 교정 건수 감소 여부(글별 분포 SQL은 claude.ai 인계 메모에 보관) · 수정본 하락 사례에서 어미·조사 감점 소멸 여부. 결과 따라 koreanRules 존댓말→반말 후처리 필터 여부 결정.
- 후속 후보: styleUnify 끝 기호 집합에 ; : 추가·문장 중간 마침표·동률 처리(③④ 5건) / reason '문체' 오분류 16건류 차단 / CORRECTIONS_RULES 본문에 같은 원칙 한 줄.
- Speed Insights(639): 10/29 확인 결과 이미 활성·수집 중(종합 점수 99, 월 1만 건 한도 중 122). 세부 지표는 유료라 미표시. 종합 점수 추이만 관찰.

**[★전략 결정 — 2026-08-24~09-15 (step594 마감 기록, 이 블록이 최신)]**
- **수익화**: 제품 내 수익화 메시지 **0 정책**(step581 사전신청 UI 제거). **공과금형(의존 형성 후 요금) 확정 방향.** 기응답 교사에게 한 '가장 좋은 조건 우선 안내' 약속은 유료화 공지 시 1:1 쪽지로 이행(**부채**).
- **사과나무 원칙 — "밀지 말고 발견하게"**: 결정 순간(지갑·가입·추천)에만 적용. 사용법 안내는 계속 행동요령으로 확실히. 적용표: 인디스쿨 2탄=경험담·도구명 1회 / 챌린지 쪽지=내용물 보여주기 / 앱 안 사과나무=챌린지·주제 공유·맛보기·자투리 풀코스 / **교무실이 진짜 마당(SNS 채널 안 만듦)** / 유료화 시 요금 안내는 조용한 자리.
- **챌린지 콜드스타트**: 참여 학급 = 사용자 반 1개뿐. 드라이브 쪽지 초안("매일 아침 글감 자동 도착"+"첫 주인공")은 **10/8 폐기** — 전제가 틀림(챌린지는 관리자 수시 발행, 매일 아님). 대체 = 앱 안 사과나무(주제 관리 카드·전국 주제 모음, step611~614). "매일" 표현은 모든 문구에서 금지.
- **도메인**: '기한'에서 **'트리거'로 하향** — 학교망 차단 신고 1건이라도 오면 즉시 구입, 그 전엔 한가한 주에.
- **의견 처리 규칙**: 제안 = 발견성 결함 신호. 이미 있음→화면 힌트·도움말 수정+한 줄 답변 / 만들 가치→백로그+한 줄 / 반복 제안→우선순위 상향. 의견 탭 '답변 저장'(step205)이 종 알림으로 가므로 쪽지 불필요. 실사례: 최유라(하랑초) 카테고리·복수 주제 → step589로 해소, 답장 완료.
- **카테고리 — 10월 재검토 완료, 유지·종료(10/2)**: 5개월간 직접 선택 46건뿐(랜덤 500+) = 발견성 실패 확정 → step589 4묶음 21개 통일. **589 이후 한 달 직접 선택 7건(전부 첫 칸 '일상 경험') = 사용률 불변, ▼옵션 접힘이 벽.** 골고루 모드가 4묶음별 추출이라 미선택자도 다양성 확보 → **추가 UI 안 함. 같은 의견 재발 시만 재론.**

**[★수정본 채점 계약 2.0 — 완성 (2026-09-16~10-02: main 595 배관 + spell 596 프롬프트 + main 597 스키마 설명, §7 rewriteGradingPrompt 절과 짝)]**
- **발단**: 9/16 6975 재현 — 장난 줄을 추가한 수정본이 −10 하락했는데 사유가 "대화의 양이 줄었다"(**거짓 사유**). 원인 두 가지: ①모델이 직전 본문을 못 봐 분량 변화를 지어냄 ②1.0의 하락 허용 4종 열거가 "4종 중 하나를 골라 쓰라"는 신호로 작동해 거짓 사유를 유도.
- **구현**: 595(a1a89f9) fetchPrevGrading에 essay_text + computeChangeFacts(공백 제외 글자 수·deltaPct·추가/삭제 문장 각 ≤5개·120자) → rewriteGradingPrompt 3인자(prevEssay·prevScores·changeFacts) / 596(5271ae7) [직전 글 본문]·[직전 항목 점수]·[변경 사실 — 서버 계산, 사실로 취급] 블록 주입, '첫 글'→'직전 글', 반영 판정=추가 문장 인용, 신규 무감점=기계적 오류만, **하락 사유=추가/삭제 문장 인용 필수·사실 모순 금지·인용 없으면 하락 불가** / 597(e48e123) score_drop_reason 설명 "인용한 한 문장, 없으면 빈 문자열 """(null 아님 — 스키마 non-nullable·서버 string 판정).
- **교훈**: 모델에게 판단을 시키려면 재료(본문·사실)를 줘야 한다. 열거형 허용 목록은 거짓 사유의 메뉴판이 된다.
- **메인 후속(백로그 유지)**: 학생 화면 "반영한 조언 ✓ → 항목 점수 ↑" 표시.

**[10/1 판정 — 통과 (1.0 지표, 14일 창)]**
- 646쌍: 상승 94% / 정체 2% / 하락 4% · 하락 사유 표기 8/8 · 칭찬 시작+하락 자기모순 0 · 첫 글 95+ 2%(평균 77.1). 1.0 지표 ⓐ~ⓓ 전부 통과.
- 의심 교정 탭 전수로 **2.0이 없애야 할 세 유형** 확인(전부 596 배포 전 건): (i) 고득점 미세 하락 + 사유 없음(교정 수 증가 기인) (ii) 미반영 사유 하락 (iii) '유지'라 쓰고 하락.
- **★10/15 재판정 기준 = 세 유형 0건 + 피드백에 "첫 글" 문구 소멸 + score_drop_reason에 인용(따옴표) 포함.** ⓐ(상승률)·ⓓ(첫 글 95+)는 step600 이중 호출 영향(첫 글 교정 수↑→첫 글 점수↓→상승률↑)으로 해석 불가 → **추이로만 기록, 판정 기준에서 제외.** 판정 SQL 3개는 아래 1.0 블록의 것 그대로 사용.

**[★첫 채점 이중 호출 — step600·601, 2026-10-02 SQL 적용 완료 (§7 이중 호출 절과 짝)]**
- **동기**: 597/599 실험 스크립트(strict vs grading, 15편) — 전용 검사가 통합 채점보다 +23%(편당 실제 오류 +2.2건), 오교정 1/6. 3.5-flash-lite는 오교정·깨진 출력 7건으로 탈락 → 3.1 동일 풀.
- **구조**: 전용 검사 선행·주입(gradingPrompt ruleErrors) → 채점 → union 병합 → `strict_status`. 교사 60초 가드 N≤5. pending 보완 = 학생 폴링(StrictPendingBadge, 10초 뒤·30초 간격·10분) + 일일 스윕(cron-trash-cleanup). **Hobby 크론 제한으로 2분 크론 미구현** — 화면을 닫은 글은 다음 날 새벽 보완. 학생 2단계 문구·대기 배지·교사 칩(601). 시스템 키 비용 전가 0(전부 학급 키).
- **측정 영향(해석 주의)**: 첫 글 교정 수↑ → 첫 글 점수↓ → 수정본 상승률↑ 가능. **수정본 경로는 전용 검사 미적용(의도된 비대칭 — 2.0 신규 무감점으로 학생 불이익 없음).**
- **관찰 1주(~10/9)**: 제출 지연 체감 의견 / pending 비율·done 전환 시간(`select strict_status, count(*) from submissions where created_at > now()-interval '7 days' group by 1`) / skipped 사유(error_logs page='api/strict') / Vercel "분당 호출 한도 보호" 로그 빈도 / 교사 풀 소모(일 250편 상한) / `[strict-inline] N=…` 가드 발동 빈도.
- **spell 이관**: gradingPrompt '자동 맞춤법 검사 요약' 블록이 이제 규칙+전용 검사 합본(건수↑)을 받아 "만점 금지" 발동↑ — 관찰 후 문구 조정 판단(lib/prompts.server.js).
- 후속 후보(관찰 후): 가드 상한(5) 조정 / apiThrottle 인스턴스 전역 12 RPM 완화(lib/gemini.js·lib/apiThrottle.js) / Pro 전환 시 sweepPending을 2분 크론 엔드포인트로 노출 / correction_alerts 학생 SELECT RLS(퀴즈 fail-open 경고 시).

**[퀴즈 안전화 — main 598 c96fd73 / spell 598 df52b48 (2026-10-01)]**
- 학생 의견 3건(동북초 5-2 김재인): 동일 보기("여름 방학" vs "여름 방학"=NBSP) · 정답 "안 는"(과거 저장분) · 문맥 없음 → main: 현행 필터 재적용·정규화·의심 기록 제외·문맥 1줄·규칙 검증 쌍 우선. spell: 무의미 필터 정규화(저장 단계 원천 차단) + '않나+용언' 과차단 수정.
- **관찰**: 재료 축소로 "기록 부족" 체감 의견 / 콘솔 "의심 교정 기록 조회 실패" 경고(correction_alerts 학생 RLS — 뜨면 정책 1건 또는 서버 이전). **답장 완료(확인 중) → 배포 확인 후 "고쳤어요" 한 줄 예정.**
- 기저장 무의미 교정 DB 정리는 **보류**(건수 조회만 백로그).

**[수정본 채점 정책 전환 1.0 — 2026-09-15 (spell step591 + main step593) — 이력, 2.0로 승계(위 블록). 판정 SQL은 계속 사용]**
- **발단**: 교사 의견 "AI 조언대로 고쳤는데 안 오른다". 데이터: 30일 1,213쌍 상승 71% / 정체 14% / 하락 15%(8월 목표 '하락률 10~15%' 달성 상태). 7월 중순은 92/5/3. 하락 실물 5건 중 4건이 **칭찬 시작+무사유(자기모순)**. step588은 스키마 그릇만 있고 프롬프트 지시가 없어 미작동이었음.
- **재검토 결론**: 8월은 '객관성'을 목표로 두고 '엄격화'를 얻음 — **지렛대 오류. 하락률 목표치 폐기.**
- **새 계약 5원칙**: ①같은 잣대·첫 글 기준선 ②조언 이행=해당 항목 반드시 상승(559 인용 강제 → 반영 확인 의무로 대체) ③첫 글 미지적 신규 오류 무감점('다음엔' 안내만; 555·556 주입은 자기모순 방지 전용) ④하락은 4종(분량 급감·주제 이탈·복붙·내용 삭제)만 + 첫 문장 사유 필수 ⑤만점 억제는 첫 글 채점으로 이전(gradingPrompt 원칙 11).
- **구현**: spell `6caf31e`(프롬프트 + gate-prompts 114/114) + 메인 `fdc23b2`(ai.js prevImprove·prevImproveExamples 배관). 보조: main 590(감시 한글화·자동 해결)·591(합계 확인 절).
- **새 지표(판정 9/29 전후, 2주)**: ⓐ조언 반영 수정본 상승률 90%+ ⓑ하락 사유 표기율 100% ⓒ칭찬 시작+하락 자기모순 0 ⓓ첫 글 95+ 비율 20% 미만. 보조 지표: 591 '합계 확인' 불일치 비율(AI total≠scores 합) — 높으면 서버 total 덮어쓰기+직전 기준 통일 검토.
- **6975 실검증 대기**: 첫 글 → 조언 2개 반영한 수정본 → 상승 + 첫 문장 "지난번에 말한 ○○를…".
- **메인 후속(백로그)**: 학생 화면에 "반영한 조언 ✓ → 항목 점수 ↑" 표시.
- **판정 SQL(기록용, 14일 창)**:
  ```sql
  with pairs as (select s1.total_score f, s2.total_score l, s2.feedback_overall o from submissions s1
   join submissions s2 on s2.user_id=s1.user_id and s2.topic_id=s1.topic_id and s2.attempt=2
   where s1.attempt=1 and s1.deleted_at is null and s2.deleted_at is null and s1.total_score is not null
   and s2.total_score is not null and s2.created_at > now() - interval '14 days')
  select count(*) pairs, round(100.0*sum((l>f)::int)/count(*)) up_pct, round(100.0*sum((l<f)::int)/count(*)) down_pct from pairs;
  ```

**[운영·도구 — 2026-08-24~09-15]**
- 보고 전달 규칙(step587): v2 보고를 `_last-report.md`에 덮어쓰고 `/report`로 클립보드 복사.
- 관리자 오류 분류기(step585·586): 반곡초 iPad 계열(Load failed)·외부 스크립트(Script error.)는 무시 가능 처리. 서버 AI 실패는 upstream 원인 동봉.
- 세션 만료: 8/6 17회 → 8/20 4회(571~573 효과 관찰 중).

**[★운영 모드 — 개학 직전 (2026-08-21 기준)]** (step580 갱신)
- 8/19~21 세션 = 개학 대비 온보딩 개선(562~566)·엿보기 완성(568~570)·제출 중복 사고 종결(578~579). **판정은 전부 개학 주간.**
- **신규 온보딩 현행 상태**: 신규 교사 홈 체크리스트="처음이세요? 첫 수업까지 5단계"(필수 배지·10분·최상단) / 유료 카드=수업 3회+ 문턱 / 챌린지 배너=학생 1명+ / 모달 ✕=오늘만+다시 보지 않기. **dismissed 의미가 '명시적 거부'로 변경 — 깔때기 해석 주의.**
- **엿보기 = 화면 일치+쓰기 전면 차단 완성** → 테스트 계정 매번 생성 불필요. 잔여 (a) 전환: submissions.js 버튼 7곳·students.js·MessageBell(백로그). 테스트 계정 qwer123(하랑초 5-1) 존재.
- **최우선 원칙 재확인: 인지 피로 줄이기 — 모든 화면은 설명이 아니라 행동요령.**

**[★유료화 논의 진전 — 2026-08-19 병목 검증 세션 1차]**
- 수업 전/자투리 단계 지도 작성. 수확: ①실뉴스 교사 개방=인프라값 유료 후보(보류) ②등록 마찰의 정체='학부모 동의' 단어 부담 → 행동요령 처방(562) ③앱 무대=수업이 아닌 **자투리 시간** → "자투리 전체 해결" 포지셔닝(타자 연습·다 쓴 학생 활동 등 '자투리 풀코스' 백로그, 무료 바구니).
- 요금 모델: 플랜형(넷플릭스식) 재검토, **공과금형(인터넷비식 — 의존 형성 후 요금) 검토 개시**. '기존 무료 소급 잠금 없음' 원칙과의 충돌 설계 필요. **결정은 가격 쪽지 답장+개학 데이터 후.**

**[사고 후속 백로그 — 8/20 제출 중복(§1 사고 기록 참조), 보류 유지]**
- ⓐ DB 부분 유니크(user_id, topic_id, attempt) — step284 잔재·'별개 글 8건' 정리 후에만.
- ⓑ 학생 화면 잔여: history 처음글 산정·대표행 타이브레이커·랭킹 dedupe.
- ⓒ +N점 3차+ 비단조 케이스.
- (a) 엿보기 잔여 전환: submissions.js 버튼 7곳·students.js·MessageBell.

**[운영 모드 이력 — 방학 (2026-07-22~8/20)]** (step557 기록, 8/4 갱신)
- 7/22부터 전면 방학. **챌린지 방학 발행 = 중단 확정(8/4 사용자 확정, 주 2회 권고안 기각). 개학 시 재개 판단.**
- 깔때기 개선(552) 효과·550 판정·등록 카드 따라감 25%+ 판정 전부 **개학 후로 연기**.
- 방학 공사 후보: ①알림 센터 설계는 **보류 유지(8/4)** ②백로그 소탕 ③개학 드라이브 준비. 재활성 일괄 쪽지 시퀀스는 **사용자 결정으로 스킵("쓸 사람은 쓴다")**.

**[★spell 갱신 2026-08-24 — 수단 A 완료·관찰 목록 교체 (이 블록이 §1 스포 안내 구판보다 권위)]**
- ✅ **수단 A(미검출 전수조사) 완료**: AI·규칙이 모두 놓친 오류 전수조사 → 규칙 7종 편입(step575 `b4ed4b9`) + '밖에' 양방향 핑퐁 발견·차단(step576 `f4ea75a`). **루틴 등재: 월 1회 재실행 권장**(새 미검출 유형 수확용).
- **게이트 현황: gate-korean-rules 119케이스(step592) / gate-prompts 114케이스(step591)** 전체 PASS. (8/24 시점 99·106 → 590 규칙 3종 115 → 592 '잘 않나' 119 / 591 계약 4케이스 등 114.)
- **관찰 대상(의심 교정 탭, 최신판)**:
  ① ✅**문체역행 필터 실전 첫 작동 확인 — 종결**: 8/21 송림초 "놀 것이다→놀 거예요" 차단(dropped '문체역행' 기록 등장). step560 코드 차단 + 프롬프트 예방의 이중 방어 검증 완료.
  ② 섞인 문체 글 통일 교정 재검출 여부 — step577(문체 통일 예외 명시) 효과 확인.
  ③ 신규 규칙 7종(step575) 실전 검출 확인.
  ④ '밖에' 핑퐁 소멸 여부(step576).
  ⑤ step521 총점 하락 시 종합의견 사유 명시 — 8/21 송림초 -6점 하락 건에서 확인 예정.

**[★진행 중 검증 — 가격 개별 검증 (2026-08-04 발송)]**
- 김현정(문화초)·정천호(이의초)에게 관리자 쪽지("운영자" 명의) 발송 — **연 39,000원 사비 지불 의사 단일 질문**. 강수현은 대면("옆 반 교사에게 권한다면") 별도.
- 답장 오면 지불 이유를 **병목 프레임**(위 8/4 전략 절)으로 해석. 방학이라 응답에 수 주 가능 — **재촉 금지**.

**[★사실 확정 (2026-08-04 쿼리)]**
- **실이메일 17/260(6.5%)** — 이메일 채널 부재 확정. 도메인 목적 = 차단 회피·신뢰(이메일 마케팅 아님). 광고성 정보 수신동의 부재 유의.
- 학생 0명 교사 93명은 **전원 학기 중 가입** / step552 배포 후 방학 가입자는 **전원 학생 등록 완료**(긍정 신호, 개학 후 깔때기로 확정).
- 관리자 코호트의 식어감·이탈 라벨은 방학 중 달력 효과로 무의미 — 판독 주의.

**[★채점 지연 수리 627~629 — 2026-10-15 (§1 627~635 블록과 짝)]**
- **발단**: 10/15 09:10~09:30 송림초 5-6 학생 2명 의견 "AI 검토 거의 3분"(시간 잠금 수업 중).
- **원인 = 구조(버그 아님)**: 첫 글 1편 = 같은 교사 키로 AI **3회**(전용 검사 → 채점 → 예시) × `lib/apiThrottle.js` 12 RPM이 **서버 함수 인스턴스 전역**(학교 간 줄 섞임, 요청 안 재귀 대기 최대 60초) × 피크 가드 N이 `submissions.created_at`(채점 완료 뒤 저장) 기준이라 동시 제출 초반 전원 N=0. 25명 × 3회 = 75회가 분당 12~15 창구 → 산술만으로 5~6분 분산 + 상류 429 백오프(최대 30초×3).
- **처방(627~629)**: ① 학급별 **요청 시각 창** 3건째부터 피크 → 전용 검사 pending(보완 큐)·예시 온디맨드(학생이 "📖 예시 작품 보기" 누를 때) ② 쓰로틀 **키별 버킷 14 RPM·대기 1회 20초**(초과는 상류 백오프) ③ 버튼 3단계 "⏳ 친구들 글이 함께 줄 서 있어요"(인원 수 없음 — 큐가 전역이라 거짓) ④ 잠금 통과 5분 유예 1회(채점 실패 재시도 구제, 서버 불변) ⑤ 교사 잠금 옵션 안내 "종료 시각에 3분 여유".
- **한계**: 무료 키 15 RPM이 바닥. 25명 동시 제출이면 맨 뒤 학생은 **1분 안팎**이 구조적 하한(3회→1회로 줄여도 채점 25회 / 15 RPM). 더 줄이려면 유료 키·학급 분산 제출뿐.
- **측정(다음 피크, 체크리스트 ②)**: Vercel Logs(보존 1시간이라 수업 직후) `[strict-inline] peak=`값·`status=pending` 비율·`/api/ai` 평균/최대 Duration(10/15 09:10~09:30 대비)·"분당 호출 한도 보호" 줄 수. 유혜림(송림초) 체감 회신.
- **부수 사실**: `submissions.created_at` = 채점 완료·저장 시각(버튼 시각은 어디에도 없음 → 분 분포·교사 "오늘 N건"·60초 가드 전부 완료 시각 기준). 시간 잠금 판정은 버튼 시점(클라이언트)이라 지연 자체는 불이익 없음. tutorChat·rubricGen·exampleEssay도 같은 키·같은 창구를 쓴다.

**[★운영자·교사 가시성 630~635 — 2026-10-15 (§1 627~635 블록과 짝)]**
- **쪽지 카드(630)** 교사 홈 ✉️ → 기존 의견 모달·저장소. **학생 신고→관리자(631)** 서버 API로 admin 전원 종(type report 재사용) + 🚩 카드. **글 카드 배지(632)** 🌏 소개 중/🔍 검토 중/🚫 보류(+approved&hidden 비공개) + 주제 요약 "🌏 N편 · 📚 N편". **학생 화면 엿보기(633)** 쓰기 전수 차단(Proxy rpc 허용 목록 방식·callAI 전역 throw·서버 asStudentId) — **교사 엿보기 회귀 확인 필요**(`/teacher/topics?as=` TOP5 rpc, 성장 그래프 grade_avg_stats). **학생 의견 답장(634)** 학생 홈 배너 + 종. **신고 전체 이력(635)** 의심 교정 탭 "🚨 학생 신고" — 담임 확인 완료가 reported_at을 지우던 것을 보존으로 바꿈(**10/15 이전 해결분 복구 불가**).
- **지시 대비 차이(보고 완료)**: 베껴쓰기 감지(예시 비교) 코드 부재 / 가드 상한 3은 인라인 전용(백필 5) / 수정본 버튼 단계 문구 미적용 / 신고 알림 type 신설 불가→report 재사용 / approved+hidden 4번째 상태 / 관리자 학생별 탭 부재→학생 글 탭 행에 👁 / 학생 답장 배너는 학급 토글(feedback_reply_visible_to_students) 미연결.
- **실검증**: 10/15 세션 전부 미실시(체크리스트 ①) — 엿보기 보기 + 본인 반 누르기. 학생 UI는 이제 `/student?as=`로 관리자가 직접 점검 가능.
- **백로그 신규**: 튜터 챗봇 답변 품질(사례 2~3쌍 확보 후 spell 세션) / 학생 답장 배너 학급 토글 연결 / 수정본 버튼 단계 문구 / 예시 온디맨드 클릭 계측 / NotificationBell 링크 `?as=` 보존.

**[★10/15 재판정 — 통과, 판정 종결 (2026-10-15, step626 마감 기록. 10/12 체크리스트 ② 종결)]**
- **수치**: 14일 **529쌍 — 상승 95 / 정체 4 / 하락 1**. 계약 2.0 이후 하락 1건(10/15, 70→65)은 사유 첫 문장·따옴표 인용·"지난 글" 표현 **전부 충족**. **세 유형(고득점 미세 하락+사유 없음 / 미반영 사유 하락 / '유지'라 쓰고 하락) 0건.**
- **단**: 그 1건의 감점 근거가 **신규 문법 오류('놀는게')** = 계약 2.0 **원칙 ③(첫 글에서 지적하지 않은 신규 오류 무감점) 위반**. 현재 무감점 범위 문구가 "기계적 오류(맞춤법·띄어쓰기·문장부호)"라 활용·문법 오류가 빠짐 → **spell 이관(체크리스트 ④): 무감점 범위에 문법·활용 오류 명시.** `lib/prompts.server.js`는 spell 세션 전담, gate-prompts 기대 문구 같은 커밋에서 갱신.
- **첫 글 온도**: 95+ 비율 **3%** · 평균 **77.9**(2주 전 2% · 77.1) — **600 이중 호출 영향 없음.**
- 10/8 블록 관찰 ①(점수역전 6유형 신규 0건)도 이 판정에 포함돼 종결. ②~④·⑤⑥은 계속 관찰. SQL은 계약 1.0 블록의 것 재사용.

**[★spell·메인 갱신 2026-10-08 — 10/8 실사례·게이트 현황·관찰 교체 (이 블록이 8/24 spell 블록·아래 체크리스트 ②③보다 최신)]**
- **10/8 실사례 분석(송림초 5-6 23번, 9회 제출 82→99)**: 1~8차는 내용 소폭 수정, **8→9차만 표기 변경**(띄어쓰기·마침표 추가 + 조사 교정 2곳, 편집거리 2)이었으나 내용 항목 만점 + 네 항목 일괄 ±1(96·92) 패턴 → **spell 608(규칙 (타)(파)) + main 608(changeFacts 포함 판정·notationOnly) + spell 610(판정 순서)으로 차단.** 첫 글 기준점 후함(82)은 서비스 채점 온도 문제로 **별도 사안**(608·610 범위 밖).
- **게이트 현황(10/8)**: gate-korean-rules **174** / gate-prompts **121** / gate-change-facts **20** 전체 PASS. (8/24 119·114 → 605 규칙 4종 170 → 609 치환 174 / 608 (타)(파) 120 → 610 순서 121.) **→ 10/15: korean 200 / prompts 163(622 문체 분포 183·148 → 623 띄어쓰기 200·163) + gate-style-unify 12(624) + gate-peer-share 11(619). → 10/29: gate-korean-rules 200 / gate-prompts 168(spell 637 +5, 640 건수 동일) / gate-change-facts 20 / gate-style-unify 12 전체 PASS. → 10/29 마감: korean 200 / prompts 200(spell 641 +7, 644 +25) / change-facts 20 / style-unify 12 / safety-block 59 / quota-error 19(644 신설) / grading-timing 22(643 신설) / strict-sweep 5(645 신설) 전체 PASS.**
- **관찰(10/15 판정)**: ① 점수역전 6유형 신규 0건 ② 첫 채점 교정 증가(이중 호출)·오교정 신규 유형 ③ 표기만 변경 시 내용 동결 실검증(의심 교정 탭에서 8→9차형 재현 시 내용 항목 직전 점수 유지·맞춤법 항목만 변동) ④ pending 비율(현 3%). **수단 A(미검출 전수조사) 월 1회 재실행 — 다음 11월 초.** **→ 10/15 판정: ① 통과(아래 [★10/15 재판정] 블록). ②~④는 계속 관찰.**
- **10/12~15 spell 추가(622~624)**: 문체 통일이 회차마다 달랐던 원인 = 규칙 11(가) "2/3 이상이면 일관" + 판정 원칙(569)·예외(577)·반말 조항(485)이 기준을 따로 말함 → **서버가 센 [문체 분포]를 사실로 주입하고 프롬프트는 그 값만 따르게**(622). 공백 없는 글의 통째 띄어쓰기 교정에서 단어 삭제·고유명사 분리 → **글자 보존 검사(코드) + [띄어쓰기] 줄(프롬프트)**(623). 622가 만든 옳은 통일 교정이 C-1 스캔에 '문체개입'으로 쌓임 → **styleUnify 표식 + 스캔 제외**(624, SQL 적용 확인 필요). 관찰 추가: ⑤ 10/8 송림초형 통일 교정이 의심 교정 탭에 더 안 쌓이는지(624 SQL 적용 후) ⑥ [띄어쓰기] 줄 이후 공백 없는 글의 고유명사 분리 재발 여부.
- **노출 키 미재발급(사용자 결정)** 기록. 송림초 5-6 23번(반복 제출형, 9회) 학생은 관찰 대상.
- (10/2~10/8 기타) 린트 도입(604) · AI 안전 필터 차단 처리(606·607: 10/2 반곡초·10/6 송림초 PROHIBITED_CONTENT 유실 대응) · 퀴즈 핫픽스(603) · 문체역행 '입이다' 치환(609).

**[★챌린지 접근성 611~614 — 2026-10-08~12 (§1 611~614 블록과 짝)]**
- **전제 정정**: 전국 챌린지는 관리자가 **수시 발행**(매일 아님). 모든 문구에서 "매일" 금지 → 7곳 교체(611), 드라이브 쪽지 초안 폐기(위 전략 블록).
- **목적**: 선생님이 매일 오는 주제 관리 화면에서 전국 주제를 보고·가져가고·자동 받기를 한 번에 켜게. 공유 주제를 고를 때 이미 있는 평가 기준을 재사용해 AI 호출·대기 0.
- **구성**: 611 상단 "🌏 최근 전국 주제" 카드(①가져오기=오늘이면 원클릭 참여/지난이면 일반 주제 폼 채움, ②자동 받기 원클릭=update+즉시 등록) + 홈 배너 원클릭 통일 / 612 "🌏 전국 주제 모음"(지난 주제 폼 채움, AI 0, 같은 제목 confirm) / 613 공유 주제 선택 시 원 주제 기준·설명·최소 글자 수 재사용(AI 0, 운영 설정 복사 금지, topic_copies 추적·원작자 알림·익명 불변) / 614 홈 원클릭 카드 조회를 서버 API로.
- **616~618(10/12~15) 배너 문구**: 제목 "🌏 전국 글쓰기 챌린지"("새 기능" 제거) + 최근 주제 1줄 + **좋은 점 2줄**("✅ 주제를 직접 만들지 않아도 돼요. 새 주제가 나오면 우리 반 주제 목록에 자동으로 들어와요." / "✅ 아이들이 다른 학교 친구들의 잘 쓴 글을 읽어볼 수 있어요 (닉네임으로 소개돼요).") + 회색 마지막 줄 "지난 주제는 주제 관리에서 언제든 가져다 쓸 수 있어요." + 교사 화면 **"발행"→"올라와요"** 전부 교체 + **대시 제거**. 문구만(조건·동작·계측 불변). **실검증은 발행일에(체크리스트 ②).**
- **선행 확인 성과(plan mode ⓐ~ⓖ)**: ⓑ 챌린지 복사본이 학생 "안 쓴 지난 글"에 쌓이던 문제 수정(반 누군가 제출하면 청소를 피해 안 쓴 학생에게 남던 경로) / ⓓ 지난 주제에 source_supply_id를 붙이면 생기는 충돌 6종(유니크·청소 삭제·마감 동결·랭킹 풀 혼입·날짜 기준 혼재·공개 취소 삭제) 확인 → 지난 주제는 일반 주제로 분기 / ⓔ topics RLS(top_select)로 교사가 공급 원본·타 교사 주제를 못 읽음 → 서버 API 2개(`supply-list`·`topic-source`, 안전 컬럼만) / ⓐ ON 직후 오늘 발행분 즉시 복사됨(교사 홈 lazy adopt)을 카드 ②도 동일하게.
- **발견**: step477 교사 홈 원클릭 카드가 공급 원본을 클라이언트에서 직접 읽어 **RLS로 0행이었을 가능성**(실측 불가 — 교사 토큰 없음, 정책 텍스트 근거). 614에서 서버 API로 전환. 그동안 카드가 떴다면 SQL Editor로 넣은 별도 정책이 있다는 뜻이고 전환 결과는 같음.
- **★기준선(10/8)**: 자동 받기 ON **6/278(2.2%)**, 공유 주제 가져가기(topic_copies) **2주 16건** → **10/22 재측정**(같은 SQL). **→ 10/28 재측정 결과는 §13 맨 위 [★10/28 재측정] 블록**(ON 8·가져가기 16·글 모음 켠 반 5·열람 95).
- **실검증 대기(오늘 발행분 있는 날 6975)**: 교사 홈 "🌏 오늘의 전국 글쓰기 챌린지" 카드 노출(614) / 주제 관리 카드 ② → 설명 "✓ 앞으로 새 전국 주제가…" + 학급 설정 토글 체크 + 오늘 발행분 🌏 복사본 즉시 등록 / 이미 등록이면 "✓ 이미 등록된 주제예요" / B 가져오기 → 폼 채움·Vercel `/api/ai` rubricGen 0 / C 공유 주제 선택 → 즉시 채움·안내 1줄·원작자 알림 도착 / 학생 "안 쓴 지난 글"에 🌏 0개.
- 후속 소형: 관리자 온보딩 깔때기 배열에 'challenge_topics_card' 미포함(라벨만 있음) — 집계 필요 시 추가.

**[AI 안전 필터 처리 606·607 — 2026-10-02~06]**
- **사건**: 10/2 반곡초·10/6 송림초 PROHIBITED_CONTENT 차단으로 글 유실. **10/2 건은 멀쩡한 상상 글(구글 오판)**로 확인 — 학생 잘못 아님.
- **발견**: 차단이 SDK에서 throw 없이 빈 텍스트로 돌아와 "JSON 파싱 실패→응답지연"으로 **오분류돼 묻혀 있었음**(관리자 오류 탭에서 안 보임).
- **처방(606)**: detectSafetyBlock(blockReason·finishReason SAFETY/PROHIBITED_CONTENT/BLOCKLIST/SPII) → 422 AI_SAFETY_BLOCKED 즉시(재시도·폴백 0, 키·시간 낭비 0) / 차단 시 **점수 없이 저장**(total_score null + graded_with_model='safety_blocked', `lib/safetyBlock.js`) / 학생 비난 없는 보라 안내("AI가 이 글을 평가하지 못했어요. 글이 잘못된 게 아니라 AI 쪽 사정이에요. 선생님께서 직접 봐주실 거예요.") / 담임 종 알림(create_notification) / 교사 제출물 🟣 "AI 평가 없음(필터)" 칩 / 관리자 분류기 '🟣 AI 안전 필터'(무시 가능, `lib/errorClassify.js` 추출). **607**: 랭킹·통계·성장 그래프·생기부가 점수 null 행 제외(0점 왜곡 방지).
- **SQL**: `step606-safety-blocked-nullable.sql` 적용 완료(§5). 게이트 gate-safety-block 56.
- **실검증**: 다음 실제 차단 건에서(재현 불가). 관리자 오류 탭에 🟣 라벨 등장 + 학생 화면 안내 카드 + 담임 종 알림 확인.

**[퀴즈 회귀·린트 603·604 — 2026-10-02]**
- 10/1 19:44~10/2 09:07 학생 퀴즈 전면 불능(598 회귀: ruleKeys 변수명 교체 누락 — **빌드는 통과, 실행 때 터짐**) → 603 핫픽스 → 604 ESLint 도입(.eslintrc no-undef error, `npm run lint`; next.config `ignoreDuringBuilds=true`라 Vercel 빌드는 안 막음).
- **교훈: UI 커밋은 빌드 통과만으론 부족하다. 화면을 열어봐야 한다.**(verify-ui-change 스킬 + 6975 실검증 원칙 재확인)
- 린트가 찾은 **실제 버그 1건 미수정**: `pages/teacher/students.js` clearSelection 스코프(JSX 안 정의를 핸들러에서 호출 → 일괄 숨김/복원이 **성공인데 "실패" alert**). **백로그 소형(체크리스트 ⑥)**. 나머지 Error 1건(StudentLoginInfoCard rules-of-hooks)·Warning 123건은 기존 코드, 보고만.

**[★우리 반 글 모음 1단계 — 완료 619~621 + 열람 계측 625 (2026-10-12~15, §1 616~625 블록과 짝)]**
- **원 요청**: 교사 "다른 반·학교 글 보고 싶다" + 학생 또래 글로 자기 피드백. **근거**: 동의서 4조 "공유를 선택한 글"(교사의 켜기=선택). 동의 미완료 학생 글은 어떤 경우에도 제외(realname 공백이면 후보에서 탈락).
- **구현(확정 설계 그대로)**: 주제별 **자동 상위 5편**(attempt≤2 최고점·동점 선착) + 교사 추가/제외(`peer_share_overrides`) / **점수 기본 숨김**(학급 설정 "친구 글에 점수도 보여주기") / 학생은 **제출 후 열람**(본인 제출 없으면 locked) / **닉네임만**(응답에 student_id·실명·submission_id 없음) / 켜기는 학생 글 보기 화면 **원클릭 카드**(채점 글 5편 이상일 때, 끄기는 학급 설정) / 학생 "🙋 선생님께 알리기"(type 'message' 재사용, 세션 1회). 선정 규칙은 서버 단독(`lib/peerShareSelect.js`, gate-peer-share 11). 엿보기는 읽기 전용(버튼 비활성·배지).
- **SQL**: `step619-peer-share.sql` **10/12 적용 완료**. `step625-peer-share-views.sql`(열람 계측) **10/15 적용 완료**.
- **계측(625)**: 학생 list 응답에 글이 1편 이상 실릴 때(= 카드가 실제로 뜰 때) `peer_share_views`에 (class_id, topic_id, KST 날짜) 1행. 학생 ID·본문·점수 없음. OFF·locked·0편 응답은 기록 안 함 → **열람 수 = "친구 글 카드를 본 횟수"**(제출 직후·재진입·글 기록 상세 각 1회). 관리자 홈 타일 아래 "📚 우리 반 글 모음: 켜진 학급 N · 최근 7일 열람 M".
- **⚠️발견(백로그 ⑤, 잊지 말 것)**: step147 `sub_select` RLS가 **같은 반 글 전체를 학생에게 열어 둔 상태**(학생 랭킹이 같은 반 제출을 직접 읽는 구조라 남긴 것). 이 API는 본문을 숨기는 장치가 아니라 **열람 조건 강제·선정 단일화**다. 조이려면 **학생 랭킹을 서버 집계로 먼저 이전**한 뒤 sub_select를 본인 행(+교사·admin)으로 좁힌다. 순서를 뒤집으면 랭킹이 깨진다.
- **실검증 결과**: **10/15 미실시**(SQL은 적용됨) — 엿보기(보기: 교사 켜기 카드·상태 줄·추가/빼기 배지) + 본인 반(누르기: 학생 제출 후 카드·알리기 종 알림·관리자 열람 숫자 +1)로 확인. 학생 쪽은 633 학생 엿보기로도 가능. 체크리스트 ①에 포함.
- **후순위**: 2단계 전국 갤러리 · 3단계 학급 주제 교차(다른 반 주제 가져오기와 결합).

**[★다음 세션 시작 체크리스트]** (2026-10-29 마감 교체, step646)
- **① 1주 뒤 "⏱ 채점 시간" 칩 판독**(관리자 의심 교정 탭, 643): p50 vs p95·60초 초과·경로 분포(pending/fallback/retry) → **비동기 채점·503 폴백 정책 결정**. 다음 피크(송림초 등 20명+) 직후가 적기.
- **② auth_bounce 사유별 집계(엣지 튕김 판정)**: `select context->>'reason', context->>'screen', count(*) from error_logs where error_type='auth_bounce' group by 1,2` + 브라우저 분류. no_session이 특정 학교에 몰리면 종료 시 데이터 삭제 정책, query_error+localExpiresIn 양수면 PC 시계 오차.
- **③ 도메인 구입(트리거 발동 — 학교망 vercel.app ERR_TIMED_OUT 실증)**: 가비아 daonclass.kr → Vercel → Resend → Supabase SMTP.
- **④ 챌린지 주 1편 발행 루틴**(10/28 재측정: 공급 빈도가 병목).
- **⑤ AI Studio 실제 RPM 확인 → 쓰로틀 14 유지/하향 결정**(15면 20초 상한 통과 경로가 피크 위험, 30이면 503만 남음).
- **⑥ 김래오(대구범어 4-8)·송림초 5-6 학생 답장**(ⓑ 학년·ⓒ 교정 규칙·속도 수리 안내).
- **⑦ 11월 신고 재판독(태그 기준)**: 10/29 전수 판독 완료(§13 [★신고 144건 판독] 블록, 품질 6:안내 4). 11월 중순에 같은 스크립트 + `parseReportReason` 태그로 재집계 → 빈 사유 0·오교정 왕복·내용 오독 비율로 637~649 효과 판정.
- **⑧ 내일(10/30) 새벽 스윕 확인**: 크론 응답 `strictBackfill.expired` ≈ 70, `pending and created_at < now()-24h` = 0.
- **⑨ 보류 목록**: RLS 조이기(순서 고정: 학생 랭킹 서버 집계 이전 → step147 sub_select 본인 행, plan mode) · students.js clearSelection 소형 수정(린트 Error) · 인디스쿨 2탄(경험담·도구명 1회) · 챌린지 발행일 실검증(616~618 배너·611~614 대기 항목) · 안전 필터 다음 실건 · 사고 후속 ⓐ~ⓒ · 엿보기 잔여 전환 · 알림 센터 · 자투리 풀코스 · 학생 화면 "반영한 조언 ✓" · 기저장 무의미 교정 DB 정리 · 가격 쪽지 답장(김현정·정천호, 재촉 금지) · 이중 호출 후속 · 글 모음 2단계·3단계 · '띄어쓰기변형' 사유 칩 · 학생 답장 배너 학급 토글 · 수정본 버튼 단계 문구 · 예시 온디맨드 클릭 계측 · NotificationBell `?as=` 보존 · 챗봇 사례 수집(tutorChatPrompt, spell 이관) · 638 교사·관리자 홈 재구성 숫자·탭 대조(실검증 미실시) · 630~635 가시성 실검증(10/15 ①, 미실시) · `migrations/step635-report-resolved-at.sql`(선택) · 648 검색 양성 경로(관리자 토큰으로 "송림" → 교사·학생 20건)·649 칩 모달 실검증.
- **⑩ spell 이관 3건(신고 판독 재료, `lib/prompts.server.js`·`lib/koreanRules.js` — spell 창 작업 중, 커밋 번호는 spell 보고로)**: ⓐ 복합어 띄어쓰기 오교정 왕복('가전 제품'↔'가전제품', '매일 매일'↔'매일매일', '어린 아이들'↔'어린아이들', '여름 방학에' 동형 교정) ⓑ '않습니다/않아서' 미인식(koreanRules 영역, 2건) ⓒ AI가 학생 글에 없는 사실을 말하는 오독(21건) — 채점·예시 프롬프트 사실 유지 규칙. 발췌 10건은 10/29 `_last-report.md` ③ⓒ.
- **⑪ 서버 측 초안 저장(기기 간 복구) 검토**: 지금 슬롯은 기기 localStorage뿐이라 기기 교체·브라우저 데이터 삭제 정책·다른 PC 로그인에선 복구 불가. 설계 재료: submissions와 별개 drafts 테이블(user_id·topic_id·phase·text·updated_at, 본인 행 RLS, 1인 1행 upsert, N분 간격·pagehide 때만 전송, 30일 정리 크론) vs 비용(쓰기 폭증·PII 보관). 651 슬롯 실검증 결과와 유실 재발 여부를 본 뒤 결정.
- (10/15 2차 체크리스트 종결: ③ 10/22 재측정 → 10/28 실시(§13 맨 위 블록) / ⑤ 624 SQL cnt=2 확인 / ⑥ 무감점 범위 → spell 640 / ② 다음 피크 실측 → 643 측정 체계로 대체(①) / ①④⑦ 잔여는 ⑨로 이동.)
- **다음 step 번호 = origin/main 전체(spell·메인 합산) 최대 번호 +1**(10/30 15:40: origin 최대 661(main b4d2be7) → 이 문서가 662, 다음은 663. 번호 중복이 나면 해시가 권위, 미push 커밋만 amend. 오늘만 653·656·658 세 번 겹쳤다 — 커밋 직전 `git fetch` 후 origin/main 최대 번호를 다시 세는 것이 유일한 방어).

**[★관찰 기록 — 채점 신뢰도 (체크리스트 ⑦의 참조 원본, 유지)]**
- 의심 교정 탭 점수역전·핑퐁 재발(step476 이후 감소 추세) /
  ✅ **step484('않나')·step485(반말→존댓말) 효과 확인 완료 — 종결**(7/16~21 각 0건) /
  **★채점 신뢰도 처방 상황판(step557 신설, 8/4 559 추가)**: ①550 재작성 관대화 교정(배포) ②555+556
  맞춤법-채점 모순 차단+주입 가드(배포) ③559 상승 인용 강제+복붙 방지(배포, 전부 spell)
  ④1차 채점 기조 관대화 — 관찰만.
  기준선(7/22): 재작성 1,648건 / 95+ 31% / 만점 6.1% / 평균 87.4 / 하락 6.7%.
  **판정은 개학 첫 주 통계로 연기**: 성공=95+ 20%미만·하락 10~15% / 하락 25%초과=과교정
  핑퐁 의심 → 재처방. 정성: 종합의견에 '아직 남아 있어요'류 등장 여부.
  실사례 2건 기록: 시상식 80→95(미수정 칭찬 — 550의 계기) · 바자회 95→100('쥐죽은듯이'
  잔존+만점+"완벽" — 555·556의 계기, 게이트 회귀 케이스 등재됨). ·
  step521 총점 하락 시 종합의견 사유 명시 — 다음 대폭 하락 건에서 overall 확인 ·
  '거→것' 표현 다듬기 1건 재발(7/20 여수송현초, 단발이라 관찰 — 재발 시 규칙 12에 '게→것' 예시 추가) ·
  step542 '안 아서' 차단(7/22) — 앞으로 같은 시도는 의심 교정 탭에 '불가능형태' 차단 기록으로 등장.
  기록이 뜨면 필터가 실제로 막고 있다는 정상 신호 /
  탭 볼륨 추이: 35건(7/14)→19건(7/16)→5건(7/20)→1건(7/21) — 품질 순환 수렴 중 /
  🔥 연속 따라감 교사(임영선·차소연·강병주) 활성 전환 / B문구 답장 축적 → 미정착 처방
  (학생 등록 카드 개선 포함, 전진율 13%) / Vercel 웹훅 누락 2회째 — 재발 시 GitHub 연동 재설치.

**[★전략 — 다음 걸음 깔때기 분석 (2026-07-22)]**
- 깔때기: 후기 100% → 첫 수업 64% → 주제 시작 27% → **학생 등록 11% — 병목 확정.**
- 전략 3수: ①학생 등록 안내 개선(다음 설계 후보 1순위) ②챌린지 드라이브는 개학 주간
  일괄 쪽지+배너로 ③방학 중 도메인+SMTP 선행(⑦ 트랙 근거 보강).
- 관찰 인물: 차소연·임영선(청아초, 연속 따라감 — 회생 중)·윤개원(카드 불통 — 개인 쪽지 후보).

**[백로그 신규 2026-07-22]**
- **신고 사유 입력·장난 신고 제한**: 원터치 신고에 사유 선택 추가 + 반복 장난 신고 제어(7/22 장난 신고 실사례).
- **좋아요 알림**: step541에서 소음 위험으로 보류 — 데이터 쌓인 뒤 재검토.
- **원작자 알림 N명 정확 집계**: 현재 클라 로컬 근사(+1) — notify RPC 안에서 topic_copies 카운트로 이전 검토(소형).
- **학급 랭킹 지난주 대비 델타**: 평균 점수 카드 하위 50% 성장형 문구 재료(step539에서 데이터 부재로 격려형만).
- **챌린지 현황 오인 방지**: "오늘 제출" 카드에 집계 시각·기준 표시 검토(7/22 유령 제출 오인 신고 재발 방지).

**[백로그 신규 2026-07-20]**
- **범용 알림 센터 3차 설계 착수 재료**: 이번에 타입이 4종 늘어 재료 축적(rewrite 2종·
  showcase_report·api_key_invalid, notifications 11종 체제). step530 담임 알림도 type
  'message' 재사용 — "통합 예정" 주석이 코드에 누적 중이라 설계 세션 필요 시점. 실시간
  채팅 포함 여부는 별도 설계(아동 안전·PII) — [대형 항목] 참조.
- **챌린지 통산 기록**: 학생별 챌린지 참여·순위 누적 보기(현재는 그날의 순위 동결만 있음).
- **하위권 순위 표시 재검토**: 전국 랭킹에서 하위권 학생의 순위 노출 방식(동기 저하 방지) 재검토.
- **교사 홈 배너 우선순위**: 배너가 여럿 공존(챌린지 안내·이메일 미등록·사전 신청 등)할 때
  노출 우선순위 규칙 정리.
- ~~**세션 만료 UX**~~ → ✅ **해소(step571~573, 8/20)**: 초안 금고(1.5초 저장+pagehide 플러시)·로그아웃 로컬 스코프(공유 크롬북 타 기기 세션 보호)·401 자동 복구(세션 갱신 후 1회 재시도).
- **교사 1장 매뉴얼**: 활용 안내 1페이지 문서(⑲ 활용방법 상세 안내 트랙 합류).
- **가정통신문 배포 방법**: 동의서·챌린지 안내를 가정통신문으로 배포하는 경로 설계.
**[백로그 신규 2026-07-21]**
- **현황 패널 참여율**: step530 학급별 패널은 참여 수만 표시 → 학급 학생 수 대비 참여율 추가.
- **관리자 계정 2개 정리**: 뽀로로반(7420)·5학년 1반(1936) — 통합/정리 여부 결정.
- **pickAdminKeyedClass 타 학급 폴백 제거**: SYSTEM 키(step529) 정착 확인 후 잔여 폴백 제거.
- **자동 등록 담임 역추적의 교사당 1학급 가정**: 복사본에 class_id가 없어 교사 기준 역추적 —
  다학급 담임이면 현황 패널 부정확. 구조 개선 검토.

**[★수익화 로드맵 (2026-07-03 확정 → 2026-08-04 프레임 전면 개정)]**

**[8/4 전략 세션 결론 — 병목 제거·인프라화 프레임]** ← 이하가 현행 프레임. 아래 구 로드맵과 충돌 시 이쪽이 우선.
- 기각된 가설: '교사 산출물(리포트·성장 기록 내보내기)이 지갑을 연다' — 사용자(현직 교사) 반증: 학부모 상담 축소 추세, 생기부는 범용 AI로 해결, 관리자 보고 수요 없음. **이 방향 재제안 금지.**
- 채택 프레임: 나이스(NEIS) 모델 — 상품은 기능이 아니라 '글쓰기 지도 업무의 병목 제거 그 자체'. 공책 수기 검사→AI 즉시 피드백 대체를 몸으로 겪은 교사가 지불 의사를 보임. 목표 상태 = '이것 없이는 글쓰기 지도가 안 돌아가는' 의존 도달.
- 무료/유료 선 기준: 기능 종류가 아니라 **의존 깊이**. 무료 = 병목 제거를 충분히 체험해 습관이 형성되는 만큼(소급 잠금 없음 원칙과 일관). 플러스 핵심 가치 후보: 'API 키 발급·한도 걱정 없이 그냥 됨'(인프라 값) — 확정 아님, 검증 후.
- 다음 병목 후보(로드맵 재료): 저학년 손글씨 입력(스캔 백로그의 전략적 근거). 추가 병목은 사용자+강수현 교사 실업무 흐름 검증으로 발굴 예정.
- 북극성 지표 재확인: 습관 학급 수(주 3회+) = '없으면 안 되는 반'의 조작적 정의.

- (구 로드맵, 8/4 개정 전) 전제: 고객=교사 B2B. 무료=현행 전부(개인 API 키). 유료 후보(교사 개인 구독): ①키 없이 바로 사용(AI 비용 대납) ②검증 수업·창체 레시피 팩 ③~~성장 리포트 PDF~~(**8/4 기각 프레임 '교사 산출물' — 재제안 금지**).
- 구조: 단일 구독 '다온클래스 플러스'. 크레딧은 고원가 단발 작업(손글씨 스캔) 애드온 전용.
- 가격(가설): 월 4,900원 / 연 39,000원('1년 39,000원, 하루 100원꼴'). **→ ★가격은 방학 중 확정 후 관심자에게 첫 공개(§12-3).**
- 파운딩 멤버: 출시 공지일 이전 가입+학생 1명 이상 등록 교사. 혜택=첫해 연 19,000원+가격 인상 미적용.
- **✅ 사전 신청 카드 착수(step380·382):** 가격 없는 2버튼(관심 있어요/아직 잘 모르겠어요) + 관리자 명단. **현재 interested 2명.** `preorders` 테이블 배포됨. → 신청률 보고 PG 연동 착수 판단.
- 신규 기능 3바구니 규칙: ①매일 습관·학생용·네트워크→무료 ②교사 시간 절약·외부 산출물→플러스 ③고원가 단발→크레딧. 기존 무료 소급 잠금 없음.

**[사용자 아이디어 2026-07-13 — 누락 금지, 세션마다 이 목록 확인]**
- ⑯ 평가문항 제작+평가지 인쇄 [유료 플러스 후보였음 → **8/4 기각 프레임 '교사 산출물' — 유료 축으로 재제안 금지.** 기능 자체는 무료/보류 재분류 대상]
- ⑰ 지갑 여는 메커니즘·시나리오 설계 → 8월 가격 확정(§12-3) 선행 작업으로 편입
- ⑱ 학생 "수정 기회 더" 요청 대응 = 기능 있음(추가 수정 허용) — 교사 대상 발견성 안내 강화
   (박진희 의견 건과 동일 뿌리. 활용 팁 안내 ⑲와 묶어 처리)
- ⑲ 활용방법 상세 안내 — 미정착 처방 트랙 합류
- ⑳ 홍보 2탄 방침: 시간·비용 절약을 수치로 (검사 50분×주2회 환산 등) — 8월 말 원고에 반영
- ㉑ 하루 5분 단어·뇌과학 커리큘럼·중심문장 찾기 — 기존 ⑨⑭⑮ 계열 확장 [대형·설계 세션]
- ㉒+㉓ 주제 자동 공급 시스템: ✅ **대부분 구현 완료(step551 정리)** — 1차 발행 도구(463~465)·
   2차 자동 등록/원클릭(477~518)·보관/원버튼 실뉴스(523~529). 잔여는 시기별 교육과정 연계뿐.

**[대기열 — 소형]**
- **화면 확인 잔여(구 체크리스트 ④, 8/4 이월)**: 동의서 v2-challenge 버전분기 렌더(step509·510) / 교사 홈 배너 [자동 받기 켜러 가기] 버튼(step506) / 챌린지 카드 ✕ / '우리 반에만 공개' 즉시 툴팁(step511) / 수정 기회 요청 왕복 알림 실왕복(학생 요청→교사 허용→학생 종→다시 쓰기 직행, step512~516).
- **dbc5352 학생 글 확인(5회 이월)**: 동북초 5-3 "인공지능이 너무 비정상" 의견의 정체 확인 — 점수 문제면 step456 보상 규칙이 이미 답일 수 있음.
- **Untitled query 465개 정리**: Supabase SQL Editor에 쌓인 무제목 저장 쿼리 정리.
- **step385 주제 수정 3개 눈 확인** — 제출물 잠금 반영된 주제 수정 UI 실물 확인(밀린 눈 확인).
- **주제 수정 의견 준 교사 회신** — 피드백 준 교사에게 반영 회신.
- **RLS 일반교사 격리 확인** — 일반 교사 계정으로 남의 반 데이터가 안 보이는지 앱 차원 점검(관리자 SQL 전체 조회는 정상).
- **막힌 3종 모달 재노출 정책 검토** — step565로 ✕=오늘만 닫기(내일 재노출)·'다시 보지 않기'만 영구 dismissed로 바뀜. 남은 검토는 '다시 보지 않기' 선택 교사의 N일 후 재안내 여부뿐.
- **자투리 풀코스(8/19 신규, 무료 바구니)**: 타자 연습·다 쓴 학생 활동 등 "자투리 시간 전체 해결" 포지셔닝 재료. 설계 세션 필요.
- **온보딩 응답 기반 후속 처방** — no_students 3버튼 분포 보고 우선순위(명렬표 간소화 vs 동의 안내) 결정.

**[방학 본공사 — 대형/별도 설계 세션]**
- ✅ **시사·뉴스 기반 주제 — 완료(step551 정리)**: step525 원버튼 실뉴스(그라운딩 스카우트,
  원문 무접촉)로 구현됨. 무료 바구니.
- **브리핑 결과 화면** [설계 미정] — 브리핑 근거가 된 '지난 글 실제 결과'를 보여주는 화면. 사용자도 그림 미정 — 그림 잡히면 착수.
- **커뮤니티 설계 세션** — 교사 커뮤니티/공유 확장.
- **결제 PG + 메일 인프라** — 국내 PG 구독 연동, 트랜잭션 메일.
- **소셜 로그인** — 구글 → 카카오 → 네이버 순. §12-1(한 이메일=한 계정)과 정합.

**[대형 항목 — 진행 상태]**
- **범용 알림 센터**: ✅1차(step348 교사·관리자, 🔔+60초 폴링) ✅2차(step358 학생 도장·코멘트) ✅타입 확장(~step519, notifications 11종 체제 — rewrite 2종·showcase_report·api_key_invalid 추가). 남은 것: 3차=실시간 채팅(별도 설계, 아동 안전·PII).
- **맞춤법 파이프라인 B(수정본 corrections 승계)**: ✅ **완료** — step442(spell 3인자 재설계 4da6bd4)·step443(메인 배관 f4c7fe3) 양 세션 맞물림으로 완성. 서버(ai.js)가 직전 제출을 직접 조회해 rewriteGradingPrompt 3인자로 이월 + 점수역전 감시(correction_alerts '점수역전') + 이후 일관성 규칙 9항으로 보강(455·456·473·476 — §7 참조). 실검증 통과(뽀로로반, 2026-07-10). A(서버 이전 step350)·C(자동 감시 step359~362) 포함 파이프라인 A·B·C 전부 완료.

**[대기 — 저순위]**
- DB 부분 UNIQUE 인덱스(중복 제출 후속, 보류): 별개 글 8건 충돌로 미적용. 현 방어=코드 가드 — **step578에서 insert 전 존재확인으로 강화(응답 유실 재클릭·조회 error 오판 봉쇄). 8/20 실사고 후에도 "두 기기/두 탭 동시 제출"은 여전히 무방비** → §13 [사고 후속 ⓐ] 참조(8건 정리 후에만).
- 맞춤법 전체일괄(runGrammarBatch, 3곳) vs 단일검사 공존 — grammar-backfill 페이지 정리 여부 추후 판단.
- 회색지대 발견성 배지·admin 집계뷰 / 전체 UI 폴리시 / A3 교사 평판 표시(개인정보 trade-off).
- **AI 비용 2단 모델 구조 검토** — 싼 모델 1차 + 애매한 것만 상위 모델. 사용량 커져 비용 아플 때 착수.

**[완료 2026-08-19~21 — 다시 만들지 말 것]**
- ✅ **step562~579 온보딩 개선·엿보기 완성·제출 중복 사고 종결** — 상세는 §1 ★완료 트랙(562~579) 참조.
  no_students 행동요령 문구 / 모달 오버레이 닫힘 제거·✕=오늘만+다시보지않기 / 유료·챌린지
  카드 게이팅 / 체크리스트 주인공화 / 엿보기 화면 일치+8페이지 ?as=+쓰기 차단 / 휴지통 실명
  잠금 / 제출 중복 insert 차단+비교 뷰 시간순 통일. 병렬: 세션 만료 과제 해소(571~573)·spell
  규칙 3건(575~577).

**[완료 2026-07-21~22 (메인 세션) — 다시 만들지 말 것]**
- ✅ **step536~549 정책·성능·생태계·안전 트랙** — 상세는 §1 ★완료 트랙(536~549) 참조.
  붙여넣기 기본 차단(allow_paste) / 관리자 diff / 랭킹 즉시 응답(waitUntil)+icn1 리전 /
  학생 랭킹 3구간(하위권 비노출) / 공유 생태계(TOP5·좋아요·원작자 알림·하트 UI) / 교사
  랭킹 진입점 / 소개 글 패널 순위 정리 / 닉네임 안전장치. 검증·사건 기록은 §1 트랙 내부.

**[완료 2026-07-20~21 (메인 세션) — 다시 만들지 말 것]**
- ✅ **step523~533 공급 운영·키 경계·직행 UX** — 상세는 §1 ★완료 트랙(523~533) 참조.
  보관·원클릭 보관 / 원버튼 실뉴스(그라운딩)+429 대응 / 타 교사 키 오용 사고 수습(528 응급
  +529 SYSTEM 키 분리 — §1 사고 기록) / 채택·참여 현황 패널+담임 알림 / 예약 발행 date
  버그(시상식 데이터 SQL 정정 포함) / 요청 배너 직행 / ?as= 유실 수정.

**[종결 2026-07-21~22 — 대기열 정리(코드 변경 없음)]**
- ✅ **게이트 스위트 prompts.server.js 케이스 확장 — 종결(이미 완료된 일)**: step431에서
  scripts/gate-prompts.js 신설, 이후 증분 확장으로 현재 67케이스(BUILD·RULES·RULES12·
  REWRITE·DATE·TUTOR·TOPICMIX). CLAUDE.md 커밋 전 절차 편입도 완료.
- ✅ **의심 교정 '글 보기' 버튼 일부 미표시 — 종결**: 차단 기록(submission_id 없음)은 설계상
  버튼 없음이 정상. step459 연결 후 신규 기록은 표시됨. 배포 이전 옛 기록만 해당이라 자연 소멸.
- ✅ **corrections 비문자열 원본 추적 — 종결**: 원류(step426 정규화)·출구(step429 폴백)·
  화면(step427 pickStr) 삼중 차단 완료. 과거 건 부검은 실익 없어 백필 안 함으로 확정(기존 결정).

**[완료 2026-07-16~20 (메인 세션) — 다시 만들지 말 것]**
- ✅ **step468~521 챌린지 시리즈 전체** — 상세는 §1 ★메인 세션 완료 트랙 블록 참조.
  루브릭 합계 100 강제(직전 ⓪ 긴급 건 해소) / 전국 글쓰기 챌린지 2차 배관→3차 랭킹·AI검토·
  신고→분리 재설계→순위 동결→법적 안전선(동의문구 v2-challenge·버전분기·showcase_opt_out) /
  KST 날짜 전역 버그 / 학생 URL 새로고침 내성 / 수정 기회 요청 왕복 알림 / API 키 무효 알림 /
  관리자 개인 쪽지 / 챌린지 신고 알림. 직전 목록의 "① 주제 공급 1차 실물 검수"는 이 시리즈
  진행(2·3차 완성)으로 흡수 종결.

**[완료 2026-07-14~16 (맞춤법 세션) — 다시 만들지 말 것]**
- ✅ **수정본 채점 항목 단위 유지(step473, c7684a6)**: 점수 상승은 실제로 고쳐진 항목에만, 같은
  지적 남으면 직전 점수 유지 — step456 보상 규칙의 후광(안 고쳤는데 점수 상승) 방지.
- ✅ **표현 다듬기 오교정 금지(step474, 261f34b)**: NO_CORRECT_LIST에 '거→것'·'있어서→있기 때문에'류
  뜻 같은 표현 교체 금지(허서준 실사례).
- ✅ **규칙 2건(step475, 91a0cbe)**: ㄹ받침+'때' 띄어쓰기(물때·볼때기·그때·한때·제때·오만원권 오탐
  가드)·숫자+만원(김지우 실사례).
- ✅ **수정본 채점 일관성 2항(step476, e1cb5e3)**: 기존 결함 신규 감점 금지(step442 지시 누락 복원)+
  의견·점수 방향 모순 금지(인천산곡초 72→58 실사례). → 일관성 규칙 9항 체제 완성(§7).
- ✅ **안/않 화이트리스트 → 조사 구조 일반화(step477 b4f272d → step484 be998a8)**: '기억/생각 않나'
  명사 열거(서울선곡초)에서 '명사+이/가+않나→안 나' 구조로 일반화(문화초 — 두더지잡기 종결).
  '-지가/-치가 않나'(믿기지가·만만치가)는 정당 '않'이라 제외(fail-safe).
- ✅ **반말 글 존댓말 오교정 금지(step485, 8221bb0)**: NO_CORRECT_LIST에 단정 문구 — 규칙 11
  다수결을 AI가 뚫던 재발(인천송담초 7/13·14) 대응. 5개 프롬프트 전파.
- 게이트 최종: gate-korean-rules 71케이스 / gate-prompts 67케이스.

**[완료 2026-07-13 — 다시 만들지 말 것]**
- ✅ **admin 개선 4종(step452)**: 의견 탭 학생 실명(미동의=닉네임)+아이디 병기 / 접속 중 N명
  클릭 필터 / 최근 활동순 정렬 / 학급 글 200건 수리(묶음 1000·학급 지정 2000, 문구 분기).
- ✅ **비밀번호 초기화→강제 설정(step453·455)**: profiles.must_setup_at. 관리자 초기화 시
  기록 → 다음 로그인 닫기 불가 모달(새 비번+이메일 등록, 로그아웃만 허용) / 이메일 미등록
  배너(7일 재노출) / lib/authErrorKo.js 인증 에러 한글화 전수 적용 / 등록 직후 배너 즉시 갱신.
- ✅ **수정본 채점 보상 규칙(spell step456)**: "고친 것 점수 상승 먼저, 신규 감점은 그 다음,
  애매하면 직전 총점 유지, 종합의견은 잘 고친 점 먼저" — 실사례(동북초 82→78) 기반.
- ✅ **gemini-2.5-flash 퇴출(step457)**: 구글 2.5 세대 순차 중단(404) 대응 — 전 체인 제거,
  잔여 풀=3.1-flash-lite(주력 500/일)+3-flash-preview(20/일). 실장애 인천송담초 최경은
  grammarStrict 2회 → 해소·쪽지 발송. ⚠️ 3-flash-preview도 중단 시 3.5 Flash 검증 후 투입.
- ✅ **'자리 잡다' 핑퐁 차단(spell step458)**: NO_CORRECT_LIST에 [명사+용언] 띄어쓰기 핑퐁
  금지 + 이월 맥락 재인용 전 표준 표기 재확인 가드. 실사례 수정본 12↔13차 왕복.
- ✅ **점수역전 기록에 submission_id(step459)**: 의심 교정 탭 글 보기 버튼 연결(§13 대기열 해소).
- ✅ **다음 걸음 화면 3연타(step460·462 + 퍼널요약)**: 유형별 집계+따라간 비율 / 자동 진단
  문장(최저·최고·계단 패턴·지켜볼 선생님·안 통한 선생님, 프론트 규칙 계산) / 용어 자기설명화
  (👍 따라감·✕ 닫음·👀 읽고 지나감·📢 안내 접두·🔥 안내 연속 따라감).
  현 데이터 결론: 학생 등록 카드 전진율 13%가 병목, 이후 단계는 잘 굴러감(43→64→100%).
- ✅ **사용자 아이디어 8건 §13 등재(step461)**: ⑯~㉓ — 누락 방지 체계(아이디어 접수 즉시 등재).
- ✅ **주제 자동 공급 1차(step463~465)**: topics.supply_type·publish_week·published_at·
  supply_grade. 관리자 발행 도구 — [원버튼 시사 생성](AI 소재 3개 자선정, 키워드는 보조) /
  학년대 3~4·5~6·공통(프롬프트 난도 분기+배지) / 편집 폼 필수 경유 후 발행 / 예약 발행
  (미래 published_at, 크론 불필요 — 노출은 now() 이하) / lib/supplyTopicPrompt.server.js
  (신규, 아동 적합성 가드·원문 무접촉). 2차(교사 노출)는 미착수.
- ✅ 오전 실사용 대응: 챗봇 재테스트 이상무 종결 / 의심교정 첫 성적표 해석(문체 3건 정당·
  역전 실질건 -4점 분석→456으로 처방) / 모델 배분 결론(현행 유지, 분당 한도가 약한 고리,
  개학 첫 주 관찰) / 문시완 의견=기대 차이로 종결 / 꽈당 오교정=AI가 옳았음 종결 /
  박진희 의견=기능 존재(추가 수정 허용) 안내.

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

## 워킹트리 상태 (2026-10-30 오후 갱신)
- HEAD=b4d2be7(step661, main) + 이 갱신 문서 커밋(step662). 워킹트리 clean. 653~661 트랙은 §1 최상단 블록(git log 8375d65..origin/main 11건 전수 대조, 번호 중복 653·656/657·658). 오후 추가분: 654 채점 시간 칩 가독성·655 교사 글 모음 가시성·657 오류 탭 사람 문장·660 엿보기 상위 글 창 수리+열람 계측(SQL step660 **적용 대기**)·661 styleUnify '아니다' 정합 / spell 653→656 문체 방향 왕복 종결·658 문체역행 확장·659 '아니다' 반말 분류. 아래는 10/30 오전 기록:
- HEAD=8375d65(step652, main) + 이 갱신 문서 커밋(step653). 워킹트리 clean. 637~652 트랙은 §1 최상단 블록(git log e32f673..origin/main 21건 전수 대조, 번호 중복 637·641·644·649). 10/30 추가분: 초안 유실 사고 분석 → 651 저장 슬롯·652 새로고침·전환 방지(§13 [★초안 유실 사고] 블록), spell 1b42105 복합어분리. 아래는 10/29 기록:
- HEAD=7607417(step649, main) + 이 갱신 문서 커밋(step650). 워킹트리 clean. 637~649 트랙은 §1 최상단 블록(git log e32f673..origin/main 17건 전수 대조, 번호 중복 637·641·644). 2차 추가분: 647 신고 행 인라인·648 빠른 엿보기 검색·649 신고 사유 칩 + §13 [★신고 144건 판독] 블록(품질 6:안내 4, spell 이관 3건). 아래는 1차 기록:
- HEAD=6228b28(step645, main) + 이 갱신 문서 커밋(step646). 워킹트리 clean. 637~645 트랙은 §1 최상단 블록(git log e32f673..origin/main 13건 전수 대조, 번호 중복 637·641·644). 10/29 마감의 본질: **진입 속도·튕김 수리(637~641) + 채점 지연 실측 체계(643)와 429 판정·학년·교정 규칙·pending 적체 수리(644·645, spell 641·644)** — §13 맨 위 블록 4개 참조. 아래는 10/29 1차·10/15 2차 기록:
- HEAD=b822e64(step641, main) + 이 갱신 문서 커밋(step642). 워킹트리 clean. 637~641 트랙은 §1 최상단 블록(git log e32f673..origin/main 7건 전수 대조). 아래는 10/15 2차 기록:
- HEAD=c2029bc(step635, main) + 이 갱신 문서 커밋(step636). 워킹트리 clean.
  627~635 트랙(§1 최상단 블록, git log b0775cc..HEAD 9건 전수 대조로 미기재 커밋 없음). 10/15 2차 갱신의 본질:
  **채점 지연 수리(627 피크 창·전용 검사 생략·예시 온디맨드 / 628 쓰로틀 키별 14 RPM·20초 / 629 버튼 3단계·잠금 유예·교사 안내)**
  — 송림초 "3분" 원인은 구조(AI 3회 × 전역 쓰로틀 × 저장 기준 가드), 하한 1분 안팎, 다음 피크 실측 ②
  + **운영자·교사 가시성(630 쪽지 카드 / 631 신고→관리자 종+카드 / 632 🌏📚 배지 / 633 학생 화면 엿보기 — 쓰기 전수
  차단·rpc 허용 목록·교사 엿보기 회귀 확인 필요 / 634 학생 답장 배너 / 635 신고 전체 이력·확인 완료가 reported_at 지우던 것 보존)**
  + SQL: 625 적용 완료(10/15), 635 선택·624 확인(⑤) + 백로그 신규 4건(챗봇 품질·답장 학급 토글·수정본 단계 문구·온디맨드 계측)
  + 체크리스트 ①~⑦ 교체. 게이트 korean 200 / prompts 163 / change-facts 20 / safety-block 56 / style-unify 12 /
  peer-share 11 / **peak-window 12 / api-throttle 14 / lock-grace 10 / showcase-status 13**(신설).
- 번호 경합: **이번 구간 0건**(627~635 9건 전부 단일).
- (10/15 1차 갱신 기록 요지, 이력) HEAD=12e36d5(step625, main) + 갱신 문서 커밋(step626).
  616~625 트랙(§1 블록, git log 177abbd..HEAD 10건 전수 대조로 미기재 커밋 없음). 10/15 1차 갱신의 본질:
  **우리 반 글 모음 1단계 완료(619 배관 / 620 교사 / 621 학생 / 625 열람 계측 — step625 SQL 미적용, 619는 10/12 적용)**
  + **10/15 재판정 통과·종결**(529쌍 상승 95/정체 4/하락 1, 세 유형 0건, 첫 글 95+ 3%·평균 77.9 — 하락 1건은
  신규 문법 오류 감점이라 spell 이관 ④) + 챌린지 배너 문구 616~618(좋은 점 2줄·"올라와요"·대시 제거)
  + spell 622(문체 통일 결정화 — 서버 [문체 분포] 주입)·623(띄어쓰기 글자 보존)·main 624(styleUnify 표식 + 스캔 제외 SQL)
  + 발견: step147 sub_select가 같은 반 글 전체 개방 → RLS 조이기는 랭킹 서버 집계 이전 후(⑤) + 검증 원칙(§0: 6975는
  장난 글 전용, 일상 = 엿보기 보기 + 본인 반 누르기) + 체크리스트 ①~⑦ 교체.
  게이트 korean 200 / prompts 163 / change-facts 20 / safety-block 56 / style-unify 12 / peer-share 11.
- 번호 경합: **이번 구간 0건**(10건 전부 단일). 누적 이력은 아래 10/12·10/8 기록.
- (10/12 갱신 기록 요지, 이력) HEAD=3aa933a(step614, main) + 갱신 문서 커밋(step615).
  611~614 트랙(§1 최상단 블록, git log f774166..HEAD 15건 전수 대조로 미기재 커밋 없음). 10/12 갱신의 본질:
  **전국 챌린지 접근성(611 주제 관리 카드+"매일" 제거+학생 지난 글 정리 / 612 전국 주제 모음 / 613 공유 주제 기준
  재사용 AI 0 / 614 홈 카드 서버 API 전환)** + 전제 정정(수시 발행)·쪽지 초안 폐기 + 기준선(ON 2.2%·가져가기 16건,
  10/22 재측정) + 안전 필터 606·607·퀴즈 회귀 603·린트 604 정리 + 우리 반 글 모음 1단계 설계 확정(미착수) +
  체크리스트 ①~⑦ 교체. 게이트 korean 174 / prompts 121 / change-facts 20 / safety-block 56.
- 번호 경합: **이번 구간 1건: 611(spell c88edb0 문서 / main 8fd8149)**. 10/8 구간 608 포함 누적 2건.
- (10/8 갱신 기록 요지, 이력) HEAD=7096fdf(step610, spell) + 갱신 문서 커밋(step611 c88edb0).
  603~610 트랙(§1 최상단 블록, git log 34a03b8..HEAD 10건 전수 대조로 미기재 커밋 없음). 10/8 갱신의 본질:
  **10/8 실사례(표기만 고친 수정본 82→99)에 대한 3중 대응(spell 608 규칙 (타)(파) + main 608
  lib/changeFacts.js 포함 판정·notationOnly + spell 610 판정 순서 notationOnly 우선)** + 문체역행 '입이다'
  치환(609) + spell 규칙 4종(605) + AI 안전 필터 차단 처리(606·607) + 린트 도입(604) + 퀴즈 핫픽스(603).
  게이트 korean 174 / prompts 121 / change-facts 20. 10/15 관찰 ①~④는 §13 10/8 블록.
- 번호 경합: **이번 구간 1건: 608(spell f957602 / main fb7dc11)**. 이 폴더(spell)의 eslint는 `npm install --no-save`
  임시 설치 상태(package.json·lock 불변) — 유지하려면 `npm install` 한 번.
- (10/2 마감 기록 요지, 이력) HEAD=34a03b8(step601, main) + 마감 문서 커밋(step602).
  595~601 트랙 마감(§1 최상단 블록, git log 9256b56..HEAD 9건 전수 대조로 미기재 커밋 없음). 10/2 마감의 본질:
  **수정본 채점 계약 2.0 완성(595 배관 + spell 596 프롬프트 + 597 스키마 설명 — 직전 본문·변경 사실을 재료로
  주고 하락 사유는 인용 필수)** + 10/1 판정 통과(646쌍 상승 94/하락 4, 10/15 재판정 기준 = 세 유형 0건) +
  **첫 채점 이중 호출(600·601 + step600 SQL 적용, Hobby라 2분 크론 대신 폴링+일일 스윕)** + 퀴즈 안전화
  (main 598)·무의미 교정 정규화(spell 598) + 카테고리 10월 재검토 유지·종료 + 체크리스트 ①~⑧ 교체.
- 번호 경합: **이번 세션 2건: 597(spell a49b3f8 / main e48e123) · 598(main c96fd73 / spell df52b48)**. 누적 이력은 아래 9/15 기록 참조.
- (9/15 마감 기록 요지, 이력) HEAD=fdc23b2(step593)+step594. 582~593 트랙 마감. 본질:
  **수정본 채점 정책 전환("엄격화"→"조언 이행 계약", spell 591 + main 593 배관)** + 점수역전 감시
  한글화·자동 해결(590)·합계 확인(591) + 카테고리 4묶음 통일(589) + 전략 결정 병합(수익화 메시지 0·
  사과나무 원칙·의견 처리 규칙·도메인 트리거형) + 체크리스트 ①~⑧ 교체(6975 실검증·9/29 지표 판정 최우선).
- 번호 경합 이력(누적): 534·542·547·556·557·559(7월) + 562·564·569(8월) + **이번 세션 2건: 590·591
  (main/spell 경합)**. 해시가 권위, 커밋 직전 git fetch 필수. push 경합 시 pull --rebase 후 재push가 일상 절차
  (이번 세션에도 590·591·593 커밋 시 매번 발생).
- (8/21 마감 기록 요지, 이력) 개학 대비 온보딩 개선·엿보기 완성·8/20 제출 중복 사고 종결 + 유료화 공과금형
  검토 개시 + 체크리스트 교체. 미기재 커밋 보충 `0619e4f` step567.
- (8/4 마감 기록 요지, 이력) 유료화 프레임 전면 개정(병목 제거·인프라화)·가격 개별 검증 발송·
  체크리스트 교체. spell 559=`9c5dcd0`·560=`b7712a5`, 557=`849c824`·558=`87b6d2c`.
- spell은 literacy-class-spell 별도 폴더(정상화 완료). 두 세션 force-push 금지·커밋 전
  pull --rebase 유지. ⚠️ step 번호 중복 계속 발생 중(478·484 등 — 해시가 권위, 커밋 직전
  git fetch로 번호 확인). Vercel 웹훅 1회 누락 이력(93fae57 빈 커밋으로 재트리거) — 배포 안
  뜨면 빈 커밋 트리거가 검증된 해법.
- ⚠️ 인코딩 사고 이력(2026-07-16): PS 5.1 Get-Content/Set-Content 일괄 치환이 한글 파일을
  깨뜨림(즉시 checkout 복원). **한글 파일 치환은 Edit 도구로만.**
