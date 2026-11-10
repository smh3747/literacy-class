// step671: 채점 결과 → 제출 행(lib/gradeRow.js) 회귀 게이트 (읽기 전용 — lib는 import만)
//
// ▶ lib/gradeRow.js 수정 시 커밋 전 실행:  node scripts/gate-grade-row.js
//   이 함수는 브라우저 저장(pages/student/index.js)과 서버 나중 채점(pages/api/grade-backfill.js)이 함께 쓴다.
//   아래 OLD_FIRST·OLD_REWRITE는 step671 이전 학생 홈에 인라인으로 있던 코드를 그대로 옮겨 둔 기준(참조 구현)이다.
//   새 함수가 모든 사례에서 기준과 같은 결과·같은 행을 내야 한다. 기준을 고치려면 의도적 변경임을 커밋에 적을 것.

const path = require('path')
const { pathToFileURL } = require('url')

// ── 기준: step671 이전 첫 글 인라인 코드(원문 그대로) ──
function OLD_FIRST(result, rubrics, essay) {
  const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)
  if (!Array.isArray(result.scores)) result.scores = rubrics.map(r => Math.round(r.score * 0.7))
  result.scores = result.scores.map((s, i) => {
    const max = rubrics[i]?.score || 25
    const n = Number(s) || 0
    return Math.max(0, Math.min(n, max))
  })
  if (typeof result.total !== 'number') result.total = result.scores.reduce((a,b)=>a+(Number(b)||0),0)
  result.total = Math.max(0, Math.min(result.total, totalMax))
  if (!result.overall) result.overall = '글을 잘 써주었어요!'
  if (!result.good) result.good = '열심히 글을 썼어요.'
  if (!result.improve) result.improve = '더 자세하게 써보세요.'
  if (!Array.isArray(result.corrections)) result.corrections = []
  if (!Array.isArray(result.rubric_reasons)) result.rubric_reasons = []
  while (result.rubric_reasons.length < result.scores.length) {
    result.rubric_reasons.push('')
  }
  result.rubric_reasons = result.rubric_reasons.slice(0, result.scores.length)
  if (!Array.isArray(result.improve_examples)) result.improve_examples = []
  result.improve_examples = result.improve_examples
    .filter(ex => ex && typeof ex === 'object' && ex.original && ex.suggested)
    .filter(ex => essay.includes(ex.original))
    .slice(0, 3)
  const usedModel = result.__usedModel || 'unknown'
  const isFallback = usedModel !== 'gemini-3.1-flash-lite'
  return {
    scores: result.scores, rubric_reasons: result.rubric_reasons, total_score: result.total, max_score: totalMax,
    feedback_overall: result.overall, feedback_good: result.good, feedback_improve: result.improve,
    improve_examples: result.improve_examples, corrections: result.corrections,
    graded_with_model: usedModel, is_fallback_graded: isFallback,
  }
}

// ── 기준: step671 이전 수정본 인라인 코드(원문 그대로) ──
function OLD_REWRITE(result, rubrics, rewriteEssay) {
  const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)
  if (!Array.isArray(result.scores)) result.scores = rubrics.map(r => Math.round(r.score * 0.8))
  result.scores = result.scores.map((s, i) => {
    const max = rubrics[i]?.score || 25
    const n = Number(s) || 0
    return Math.max(0, Math.min(n, max))
  })
  if (typeof result.total !== 'number') result.total = result.scores.reduce((a,b)=>a+(Number(b)||0),0)
  const rwTotalMax = rubrics.reduce((s,r) => s + (r.score || 0), 0)
  result.total = Math.max(0, Math.min(result.total, rwTotalMax))
  if (!result.overall) result.overall = '수정본을 잘 써주었어요!'
  if (!result.good) result.good = '글이 더 좋아졌어요.'
  if (!result.improve) result.improve = '계속 노력해보세요.'
  if (!Array.isArray(result.corrections)) result.corrections = []
  if (!Array.isArray(result.rubric_reasons)) result.rubric_reasons = []
  while (result.rubric_reasons.length < result.scores.length) {
    result.rubric_reasons.push('')
  }
  result.rubric_reasons = result.rubric_reasons.slice(0, result.scores.length)
  if (!Array.isArray(result.improve_examples)) result.improve_examples = []
  result.improve_examples = result.improve_examples
    .filter(ex => ex && typeof ex === 'object' && ex.original && ex.suggested)
    .filter(ex => rewriteEssay.includes(ex.original))
    .slice(0, 3)
  const rwUsedModel = result.__usedModel || 'unknown'
  const rwIsFallback = rwUsedModel !== 'gemini-3.1-flash-lite'
  return {
    scores: result.scores, rubric_reasons: result.rubric_reasons, total_score: result.total, max_score: totalMax,
    feedback_overall: result.overall, feedback_good: result.good, feedback_improve: result.improve,
    improve_examples: result.improve_examples, corrections: result.corrections,
    graded_with_model: rwUsedModel, is_fallback_graded: rwIsFallback,
  }
}

