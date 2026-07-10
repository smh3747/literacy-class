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
  const { gradingPrompt, grammarStrictPrompt, grammarOnlyPrompt, rewriteGradingPrompt, regradePrompt, tutorChatPrompt } = mod

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
    rec('REWRITE', '이전 맥락 미전달 = 전부 null 동일(하위호환)', aPass,
      aPass ? '출력 동일, 이전 맥락 문구 없음' : (base === withNulls ? '이전 맥락 문구가 기본 출력에 섞임' : '미전달과 null 출력 불일치'))

    // (b) 전체 주입: 블록 표제·점수·지적 목록·총평·일관성 규칙 포함
    const bPhrases = ['[이전 채점 정보]', '75점', '어느날 → 어느 날', '문단 구분 필요', '다시 포함', '낮은 점수를 주지 마세요']
    const bMissing = bPhrases.filter(p => !withPrev.includes(p))
    rec('REWRITE', '전체 주입 시 블록+일관성 규칙 포함', bMissing.length === 0,
      bMissing.length === 0 ? `${bPhrases.length}문구 모두 포함` : `누락: ${bMissing.join(' / ')}`)

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
    ]
    for (const kp of T_PHRASES) {
      const pass = s.includes(kp.text)
      rec('TUTOR', kp.name, pass, pass ? '포함' : `누락: "${kp.text}"`)
    }
  } catch (e) {
    rec('TUTOR', 'tutorChatPrompt 생성', false, `예외: ${e.message}`)
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
