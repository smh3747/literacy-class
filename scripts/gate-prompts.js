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
  const { gradingPrompt, grammarStrictPrompt, grammarOnlyPrompt } = mod

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