;(async () => {
  const { normalizeGradingResult, gradedRowFields, totalMaxOf, MAIN_GRADING_MODEL } =
    await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'gradeRow.js')).href)

  const results = []
  const rec = (name, pass, detail) => results.push({ name, pass, detail })
  const clone = (o) => JSON.parse(JSON.stringify(o))

  const R4 = [{ name: '내용', score: 40 }, { name: '구성', score: 30 }, { name: '표현', score: 20 }, { name: '맞춤법', score: 10 }]
  const R3 = [{ name: 'a', score: 50 }, { name: 'b', score: 25 }, { name: 'c' }]   // 배점 없는 항목(25로 캡, 합계에는 0)
  const ESSAY = '나는 어제 친구와 놀이터에서 놀았다. 그네를 타고 미끄럼틀도 탔다. 정말 재미있었다.'
  const EX = (o, s) => ({ original: o, suggested: s })

  const CASES = [
    ['정상 결과', R4, { scores: [35, 25, 15, 8], total: 83, overall: '좋아요', good: '잘했어요', improve: '더 써요', corrections: [{ original: '놀았다', corrected: '놀았어요' }], rubric_reasons: ['가', '나', '다', '라'], improve_examples: [EX('그네를 타고 미끄럼틀도 탔다.', '그네를 신나게 탔다.')], __usedModel: 'gemini-3.1-flash-lite' }],
    ['scores 없음 → 배점 비율로 채움', R4, { total: 70, overall: 'o', good: 'g', improve: 'i' }],
    ['scores 문자열(배열 아님)', R4, { scores: '35,25', overall: 'o' }],
    ['점수가 배점 초과 → 자름', R4, { scores: [99, 31, 20, 11], total: 161 }],
    ['점수 음수·문자·null → 0 이상 숫자로', R4, { scores: [-5, 'abc', null, '7'], total: 7 }],
    ['점수 개수가 평가기준보다 많음(배점 없으면 25)', R4, { scores: [40, 30, 20, 10, 30] }],
    ['점수 개수가 평가기준보다 적음', R4, { scores: [40, 30] }],
    ['total 없음 → 점수 합', R4, { scores: [30, 20, 10, 5] }],
    ['total 문자열 → 점수 합', R4, { scores: [30, 20, 10, 5], total: '65' }],
    ['total 배점 합 초과 → 자름', R4, { scores: [40, 30, 20, 10], total: 250 }],
    ['total 음수 → 0', R4, { scores: [0, 0, 0, 0], total: -3 }],
    ['total 0(숫자) 보존', R4, { scores: [0, 0, 0, 0], total: 0 }],
    ['피드백 셋 다 빈 문자열 → 기본 문구', R4, { scores: [30, 20, 10, 5], total: 65, overall: '', good: '', improve: '' }],
    ['피드백 없음(undefined·null) → 기본 문구', R4, { scores: [30, 20, 10, 5], total: 65, good: null }],
    ['corrections 객체(배열 아님) → []', R4, { scores: [30, 20, 10, 5], total: 65, corrections: { a: 1 } }],
    ['rubric_reasons 모자람 → 빈 문자열로 채움', R4, { scores: [30, 20, 10, 5], total: 65, rubric_reasons: ['가'] }],
    ['rubric_reasons 넘침 → 자름', R4, { scores: [30, 20], total: 50, rubric_reasons: ['가', '나', '다', '라', '마'] }],
    ['rubric_reasons 문자열(배열 아님)', R4, { scores: [30, 20, 10, 5], total: 65, rubric_reasons: '이유' }],
    ['improve_examples 4개 → 3개', R4, { scores: [30, 20, 10, 5], total: 65, improve_examples: [EX('나는 어제 친구와 놀이터에서 놀았다.', 'a'), EX('그네를 타고 미끄럼틀도 탔다.', 'b'), EX('정말 재미있었다.', 'c'), EX('놀이터', 'd')] }],
    ['improve_examples 글에 없는 문장 제거', R4, { scores: [30, 20, 10, 5], total: 65, improve_examples: [EX('없는 문장이에요.', 'a'), EX('정말 재미있었다.', 'b')] }],
    ['improve_examples 깨진 항목(null·문자열·suggested 없음) 제거', R4, { scores: [30, 20, 10, 5], total: 65, improve_examples: [null, '문자열', { original: '정말 재미있었다.' }, EX('정말 재미있었다.', 'ok')] }],
    ['improve_examples 객체(배열 아님) → []', R4, { scores: [30, 20, 10, 5], total: 65, improve_examples: { original: 'x', suggested: 'y' } }],
    ['보조 모델 표식 → is_fallback_graded true', R4, { scores: [30, 20, 10, 5], total: 65, __usedModel: 'gemini-3-flash-preview' }],
    ['모델 표식 없음 → unknown·fallback true', R4, { scores: [30, 20, 10, 5], total: 65 }],
    ['배점 없는 평가기준 섞임', R3, { scores: [50, 30, 30], total: 110 }],
    ['빈 결과 객체', R4, {}],
    ['소수 점수·소수 total', R4, { scores: [35.5, 25.2, 15, 8], total: 83.7 }],
  ]

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  let n = 0
  for (const [name, rubrics, raw] of CASES) {
    for (const isRewrite of [false, true]) {
      n++
      const a = clone(raw), b = clone(raw)
      const oldRow = (isRewrite ? OLD_REWRITE : OLD_FIRST)(a, rubrics, ESSAY)
      const newRes = normalizeGradingResult(b, { rubrics, essay: ESSAY, isRewrite })
      const newRow = gradedRowFields(newRes, totalMaxOf(rubrics))
      const okRow = same(oldRow, newRow)
      const okRes = same(a, b)   // 화면이 쓰는 result(total·scores·overall…)도 같아야 한다
      rec(`${isRewrite ? '수정본' : '첫 글'} · ${name}`, okRow && okRes, okRow && okRes ? '' : `old=${JSON.stringify(oldRow)} new=${JSON.stringify(newRow)}`)
    }
  }
  rec(`사례 수 20개 이상(첫 글·수정본 각각) — 실제 ${CASES.length}×2 = ${n}`, CASES.length >= 20, '')

  // ── 고정값 몇 개(기준 구현과 무관하게 숫자로) ──
  const r1 = normalizeGradingResult({}, { rubrics: R4, essay: ESSAY, isRewrite: false })
  rec('빈 결과 첫 글: scores [28,21,14,7]·total 70·기본 문구', same(r1.scores, [28, 21, 14, 7]) && r1.total === 70 && r1.overall === '글을 잘 써주었어요!' && r1.good === '열심히 글을 썼어요.' && r1.improve === '더 자세하게 써보세요.', JSON.stringify(r1))
  const r2 = normalizeGradingResult({}, { rubrics: R4, essay: ESSAY, isRewrite: true })
  rec('빈 결과 수정본: scores [32,24,16,8]·total 80·수정본 기본 문구', same(r2.scores, [32, 24, 16, 8]) && r2.total === 80 && r2.overall === '수정본을 잘 써주었어요!' && r2.good === '글이 더 좋아졌어요.' && r2.improve === '계속 노력해보세요.', JSON.stringify(r2))
  rec('받은 객체를 그대로 고쳐서 돌려준다(화면이 같은 객체를 계속 씀)', (() => { const o = { scores: [1, 2, 3, 4] }; return normalizeGradingResult(o, { rubrics: R4, essay: ESSAY }) === o })(), '')
  const row = gradedRowFields(normalizeGradingResult({ scores: [40, 30, 20, 10], total: 100, __usedModel: MAIN_GRADING_MODEL }, { rubrics: R4, essay: ESSAY }), 100)
  rec('채점 필드는 정확히 11개(scores~is_fallback_graded)', Object.keys(row).join(',') === 'scores,rubric_reasons,total_score,max_score,feedback_overall,feedback_good,feedback_improve,improve_examples,corrections,graded_with_model,is_fallback_graded', Object.keys(row).join(','))
  rec('메인 모델이면 is_fallback_graded false', row.is_fallback_graded === false && MAIN_GRADING_MODEL === 'gemini-3.1-flash-lite', '')
  rec('totalMaxOf: 배점 없는 항목은 0으로 합산, 빈 입력 0', totalMaxOf(R3) === 75 && totalMaxOf(null) === 0 && totalMaxOf([]) === 0, '')

  let pass = 0, fail = 0
  for (const r of results) { if (r.pass) pass++; else fail++; if (!r.pass) console.log(`  FAIL  ${r.name}  — ${r.detail}`) }
  console.log(`  (통과한 줄은 생략)`)
  console.log(`\n전체 ${pass}/${pass + fail} PASS${fail ? `  (실패 ${fail}건)` : ''}`)
  process.exitCode = fail ? 1 : 0
})().catch(e => { console.error('게이트 실행 오류:', e && e.stack ? e.stack : e); process.exitCode = 1 })
