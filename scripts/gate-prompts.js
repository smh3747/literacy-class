// lib/prompts.server.js 회귀 게이트 스위트 (읽기 전용 — prompts.server는 import만, 수정 안 함)
//
// ▶ lib/prompts.server.js 수정 시 커밋 전 필수 실행:  node scripts/gate-prompts.js
//   CORRECTIONS_RULES 핵심 지시(규칙 6·10·11 등)가 실수로 지워지지 않았는지 스모크 확인한다.
//   하나라도 FAIL이면 exit 1.
//
// 기대 문구는 "현재 프롬프트의 실제 문구"를 실측해 고정한 것이다(새 기대가 아니라 회귀 방지).
// 규칙 문구를 의도적으로 바꾸면, 이 파일의 기대 문구도 같은 커밋에서 갱신할 것.
//
// ※ 실행 시 node가 "MODULE_TYPELESS_PACKAGE_JSON" 경고를 낼 수 있다(무해, 게이트 결과 무관).

const path = require('path')
const { pathToFileURL } = require('url')

;(async () => {
  const pPath = path.join(__dirname, '..', 'lib', 'prompts.server.js')
  const mod = await import(pathToFileURL(pPath).href)
  const { gradingPrompt, grammarStrictPrompt, grammarOnlyPrompt, rewriteGradingPrompt, regradePrompt, tutorChatPrompt, topicBatchPrompt } = mod

  const results = []
  const rec = (group, name, pass, detail) => results.push({ group, name, pass, detail })

  // ── BUILD: 셋 다 에러 없이 문자열 생성 ──
  const topic = { title: '나의 꿈', description: '장래희망을 써 보세요' }
  const rubrics = [{ name: '내용', score: 50, hint: '주제와 관련 있게' }, { name: '표현', score: 50 }]
  const essay = '나는 소방관이 돼서 사람들을 구할 것이다.'

  const builders = {
    gradingPrompt: () => gradingPrompt({ topic, essay, rubrics }),
    grammarStrictPrompt: () => grammarStrictPrompt({ essay }),
    grammarOnlyPrompt: () => grammarOnlyPrompt({ essay }),
  }
  const prompts = {} // 생성 성공한 프롬프트만 담아 아래 RULES 검사 대상으로
  for (const [name, build] of Object.entries(builders)) {
    try {
      const s = build()
      const pass = typeof s === 'string' && s.length > 0
      if (pass) prompts[name] = s
      rec('BUILD', name, pass, pass ? `${s.length}자 생성` : `문자열 아님(${typeof s})`)
    } catch (e) {
      rec('BUILD', name, false, `예외: ${e.message}`)
    }
  }

  // ── RULES: CORRECTIONS_RULES 공유 + 핵심 지시 문구 잔존 (셋 다 검사) ──
  // 문구는 lib/prompts.server.js의 현재 CORRECTIONS_RULES에서 실측(회귀 방지용 고정).
  const KEY_PHRASES = [
    { name: '규칙 6(안/않 오교정 금지)',    text: "맞는 '않'을 '안'으로 고치지 마세요" },
    { name: "규칙 10(-는데 어미)",          text: "어미 '-는데/-ㄴ데'" },
    { name: '규칙 11(문체 일관 판정)',      text: '문장 대부분' },
    { name: '규칙 11(문체 교정 금지 지시)', text: '일관된 글에서는 문체 교정을 하나도 만들지 마세요' },
    // step443: 오교정 금지 규칙 12 — '조사' 단독은 규칙 7에도 있어 무의미, 규칙 12 고유 문구로 검사
    { name: '규칙 12(조사 떼기 금지)',      text: '조사는 항상 붙여 씁니다' },
    { name: '규칙 12(가운뎃점 변경 금지)',  text: '가운뎃점' },
    { name: '규칙 12(복합명사 핑퐁 금지)',  text: '둘 다 허용' },
    { name: '규칙 12(자리 잡다 핑퐁 금지)', text: '다시 반대로 교정하는 것은 절대 금지' }, // step456
    { name: '규칙 12(표현 다듬기 금지)',    text: "'거→것'" }, // step474
    { name: '규칙 12(반말 글 존댓말 교정 금지)', text: '반말체는 글쓰기에서 완전히 올바른 문체' }, // step485
  ]
  for (const [pname, s] of Object.entries(prompts)) {
    for (const kp of KEY_PHRASES) {
      const pass = s.includes(kp.text)
      rec('RULES', `${pname} · ${kp.name}`, pass, pass ? '포함' : `누락: "${kp.text}"`)
    }
    // 규칙 번호 1~12 전부 존재 (CORRECTIONS_RULES 항목은 3칸 들여쓰기 "   N. " 형식)
    const missing = []
    for (let n = 1; n <= 12; n++) {
      if (!s.includes(`\n   ${n}. `)) missing.push(n)
    }
    rec('RULES', `${pname} · 규칙 1~12 전부 존재`, missing.length === 0,
      missing.length === 0 ? '12개 모두 존재' : `누락 번호=${missing.join(',')}`)
  }

  // ── RULES12: 오교정 금지 목록(NO_CORRECT_LIST)이 재평가·수정본 채점에도 포함 (step448) ──
  // CORRECTIONS_RULES 3종은 위 RULES 그룹이 검사하므로, 인라인 규칙을 쓰는 두 프롬프트만 여기서.
  {
    const R12_PHRASES = [
      { name: '규칙 12(조사 떼기 금지)',     text: '조사는 항상 붙여 씁니다' },
      { name: '규칙 12(가운뎃점 변경 금지)', text: '가운뎃점' },
      { name: '규칙 12(복합명사 핑퐁 금지)', text: '둘 다 허용' },
      { name: '규칙 12(자리 잡다 핑퐁 금지)', text: '다시 반대로 교정하는 것은 절대 금지' }, // step456
      { name: '규칙 12(표현 다듬기 금지)',    text: "'거→것'" }, // step474
      { name: '규칙 12(반말 글 존댓말 교정 금지)', text: '반말체는 글쓰기에서 완전히 올바른 문체' }, // step485
    ]
    const inlinePrompts = {}
    try { inlinePrompts.regradePrompt = regradePrompt({ topic, essay, rubrics }) } catch (e) { rec('RULES12', 'regradePrompt 생성', false, `예외: ${e.message}`) }
    try { inlinePrompts.rewriteGradingPrompt = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics }) } catch (e) { rec('RULES12', 'rewriteGradingPrompt 생성', false, `예외: ${e.message}`) }
    for (const [pname, s] of Object.entries(inlinePrompts)) {
      for (const kp of R12_PHRASES) {
        const pass = s.includes(kp.text)
        rec('RULES12', `${pname} · ${kp.name}`, pass, pass ? '포함' : `누락: "${kp.text}"`)
      }
    }
  }

  // ── REWRITE: rewriteGradingPrompt의 이전 채점 맥락 3인자 (step442, step436 prevGradingText 대체) ──
  // 전부 미전달/null이면 기존 출력과 완전 동일(하위호환), 하나라도 있으면 [이전 채점 정보] 블록+일관성 규칙.
  try {
    const base = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics })
    const withNulls = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, prevScore: null, prevCorrections: null, prevFeedback: null })
    const withPrev = rewriteGradingPrompt({
      topic, rewriteEssay: essay, rubrics,
      prevScore: 75,
      prevCorrections: [{ original: '어느날', correction: '어느 날' }],
      prevFeedback: '문단 구분 필요'
    })

    // (a) 하위호환: 미전달 === 전부 null, 이전 맥락 문구 없음
    const aPass = base === withNulls
      && !base.includes('[이전 채점 정보]')
      && !base.includes('낮은 점수를 주지 마세요')
      && !base.includes('모순되면 안 됩니다') // step476: 미주입 시 신규 항도 없음 명시 검증
      && !base.includes('점수가 내려갔어요') // step521: 하락 사유 명시 강제 항도 미주입 시 없음
      && !base.includes('하지 않은 개선을 칭찬') // step550: 관대화 대칭 교정 항도 미주입 시 없음
      && !base.includes('함부로 깎지도') // step550: 대칭 원칙 선언도 미주입 시 없음
      && !base.includes('맞춤법·띄어쓰기 수정만으로는') // step559: 상승 근거 강제(맞춤법 외 항목) 항도 미주입 시 없음
      && !base.includes('베낄 원문이 아닙니다') // step559: 의견 복붙 방지 항도 미주입 시 없음
    rec('REWRITE', '이전 맥락 미전달 = 전부 null 동일(하위호환)', aPass,
      aPass ? '출력 동일, 이전 맥락 문구 없음' : (base === withNulls ? '이전 맥락 문구가 기본 출력에 섞임' : '미전달과 null 출력 불일치'))

    // (b) 전체 주입: 블록 표제·점수·지적 목록·총평·일관성 규칙 포함
    // step455: 보상 규칙 3문구 추가(고친 항목 점수 상승 선반영·총점 하락 조건·잘 고친 점 먼저)
    const bPhrases = ['[이전 채점 정보]', '75점', '어느날 → 어느 날', '문단 구분 필요', '다시 포함', '낮은 점수를 주지 마세요',
      '점수 상승으로 반드시 먼저 반영', '뚜렷이 초과해야', '잘 고쳤는지',
      '표준 표기가 확실한지 다시 확인', // step456: 이월 지적 재인용 가드
      '실제로 고쳐진 항목에만', // step473: 항목 단위 유지(후광 방지)
      '새로운 감점 사유로 삼지 마세요', // step476: 기존 결함 신규 감점 금지(step442 누락 복원)
      '모순되면 안 됩니다', // step476: 의견·점수 방향 모순 금지
      '점수가 내려갔어요', // step521: 총점 하락 시 종합의견 첫·둘째 문장에 사유 명시 강제
      '칭찬만 쓰는 것은 금지', // step521: 사유 언급 없는 칭찬-only overall 금지
      '아직 남아 있어요', // step550: 미반영 지적은 종합의견에 솔직 명시
      '하지 않은 개선을 칭찬', // step550: 하지 않은 개선 칭찬 금지(관대화 실사례 80→95)
      '인용할 수 있는 변화', // step550: 항목 점수 상승은 인용 가능한 변화 근거 필수
      '전부 해소됐을 때만', // step550: 지적 잔존 항목 만점 금지
      '함부로 깎지도, 함부로 올리지도', // step550: 하락·상승 대칭 원칙 선언
      '따옴표', // step559: 항목 상승 시 달라진 대목 따옴표 인용 강제(검증형)
      '맞춤법·띄어쓰기 수정만으로는', // step559: 맞춤법 수정만으로 맞춤법 외 항목 상승 금지
      '베낄 원문이 아닙니다'] // step559: 종합의견 이전 총평 복붙 방지
    const bMissing = bPhrases.filter(p => !withPrev.includes(p))
    rec('REWRITE', '전체 주입 시 블록+일관성 규칙 포함', bMissing.length === 0,
      bMissing.length === 0 ? `${bPhrases.length}문구 모두 포함` : `누락: ${bMissing.join(' / ')}`)

    // step559: 상승 근거 강제(검증형)+의견 복붙 방지 — 신규 규칙 3건 개별 존재 확인
    const b1 = withPrev.includes('따옴표') && withPrev.includes('인용할 수 있는 변화')
    rec('REWRITE', 'step559 항목 상승 시 달라진 대목 따옴표 인용 강제', b1,
      b1 ? '따옴표 인용 강제+인용 변화 근거 포함' : `따옴표=${withPrev.includes('따옴표')}, 인용변화=${withPrev.includes('인용할 수 있는 변화')}`)
    const b2 = withPrev.includes('맞춤법·띄어쓰기 수정만으로는')
    rec('REWRITE', 'step559 맞춤법 수정만으로 맞춤법 외 항목 상승 금지', b2,
      b2 ? '포함' : '누락: "맞춤법·띄어쓰기 수정만으로는"')
    const b3 = withPrev.includes('베낄 원문이 아닙니다')
    rec('REWRITE', 'step559 종합의견 이전 총평 복붙 방지', b3,
      b3 ? '포함' : '누락: "베낄 원문이 아닙니다"')

    // (c) 상한: corrections 21개 → 20개+'외 1건', 총평 600자 → 500자 절단
    const manyCorr = Array.from({ length: 21 }, (_, i) => ({ original: `오타${i + 1}`, correction: `교정${i + 1}` }))
    const longFb = 'ㄱ'.repeat(600)
    const capped = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, prevCorrections: manyCorr, prevFeedback: longFb })
    const cPass = capped.includes('외 1건') && !capped.includes('오타21')
      && capped.includes('ㄱ'.repeat(500)) && !capped.includes('ㄱ'.repeat(501))
    rec('REWRITE', '상한 적용(지적 20개+외 N건, 총평 500자)', cPass,
      cPass ? "'외 1건' 표기, 21번째 미포함, 총평 500자 절단" : `외1건=${capped.includes('외 1건')}, 오타21제외=${!capped.includes('오타21')}, 500자=${capped.includes('ㄱ'.repeat(500))}, 501자없음=${!capped.includes('ㄱ'.repeat(501))}`)

    // (d) 부분 주입: prevScore만 → 블록은 있되 지적·총평 줄 없음
    // ('이전에 지적한'만으로 검사하면 일관성 규칙 본문("이전에 지적한 오류가…")과 겹쳐 오탐 → 블록 줄 표제로 정밀 검사)
    const scoreOnly = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, prevScore: 88 })
    const dPass = scoreOnly.includes('[이전 채점 정보]') && scoreOnly.includes('88점')
      && !scoreOnly.includes('이전에 지적한 맞춤법·표현') && !scoreOnly.includes('이전 총평 요약')
    rec('REWRITE', '부분 주입(prevScore만) 시 점수 줄만', dPass,
      dPass ? '점수 줄만 포함' : `블록=${scoreOnly.includes('[이전 채점 정보]')}, 88점=${scoreOnly.includes('88점')}, 지적줄없음=${!scoreOnly.includes('이전에 지적한 맞춤법·표현')}, 총평줄없음=${!scoreOnly.includes('이전 총평 요약')}`)
  } catch (e) {
    rec('REWRITE', 'rewriteGradingPrompt 실행', false, `예외: ${e.message}`)
  }

  // ── SELFCHECK: 검사·채점 자기모순 차단 (step555, 요약형 가드 step556) ──
  // ① corrections↔점수 일관성 규칙(만점 금지·'완벽' 표현 금지)이 채점 2종에 잔존.
  // ② ruleErrors(자동 맞춤법 검사 주입) 미전달 시 기존 출력과 완전 동일(하위호환).
  // ③ 전달 시 [자동 맞춤법 검사 요약] 블록: 총 N건 + 대표 예시 상한 3건('외 N건') + 만점 금지
  //    + 절대 표현 금지 + 다른 항목 번짐 금지(step556 가드).
  // ④ 실사례 회귀(7/22 바자회 95→100): '쥐죽은듯이' 잔존인데 맞춤법 만점+"완벽" 칭찬 — 재발 방지.
  // ⑤ step521(하락 사유)·step550(관대화 대칭)·검사 블록이 동시 주입에서 충돌 없이 공존.
  try {
    const SC_PHRASES = [
      { name: 'corrections↔점수 일관성 규칙', text: 'corrections와 점수의 일관성' },
      { name: '만점만 금지(감점 강제 아님)',   text: '만점만 금지이며' },
      { name: "'오류 없다' 표현 금지",        text: '오류가 없다는 표현' },
    ]
    const scPrompts = {
      gradingPrompt: gradingPrompt({ topic, essay, rubrics }),
      rewriteGradingPrompt: rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics }),
    }
    for (const [pname, s] of Object.entries(scPrompts)) {
      for (const kp of SC_PHRASES) {
        const pass = s.includes(kp.text)
        rec('SELFCHECK', `${pname} · ${kp.name}`, pass, pass ? '포함' : `누락: "${kp.text}"`)
      }
    }

    // ② 하위호환: ruleErrors 미전달 = null = 빈 배열, 블록 문구 없음
    const gBase = scPrompts.gradingPrompt
    const gNull = gradingPrompt({ topic, essay, rubrics, ruleErrors: null })
    const gEmpty = gradingPrompt({ topic, essay, rubrics, ruleErrors: [] })
    const rBase = scPrompts.rewriteGradingPrompt
    const rNull = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, ruleErrors: null })
    const cPass = gBase === gNull && gBase === gEmpty && rBase === rNull
      && !gBase.includes('자동 맞춤법 검사') && !rBase.includes('자동 맞춤법 검사')
    rec('SELFCHECK', 'ruleErrors 미전달 = null = [] 동일(하위호환)', cPass,
      cPass ? '출력 동일, 검사 블록 없음' : `grading동일=${gBase === gNull && gBase === gEmpty}, rewrite동일=${rBase === rNull}, 블록없음=${!gBase.includes('자동 맞춤법 검사') && !rBase.includes('자동 맞춤법 검사')}`)

    // ③ 주입: 2건 → 총 2건+대표 예시+만점 금지+절대 표현 금지+번짐 금지, 5건 → 3건 표시+'외 2건'
    const two = [{ original: '어느날', correction: '어느 날' }, { original: '할수있다', correction: '할 수 있다' }]
    const gTwo = gradingPrompt({ topic, essay, rubrics, ruleErrors: two })
    const rTwo = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, ruleErrors: two })
    const dPhrases = ['자동 맞춤법 검사', '총 2건', '대표 예시', '어느날 → 어느 날',
      '만점을 주지 마세요', '만점만 금지이며', // step556: 만점 금지≠감점 강제 블록 내 명시
      "'맞춤법이 완벽하다', '오류가 하나도 없다'", // step556: 절대 표현 금지 확장
      '다른 항목의 점수를 이 요약 때문에 깎지 마세요'] // step556: 내용·구성·표현 번짐 금지
    const dMissing = dPhrases.filter(p => !gTwo.includes(p) || !rTwo.includes(p))
    rec('SELFCHECK', 'ruleErrors 주입 시 요약 블록+만점·절대표현·번짐 금지(채점 2종)', dMissing.length === 0,
      dMissing.length === 0 ? `${dPhrases.length}문구 모두 포함` : `누락: ${dMissing.join(' / ')}`)

    const five = Array.from({ length: 5 }, (_, i) => ({ original: `오류${i + 1}`, correction: `교정${i + 1}` }))
    const gCap = gradingPrompt({ topic, essay, rubrics, ruleErrors: five })
    const ePass = gCap.includes('총 5건') && gCap.includes('오류3') && !gCap.includes('오류4') && gCap.includes('외 2건')
    rec('SELFCHECK', 'ruleErrors 요약 상한(대표 예시 3건+외 N건)', ePass,
      ePass ? "'총 5건'·3건 표시·'외 2건'" : `총5건=${gCap.includes('총 5건')}, 3표시=${gCap.includes('오류3')}, 4제외=${!gCap.includes('오류4')}, 외2건=${gCap.includes('외 2건')}`)

    // ④ 실사례 회귀(step556): '쥐죽은듯이' 잔존 + 맞춤법 만점 + "완벽" 칭찬(7/22 바자회 95→100).
    //    이 오류가 주입되면 만점 금지·절대 표현 금지 지시가 반드시 프롬프트에 실려야 한다.
    const jwi = [{ original: '쥐죽은듯이', correction: '쥐 죽은 듯이' }]
    const rJwi = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, ruleErrors: jwi })
    const fPass = rJwi.includes('쥐죽은듯이 → 쥐 죽은 듯이') && rJwi.includes('만점을 주지 마세요')
      && rJwi.includes("'맞춤법이 완벽하다', '오류가 하나도 없다'")
    rec('SELFCHECK', "실사례 회귀('쥐죽은듯이' 주입 → 만점·절대표현 금지)", fPass,
      fPass ? '예시·만점 금지·절대 표현 금지 모두 포함' : `예시=${rJwi.includes('쥐죽은듯이 → 쥐 죽은 듯이')}, 만점금지=${rJwi.includes('만점을 주지 마세요')}, 절대표현=${rJwi.includes("'맞춤법이 완벽하다', '오류가 하나도 없다'")}`)

    // ⑤ 공존(step556): prev 3인자 + ruleErrors 동시 주입 시 step521·step550·검사 블록이 전부 존재.
    const rBoth = rewriteGradingPrompt({
      topic, rewriteEssay: essay, rubrics,
      prevScore: 75, prevCorrections: [{ original: '어느날', correction: '어느 날' }], prevFeedback: '문단 구분 필요',
      ruleErrors: two,
    })
    const gPhrases = ['점수가 내려갔어요', '칭찬만 쓰는 것은 금지', // step521
      '함부로 깎지도, 함부로 올리지도', '하지 않은 개선을 칭찬', // step550
      '자동 맞춤법 검사', '만점만 금지이며'] // step555·556
    const gMissing = gPhrases.filter(p => !rBoth.includes(p))
    rec('SELFCHECK', '동시 주입 시 step521·550·검사 블록 공존', gMissing.length === 0,
      gMissing.length === 0 ? `${gPhrases.length}문구 모두 공존` : `누락: ${gMissing.join(' / ')}`)
  } catch (e) {
    rec('SELFCHECK', 'SELFCHECK 실행', false, `예외: ${e.message}`)
  }

  // ── DATE: 채점 3종 오늘 날짜(KST) 주입 (step441) ──
  // 형식 매칭 + 가드 문구 잔존만 확인. 연도 일치까지는 안 봄(자정 경계·타임존으로 게이트가 취약해지는 것 방지).
  {
    const DATE_RE = /오늘은 \d{4}년 \d{1,2}월 \d{1,2}일입니다/
    const GUARD = '"미래의 일"이라고 잘못 지적하지 마세요'
    const graders = {
      gradingPrompt: () => gradingPrompt({ topic, essay, rubrics }),
      regradePrompt: () => regradePrompt({ topic, essay, rubrics }),
      rewriteGradingPrompt: () => rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics }),
    }
    for (const [name, build] of Object.entries(graders)) {
      try {
        const s = build()
        const pass = DATE_RE.test(s) && s.includes(GUARD)
        rec('DATE', `${name} · 오늘 날짜 줄+미래 오지적 가드`, pass,
          pass ? (s.match(DATE_RE) || [''])[0] : `날짜형식=${DATE_RE.test(s)}, 가드문구=${s.includes(GUARD)}`)
      } catch (e) {
        rec('DATE', `${name} · 오늘 날짜 줄+미래 오지적 가드`, false, `예외: ${e.message}`)
      }
    }
  }

  // ── TUTOR: 튜터 챗봇 실질 도움 지시 잔존 (step449) ──
  // 신규 3문구(다음 한 걸음·시작 막막 대응·이어쓰기) + 기존 유지 2문구(대필 금지·길이).
  try {
    const s = tutorChatPrompt({ gradeLabel: '초등학교 5학년', topicTitle: '신비한 상자', topicDescription: '상자를 열면 무슨 일이?', currentText: '', history: '' })
    const T_PHRASES = [
      { name: '다음 한 걸음 의무화',      text: '다음 한 걸음' },
      { name: '시작 막막 대응(첫 문장)',  text: '첫 문장' },
      { name: '이어쓰기(일반론 금지)',    text: '마지막 내용에 이어서' },
      { name: '대필 금지(기존 유지)',     text: '대신 써주지 마세요' },
      { name: '2~4문장 제한(기존 유지)',  text: '2~4문장' },
      { name: '호칭 금지',               text: '호칭으로 부르지 마세요' }, // step450
      { name: '마크다운·특수기호 금지',   text: '마크다운 서식을 쓰지 마세요' }, // step451
      { name: "'친구' 지칭 금지(나 시점)", text: '부르지도, 지칭하지도 마세요' }, // step451
    ]
    for (const kp of T_PHRASES) {
      const pass = s.includes(kp.text)
      rec('TUTOR', kp.name, pass, pass ? '포함' : `누락: "${kp.text}"`)
    }
  } catch (e) {
    rec('TUTOR', 'tutorChatPrompt 생성', false, `예외: ${e.message}`)
  }

  // ── TOPICMIX: 개별 주제 추천 시사·주장 글감 구비 + 아동 적합성 (step478) ──
  // 구비 규칙은 count>=2 & (batch면 theme 없음)일 때만, 아동 적합성은 항상.
  try {
    const base = { gradeText: '초등 5학년', count: 3, recentTitles: '', categoryText: '일상', levelText: '보통' }
    const sug3 = topicBatchPrompt({ ...base, style: 'suggest' })
    const bat3 = topicBatchPrompt({ ...base, style: 'batch' })
    const batTheme = topicBatchPrompt({ ...base, style: 'batch', theme: '우주 탐험' })
    const sug1 = topicBatchPrompt({ ...base, count: 1, style: 'suggest' })
    const MIX = ['시사·사회적 소재', '주장하는 글', '아는 척하지 말고']

    const p1 = MIX.every(t => sug3.includes(t))
    rec('TOPICMIX', 'suggest(3개) 구비+적합성 포함', p1, p1 ? '3문구 포함' : `누락: ${MIX.filter(t => !sug3.includes(t)).join(' / ')}`)
    const p2 = MIX.every(t => bat3.includes(t))
    rec('TOPICMIX', 'batch(3개) 구비+적합성 포함', p2, p2 ? '3문구 포함' : `누락: ${MIX.filter(t => !bat3.includes(t)).join(' / ')}`)
    const p3 = !batTheme.includes('시사·사회적 소재') && batTheme.includes('아는 척하지 말고')
    rec('TOPICMIX', 'batch(theme) 구비 생략·적합성 유지', p3, p3 ? 'theme 우선 확인' : `구비생략=${!batTheme.includes('시사·사회적 소재')}, 적합성=${batTheme.includes('아는 척하지 말고')}`)
    const p4 = !sug1.includes('시사·사회적 소재') && sug1.includes('아는 척하지 말고')
    rec('TOPICMIX', 'suggest(1개) 구비 생략·적합성 유지', p4, p4 ? 'count=1 모순 방지 확인' : `구비생략=${!sug1.includes('시사·사회적 소재')}, 적합성=${sug1.includes('아는 척하지 말고')}`)
  } catch (e) {
    rec('TOPICMIX', 'topicBatchPrompt 생성', false, `예외: ${e.message}`)
  }

  // ── 출력 (gate-korean-rules.js와 동일 형식) ──
  let pass = 0, fail = 0
  let curGroup = ''
  for (const r of results) {
    if (r.group !== curGroup) { console.log(`\n[${r.group}]`); curGroup = r.group }
    if (r.pass) pass++; else fail++
    console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  — ${r.detail}`)
  }
  const total = pass + fail
  console.log(`\n전체 ${pass}/${total} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  // process.exit()는 파이프 출력 시 stdout을 flush 전에 잘라 표가 사라진다.
  // exitCode만 세팅하고 자연 종료시켜 출력이 온전히 나오게 한다.
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.message ? e.message : e); process.exitCode = 1 })
