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
    { name: '규칙 12(구어체 축약형 문어체 변환 금지)', text: "'필요한거지'는 '필요한 거지'로만" }, // step563: 거/게/건 구어체 축약형 예시 명시 — 7/20 여수송현초 단발 사례 기반 선제 강화(8/19 정정: 백석초 재발 사례는 실존하지 않음)
    { name: '규칙 12(반말 글 존댓말 교정 금지)', text: '반말체는 글쓰기에서 완전히 올바른 문체' }, // step485
    { name: '규칙 12(corrections 판정 원칙)',  text: '유일한 기준' }, // step569: 원칙 승격 — corrections 기준은 "원문이 틀렸는가"뿐
    { name: '규칙 12(높임 표현 교체 금지)',    text: "'집→댁'" }, // step569: 8/19 실사례(집으로→댁으로·에게→께) 대응
    { name: "규칙 12('밖에' 핑퐁 금지)",       text: "'밖에'는 교정하지 마세요" }, // step576: 조사 '밖에'(붙임)/명사구 '밖에'(띄움) 양방향 교정 5:4 공존(전수조사)
    { name: '규칙 12(판정 원칙 문체 예외)',    text: '단 하나의 예외' }, // step577: 원칙 전면 금지가 문체 통일 허용을 덮은 침묵 사례(8/20) 해소
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
      { name: '규칙 12(구어체 축약형 문어체 변환 금지)', text: "'필요한거지'는 '필요한 거지'로만" }, // step563: 거/게/건 구어체 축약형 예시 명시 — 7/20 여수송현초 단발 사례 기반 선제 강화(8/19 정정: 백석초 재발 사례는 실존하지 않음)
      { name: '규칙 12(반말 글 존댓말 교정 금지)', text: '반말체는 글쓰기에서 완전히 올바른 문체' }, // step485
      { name: '규칙 12(corrections 판정 원칙)',  text: '유일한 기준' }, // step569: 원칙 승격 — corrections 기준은 "원문이 틀렸는가"뿐
      { name: '규칙 12(높임 표현 교체 금지)',    text: "'집→댁'" }, // step569: 8/19 실사례(집으로→댁으로·에게→께) 대응
      { name: "규칙 12('밖에' 핑퐁 금지)",       text: "'밖에'는 교정하지 마세요" }, // step576: 조사 '밖에'(붙임)/명사구 '밖에'(띄움) 양방향 교정 5:4 공존(전수조사)
      { name: '규칙 12(판정 원칙 문체 예외)',    text: '단 하나의 예외' }, // step577: 원칙 전면 금지가 문체 통일 허용을 덮은 침묵 사례(8/20) 해소
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

  // ── REWRITE: rewriteGradingPrompt의 첫 글 채점 맥락 (step442 3인자 → step591 5인자: +prevImprove·prevImproveExamples) ──
  // 전부 미전달/null이면 기존 출력과 완전 동일(하위호환), 하나라도 있으면 [첫 글 채점 정보] 블록+조언 이행 계약(규칙 11).
  // step591: 정책 전환("엄격화"→"조언 이행 계약") — 442·455·456·473·476·521·550·559 누적 문구는 계약 (가)~(차)로 대체.
  try {
    const base = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics })
    const withNulls = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, prevScore: null, prevCorrections: null, prevFeedback: null, prevImprove: null, prevImproveExamples: null })
    const withPrev = rewriteGradingPrompt({
      topic, rewriteEssay: essay, rubrics,
      prevScore: 75,
      prevCorrections: [{ original: '어느날', correction: '어느 날' }],
      prevFeedback: '문단 구분 필요'
    })

    // (a) 하위호환: 미전달 === 전부 null, 첫 글 맥락 문구(계약 규칙) 없음
    // ('조언 이행 계약' 단독은 기본부 ⚖️ 줄("점수 처리는 조언 이행 계약을 따릅니다")에도 있어 규칙 11 표제로 검사)
    const CONTRACT_ONLY = ['[첫 글 채점 정보]', '11. **조언 이행 계약', '하락 허용 사유', '반드시 올리세요', '아직 남아 있어요',
      '칭찬으로 시작하는 것은 금지', '하지 않은 개선을 칭찬', '베낄 원문이 아닙니다', '모순되면 안 됩니다']
    const aLeak = CONTRACT_ONLY.filter(p => base.includes(p))
    const aPass = base === withNulls && aLeak.length === 0
    rec('REWRITE', '첫 글 맥락 미전달 = 전부 null 동일(하위호환)', aPass,
      aPass ? '출력 동일, 계약 문구 없음' : (base === withNulls ? `계약 문구가 기본 출력에 섞임: ${aLeak.join(' / ')}` : '미전달과 null 출력 불일치'))

    // (b) 전체 주입: 블록 표제·기준선 점수·지적 목록·총평 + 계약 (가)~(차) 대표 문구
    const bPhrases = ['[첫 글 채점 정보]', '75점 (기준선)', '어느날 → 어느 날', '문단 구분 필요',
      '조언 이행 계약', '다른 어떤 원칙보다 우선', // 규칙 11 표제·우선 선언
      '같은 기준·같은 엄격도', '첫 글 점수 75점이 이번 채점의 기준선', // (가) 기준선
      "'반영 / 부분 반영 / 미반영'", '따옴표', // (나) 반영 확인 의무(559 인용 강제 대체)
      '반드시 올리세요', '오르지 않는 일은 없어야', // (다) 반영 → 상승
      '첫 글 점수를 그대로 유지', '아직 남아 있어요', '하지 않은 개선을 칭찬', '인용할 수 있는 실제 변화', // (라) 미반영 → 유지
      '신규 오류 감점 금지', '새로 생긴 맞춤법 오류 포함', '같은 상태면 같은 점수', // (마)
      '하락 허용 사유(이 넷뿐)', '분량이 크게 줄었을 때', '주제에서 벗어났을 때', '다른 글을 베껴 붙였을 때', '삭제됐을 때', '애매하면 낮추지 마세요', // (바)
      'score_drop_reason에 위 ①~④', '첫 문장을 그 이유로 시작', '칭찬으로 시작하는 것은 금지', // (사)
      '표준 표기가 확실한지 다시 확인', // (아) step456 유지
      '베낄 원문이 아닙니다', // (자) step559 유지
      '모순되면 안 됩니다'] // (차) step476 유지
    const bMissing = bPhrases.filter(p => !withPrev.includes(p))
    rec('REWRITE', '전체 주입 시 블록+조언 이행 계약 (가)~(차) 포함', bMissing.length === 0,
      bMissing.length === 0 ? `${bPhrases.length}문구 모두 포함` : `누락: ${bMissing.join(' / ')}`)

    // step591: 폐기된 옛 규칙 문구가 되살아나지 않았는지(하락 억제·대칭 원칙·수정본 자체 완성도 채점)
    const RETIRED = ['수정본 자체의 완성도로 평가', '함부로 깎지도, 함부로 올리지도', '맞춤법·띄어쓰기 수정만으로는', '뚜렷이 초과해야', '[이전 채점 정보]']
    const bBack = RETIRED.filter(p => withPrev.includes(p))
    rec('REWRITE', 'step591 폐기 문구(엄격화 체제) 부재', bBack.length === 0,
      bBack.length === 0 ? `${RETIRED.length}문구 모두 부재` : `되살아남: ${bBack.join(' / ')}`)

    // (c) 상한: corrections 21개 → 20개+'외 1건', 총평 600자 → 500자, improve 700자 → 600자, 예시 4건 → 3건
    const manyCorr = Array.from({ length: 21 }, (_, i) => ({ original: `오타${i + 1}`, correction: `교정${i + 1}` }))
    const longFb = 'ㄱ'.repeat(600)
    const longImp = 'ㄴ'.repeat(700)
    const fourEx = Array.from({ length: 4 }, (_, i) => ({ original: `예시원문${i + 1}`, suggested: `예시제안${i + 1}`, reason: `이유${i + 1}` }))
    const capped = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, prevCorrections: manyCorr, prevFeedback: longFb, prevImprove: longImp, prevImproveExamples: fourEx })
    const cPass = capped.includes('외 1건') && !capped.includes('오타21')
      && capped.includes('ㄱ'.repeat(500)) && !capped.includes('ㄱ'.repeat(501))
      && capped.includes('ㄴ'.repeat(600)) && !capped.includes('ㄴ'.repeat(601))
      && capped.includes('예시원문3') && !capped.includes('예시원문4')
    rec('REWRITE', '상한 적용(지적 20개+외 N건, 총평 500자, 조언 600자, 예시 3건)', cPass,
      cPass ? "'외 1건', 21번째 미포함, 총평 500자, 조언 600자, 예시 3건 절단" : `외1건=${capped.includes('외 1건')}, 오타21제외=${!capped.includes('오타21')}, 500자=${capped.includes('ㄱ'.repeat(500)) && !capped.includes('ㄱ'.repeat(501))}, 600자=${capped.includes('ㄴ'.repeat(600)) && !capped.includes('ㄴ'.repeat(601))}, 예시3건=${capped.includes('예시원문3') && !capped.includes('예시원문4')}`)

    // (d) 부분 주입: prevScore만 → 블록은 있되 조언·지적·총평 줄 없음 + 조언 목록 없을 때의 폴백(총평 조언 판정) 문장 존재
    // (규칙 (아)·폴백 문장에도 '첫 글에서 지적한 맞춤법·표현'·'첫 글 총평 요약'이 있어 블록 줄 표제(콜론 포함)로 정밀 검사)
    const scoreOnly = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, prevScore: 88 })
    const dPass = scoreOnly.includes('[첫 글 채점 정보]') && scoreOnly.includes('88점 (기준선)')
      && !scoreOnly.includes('- 첫 글에서 준 조언(improve):') && !scoreOnly.includes('- 첫 글에서 보여 준 고쳐 쓰기 예시:')
      && !scoreOnly.includes('- 첫 글에서 지적한 맞춤법·표현:') && !scoreOnly.includes('- 첫 글 총평 요약:')
      && scoreOnly.includes('조언 목록이 따로 없으면')
    rec('REWRITE', '부분 주입(prevScore만) 시 점수 줄만 + 총평 조언 폴백', dPass,
      dPass ? '점수 줄만 포함, 폴백 문장 있음' : `블록=${scoreOnly.includes('[첫 글 채점 정보]')}, 88점=${scoreOnly.includes('88점 (기준선)')}, 조언줄없음=${!scoreOnly.includes('- 첫 글에서 준 조언(improve):')}, 지적줄없음=${!scoreOnly.includes('- 첫 글에서 지적한 맞춤법·표현:')}, 총평줄없음=${!scoreOnly.includes('- 첫 글 총평 요약:')}, 폴백=${scoreOnly.includes('조언 목록이 따로 없으면')}`)

    // (e) score_drop_reason 응답 형식 지시(step588 그릇에 대한 지시 — 588은 스키마만 있었음): 기본·주입 모두 존재, total과 overall 사이(스키마 propertyOrdering 일치)
    const ePos = (s) => ({ t: s.indexOf('▶ total'), d: s.indexOf('▶ score_drop_reason'), o: s.indexOf('▶ overall') })
    const pb = ePos(base), pp = ePos(withPrev)
    const ePass = pb.d > pb.t && pb.d < pb.o && pp.d > pp.t && pp.d < pp.o && base.includes('반드시 빈 문자열 ""')
    rec('REWRITE', 'score_drop_reason 응답 형식 지시(total→score_drop_reason→overall)', ePass,
      ePass ? '기본·주입 모두 순서 일치, 빈 문자열 지시 있음' : `기본=${JSON.stringify(pb)}, 주입=${JSON.stringify(pp)}, 빈문자열=${base.includes('반드시 빈 문자열 ""')}`)
  } catch (e) {
    rec('REWRITE', 'rewriteGradingPrompt 실행', false, `예외: ${e.message}`)
  }

  // ── CONTRACT: 조언 이행 계약 4케이스 (step591) ──
  // 게이트는 프롬프트 텍스트 스모크: 각 상황에서 모델에 실리는 지시가 존재하는지 고정. 실제 거동은 6975 실검증.
  try {
    const prevImprove = "- '재미있었다'로 끝나는 부분이 많아요. 장면으로 보여주면 생생해져요.\n- 문단을 두 개로 나누면 읽기 쉬워져요."
    const prevImproveExamples = [
      { original: '정말 재미있었다.', suggested: '친구가 떡볶이를 두 그릇이나 시켜서 모두 놀랐다.', reason: '장면으로 보여주면 생생해져요' },
    ]
    const applied = rewriteGradingPrompt({
      topic, rewriteEssay: '오늘 친구가 떡볶이를 두 그릇이나 시켜서 모두 놀랐다.\n\n집에 와서도 그 생각이 났다.', rubrics,
      prevScore: 80, prevImprove, prevImproveExamples, prevFeedback: '장면을 보여 주면 좋아요',
    })
    // (a) 조언 반영 수정본 → 상승: 조언 원문·예시가 블록에 실리고, 반영 판정·반영→상승 지시 존재
    const aNeed = ["'재미있었다'로 끝나는 부분이 많아요", '문단을 두 개로 나누면', '"정말 재미있었다." → "친구가 떡볶이를 두 그릇이나 시켜서 모두 놀랐다."',
      '위 목록의 조언(improve)과 고쳐 쓰기 예시가 판정 대상', "'반영 / 부분 반영 / 미반영'", '반드시 올리세요', '이미 만점인 항목은 유지']
    const aMiss = aNeed.filter(p => !applied.includes(p))
    rec('CONTRACT', '(a) 조언 반영 수정본 → 반영 판정·상승 지시', aMiss.length === 0,
      aMiss.length === 0 ? `${aNeed.length}문구 모두 포함(조언·예시 주입 확인)` : `누락: ${aMiss.join(' / ')}`)

    // (b) 미반영+동일 → 정체+이유: 유지·솔직 명시·하지 않은 개선 칭찬 금지
    const bNeed = ['첫 글 점수를 그대로 유지', '아직 남아 있어요', '하지 않은 개선을 칭찬하는 문장', '글이 사실상 그대로면 첫 글 점수 유지가 기본']
    const bMiss = bNeed.filter(p => !applied.includes(p))
    rec('CONTRACT', '(b) 미반영+동일 → 유지+이유 지시', bMiss.length === 0,
      bMiss.length === 0 ? `${bNeed.length}문구 모두 포함` : `누락: ${bMiss.join(' / ')}`)

    // (c) 주제 이탈 → 하락 허용 + score_drop_reason 필수 + overall 첫 문장 = 사유(칭찬 시작 금지)
    const cNeed = ['② 주제에서 벗어났을 때', 'score_drop_reason에 위 ①~④ 중 무엇 때문인지 한 문장으로 반드시', '첫 문장을 그 이유로 시작', '칭찬으로 시작하는 것은 금지',
      '첫 문장: 총점이 첫 글보다 낮으면 그 이유']
    const cMiss = cNeed.filter(p => !applied.includes(p))
    rec('CONTRACT', '(c) 주제 이탈 → 하락 허용+사유 필수+첫 문장 사유', cMiss.length === 0,
      cMiss.length === 0 ? `${cNeed.length}문구 모두 포함` : `누락: ${cMiss.join(' / ')}`)

    // (d) 신규 띄어쓰기 오류만 추가 → 감점 없음+안내: 수정본 모드 검사 블록에 만점 금지 부재, 안내·자기모순 방지 존재, 규칙 (마) 존재
    const newErr = [{ original: '가고싶다', correction: '가고 싶다' }]
    const dPrompt = rewriteGradingPrompt({ topic, rewriteEssay: '나는 이탈리아에 가고싶다.', rubrics, prevScore: 80, prevImprove, ruleErrors: newErr })
    const dNeed = ['가고싶다 → 가고 싶다', '이 오류들은 점수를 깎는 근거가 아닙니다', "improve에서 '다음엔 ~하면 ~해져요'로만 안내",
      "'맞춤법이 완벽하다', '오류가 하나도 없다'", '자기모순', '신규 오류 감점 금지', '새로 생긴 맞춤법 오류 포함']
    const dMiss = dNeed.filter(p => !dPrompt.includes(p))
    const dNoPenalty = !dPrompt.includes('만점을 주지 마세요') && !dPrompt.includes('만점만 금지이며')
    rec('CONTRACT', '(d) 신규 띄어쓰기 오류만 → 감점 없음+안내(만점 금지 부재)', dMiss.length === 0 && dNoPenalty,
      dMiss.length === 0 && dNoPenalty ? `${dNeed.length}문구 포함, 만점 금지 지시 부재` : `누락: ${dMiss.join(' / ')}; 만점금지부재=${dNoPenalty}`)
  } catch (e) {
    rec('CONTRACT', 'CONTRACT 실행', false, `예외: ${e.message}`)
  }

  // ── GRADING: 첫 글 채점 원칙 11 — 수정본 기준선 선언·만점 억제 이전 (step591) ──
  try {
    const g = gradingPrompt({ topic, essay, rubrics })
    const gNeed = ['11. **이 점수는 수정본 채점의 기준선이 됩니다.**', '95점 이상', '오를 자리를 없앱니다', "'반영됐는지' 확인할 수 있을 만큼 구체적으로"]
    const gMiss = gNeed.filter(p => !g.includes(p))
    rec('GRADING', '원칙 11(기준선 선언·만점 억제·조언 구체화)', gMiss.length === 0,
      gMiss.length === 0 ? `${gNeed.length}문구 모두 포함` : `누락: ${gMiss.join(' / ')}`)
    // 기존 원칙 1~10 잔존(채점 기준 불변)
    const missing = []
    for (let n = 1; n <= 10; n++) if (!g.includes(`\n${n}. `)) missing.push(n)
    rec('GRADING', '원칙 1~10 잔존(채점 기준 불변)', missing.length === 0 && g.includes('잘 쓴 글에는 만점을 주저하지 마세요'),
      missing.length === 0 ? '10개 모두 존재' : `누락 번호=${missing.join(',')}`)
  } catch (e) {
    rec('GRADING', 'gradingPrompt 생성', false, `예외: ${e.message}`)
  }

  // ── SELFCHECK: 검사·채점 자기모순 차단 (step555, 요약형 가드 step556) ──
  // ① corrections↔점수 일관성 규칙(만점 금지·'완벽' 표현 금지)이 채점 2종에 잔존.
  // ② ruleErrors(자동 맞춤법 검사 주입) 미전달 시 기존 출력과 완전 동일(하위호환).
  // ③ 전달 시 [자동 맞춤법 검사 요약] 블록: 총 N건 + 대표 예시 상한 3건('외 N건') + 만점 금지
  //    + 절대 표현 금지 + 다른 항목 번짐 금지(step556 가드).
  // ④ 실사례 회귀(7/22 바자회 95→100): '쥐죽은듯이' 잔존인데 맞춤법 만점+"완벽" 칭찬 — 재발 방지.
  // ⑤ step521(하락 사유)·step550(관대화 대칭)·검사 블록이 동시 주입에서 충돌 없이 공존.
  // step591: 수정본은 조언 이행 계약에 따라 '만점 금지'(감점 방향) 대신 '첫 글 점수 초과 금지·신규 오류 감점 금지'로 분리.
  try {
    const SC_COMMON = [
      { name: 'corrections↔점수 일관성 규칙', text: 'corrections와 점수의 일관성' },
      { name: "'오류 없다' 표현 금지",        text: '오류가 없다는 표현' },
    ]
    const SC_BY_PROMPT = {
      gradingPrompt: [{ name: '만점만 금지(감점 강제 아님)', text: '만점만 금지이며' }],
      rewriteGradingPrompt: [
        { name: '점수 처리는 계약 위임',          text: '점수 처리는 조언 이행 계약을 따릅니다' }, // step591
        { name: '지적 오류 잔존 → 첫 글 점수 초과 금지', text: '첫 글 점수를 넘지 못하고' },       // step591
        { name: '새 오류 → 감점 근거 아님',        text: '새 오류는 감점 근거가 아닙니다' },      // step591
      ],
    }
    const scPrompts = {
      gradingPrompt: gradingPrompt({ topic, essay, rubrics }),
      rewriteGradingPrompt: rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics }),
    }
    for (const [pname, s] of Object.entries(scPrompts)) {
      for (const kp of [...SC_COMMON, ...SC_BY_PROMPT[pname]]) {
        const pass = s.includes(kp.text)
        rec('SELFCHECK', `${pname} · ${kp.name}`, pass, pass ? '포함' : `누락: "${kp.text}"`)
      }
    }
    // step591: 수정본 기본부에 감점 방향의 만점 금지가 없어야 함(계약 (마)와 충돌 방지)
    const rNoCap = !scPrompts.rewriteGradingPrompt.includes('만점을 주지 마세요') && !scPrompts.rewriteGradingPrompt.includes('만점만 금지이며')
    rec('SELFCHECK', 'rewriteGradingPrompt · 만점 금지(감점 방향) 부재', rNoCap, rNoCap ? '부재 확인' : '수정본에 만점 금지 지시가 남아 있음')

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

    // ③ 주입: 2건 → 총 2건+대표 예시+절대 표현 금지+번짐 금지. 첫 글은 만점 금지, 수정본(step591 수정본 모드)은 감점 근거 아님+안내.
    const two = [{ original: '어느날', correction: '어느 날' }, { original: '할수있다', correction: '할 수 있다' }]
    const gTwo = gradingPrompt({ topic, essay, rubrics, ruleErrors: two })
    const rTwo = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, ruleErrors: two })
    const dCommon = ['자동 맞춤법 검사', '총 2건', '대표 예시', '어느날 → 어느 날',
      "'맞춤법이 완벽하다', '오류가 하나도 없다'"] // step556: 절대 표현 금지 확장
    const dGrading = ['만점을 주지 마세요', '만점만 금지이며', // step556: 만점 금지≠감점 강제 블록 내 명시
      '다른 항목의 점수를 이 요약 때문에 깎지 마세요'] // step556: 내용·구성·표현 번짐 금지
    const dRewrite = ['이 오류들은 점수를 깎는 근거가 아닙니다', "improve에서 '다음엔 ~하면 ~해져요'로만 안내", // step591: 신규 오류 안내만
      '첫 글 점수를 넘길 수 없습니다', '다른 항목에 번지게 하지 마세요'] // step591: 지적 잔존 상한·번짐 금지
    const dMissing = [...dCommon.filter(p => !gTwo.includes(p) || !rTwo.includes(p)),
      ...dGrading.filter(p => !gTwo.includes(p)).map(p => `grading:${p}`),
      ...dRewrite.filter(p => !rTwo.includes(p)).map(p => `rewrite:${p}`)]
    const dLeak = dGrading.slice(0, 2).filter(p => rTwo.includes(p))
    rec('SELFCHECK', 'ruleErrors 주입 시 요약 블록(첫 글: 만점 금지 / 수정본: 감점 근거 아님+안내)', dMissing.length === 0 && dLeak.length === 0,
      dMissing.length === 0 && dLeak.length === 0 ? `공통 ${dCommon.length}+첫 글 ${dGrading.length}+수정본 ${dRewrite.length}문구 포함, 수정본에 만점 금지 없음` : `누락: ${dMissing.join(' / ')}; 수정본 누수: ${dLeak.join(' / ')}`)

    const five = Array.from({ length: 5 }, (_, i) => ({ original: `오류${i + 1}`, correction: `교정${i + 1}` }))
    const gCap = gradingPrompt({ topic, essay, rubrics, ruleErrors: five })
    const ePass = gCap.includes('총 5건') && gCap.includes('오류3') && !gCap.includes('오류4') && gCap.includes('외 2건')
    rec('SELFCHECK', 'ruleErrors 요약 상한(대표 예시 3건+외 N건)', ePass,
      ePass ? "'총 5건'·3건 표시·'외 2건'" : `총5건=${gCap.includes('총 5건')}, 3표시=${gCap.includes('오류3')}, 4제외=${!gCap.includes('오류4')}, 외2건=${gCap.includes('외 2건')}`)

    // ④ 실사례 회귀(step556): '쥐죽은듯이' 잔존 + 맞춤법 만점 + "완벽" 칭찬(7/22 바자회 95→100).
    //    step591 계약 체제에서는 "완벽" 절대 표현 금지 + (첫 글 지적 잔존이면) 첫 글 점수 초과 금지 + 상승은 반영 조언 항목에만.
    const jwi = [{ original: '쥐죽은듯이', correction: '쥐 죽은 듯이' }]
    const rJwi = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, prevScore: 95, prevCorrections: jwi, ruleErrors: jwi })
    const fPass = rJwi.includes('쥐죽은듯이 → 쥐 죽은 듯이') && rJwi.includes('첫 글 점수를 넘길 수 없습니다')
      && rJwi.includes("'맞춤법이 완벽하다', '오류가 하나도 없다'") && rJwi.includes('인용할 수 있는 실제 변화가 있는 항목에만')
    rec('SELFCHECK', "실사례 회귀('쥐죽은듯이' 잔존 → 완벽 금지·첫 글 점수 초과 금지)", fPass,
      fPass ? '예시·초과 금지·절대 표현 금지·상승 근거 모두 포함' : `예시=${rJwi.includes('쥐죽은듯이 → 쥐 죽은 듯이')}, 초과금지=${rJwi.includes('첫 글 점수를 넘길 수 없습니다')}, 절대표현=${rJwi.includes("'맞춤법이 완벽하다', '오류가 하나도 없다'")}, 상승근거=${rJwi.includes('인용할 수 있는 실제 변화가 있는 항목에만')}`)

    // ⑤ 공존(step556→591): prev 인자 + ruleErrors 동시 주입 시 계약 규칙·검사 블록(수정본 모드)이 전부 존재.
    const rBoth = rewriteGradingPrompt({
      topic, rewriteEssay: essay, rubrics,
      prevScore: 75, prevCorrections: [{ original: '어느날', correction: '어느 날' }], prevFeedback: '문단 구분 필요',
      ruleErrors: two,
    })
    const gPhrases = ['조언 이행 계약', '칭찬으로 시작하는 것은 금지', '하락 허용 사유(이 넷뿐)', // step591 (사)(바)
      '하지 않은 개선을 칭찬', // (라) step550 계승
      '자동 맞춤법 검사', '이 오류들은 점수를 깎는 근거가 아닙니다'] // step555·556 수정본 모드
    const gMissing = gPhrases.filter(p => !rBoth.includes(p))
    rec('SELFCHECK', '동시 주입 시 계약 규칙·검사 블록(수정본 모드) 공존', gMissing.length === 0,
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
