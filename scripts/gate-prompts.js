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
  const { gradingPrompt, grammarStrictPrompt, grammarOnlyPrompt, rewriteGradingPrompt, regradePrompt } = mod

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
  ]
  for (const [pname, s] of Object.entries(prompts)) {
    for (const kp of KEY_PHRASES) {
      const pass = s.includes(kp.text)
      rec('RULES', `${pname} · ${kp.name}`, pass, pass ? '포함' : `누락: "${kp.text}"`)
    }
    // 규칙 번호 1~11 전부 존재 (CORRECTIONS_RULES 항목은 3칸 들여쓰기 "   N. " 형식)
    const missing = []
    for (let n = 1; n <= 11; n++) {
      if (!s.includes(`\n   ${n}. `)) missing.push(n)
    }
    rec('RULES', `${pname} · 규칙 1~11 전부 존재`, missing.length === 0,
      missing.length === 0 ? '11개 모두 존재' : `누락 번호=${missing.join(',')}`)
  }

  // ── REWRITE: rewriteGradingPrompt의 prevGradingText 선택 인자 (step436) ──
  // 미전달/null이면 기존 출력과 완전 동일(하위호환), 전달 시 요약 블록+일관성 규칙이 붙는다.
  try {
    const base = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics })
    const withNull = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, prevGradingText: null })
    const prevText = '총점 95점. 감점 사유: 마무리 문단이 갑자기 끝남.'
    const withPrev = rewriteGradingPrompt({ topic, rewriteEssay: essay, rubrics, prevGradingText: prevText })

    // (a) 하위호환: 미전달 === null, 둘 다 직전 맥락 문구 없음
    const aPass = base === withNull
      && !base.includes('직전 제출 채점 요약')
      && !base.includes('직전 채점과의 일관성')
    rec('REWRITE', 'prevGradingText 미전달 = null 동일(하위호환)', aPass,
      aPass ? '출력 동일, 직전 맥락 문구 없음' : (base === withNull ? '직전 맥락 문구가 기본 출력에 섞임' : '미전달과 null 출력 불일치'))

    // (b) 전달 시 요약 블록 표제 + 주입 텍스트 포함
    const bPass = withPrev.includes('직전 제출 채점 요약') && withPrev.includes(prevText)
    rec('REWRITE', 'prevGradingText 전달 시 요약 블록 삽입', bPass,
      bPass ? '표제+원문 포함' : `누락(표제=${withPrev.includes('직전 제출 채점 요약')}, 원문=${withPrev.includes(prevText)})`)

    // (c) 전달 시 일관성 규칙 문구 포함
    const cPhrases = ['직전보다 내려가면 안 됩니다', '새로 생긴 결함일 때만', '오르는 것이 자연스럽습니다']
    const cMissing = cPhrases.filter(p => !withPrev.includes(p))
    rec('REWRITE', 'prevGradingText 전달 시 일관성 규칙 포함', cMissing.length === 0,
      cMissing.length === 0 ? '3문구 모두 포함' : `누락: ${cMissing.join(' / ')}`)
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
