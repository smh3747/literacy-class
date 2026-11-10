// step671: 채점 결과 → 제출 행 — 공용 순수 함수(브라우저·서버 모두 사용). 게이트: scripts/gate-grade-row.js
//   종전에는 학생 홈(pages/student/index.js)에 첫 글·수정본 두 벌로 들어 있던 보정 코드다. 한 글자도 바꾸지 않고 옮겼다.
//   서버가 나중에 채점할 때(pages/api/grade-backfill.js)도 같은 함수를 써서, 브라우저가 저장한 행과 같은 행을 만든다.
//   규칙 기반 맞춤법 보강은 서버(pages/api/ai.js)에서 이미 병합돼 오므로 여기서는 corrections를 그대로 쓴다.

export const MAIN_GRADING_MODEL = 'gemini-3.1-flash-lite'

// 첫 글·수정본에서 다른 값(점수 배열이 없을 때 채우는 비율, 빈 피드백 기본 문구)
const DEFAULTS = {
  first: { factor: 0.7, overall: '글을 잘 써주었어요!', good: '열심히 글을 썼어요.', improve: '더 자세하게 써보세요.' },
  rewrite: { factor: 0.8, overall: '수정본을 잘 써주었어요!', good: '글이 더 좋아졌어요.', improve: '계속 노력해보세요.' },
}

export function totalMaxOf(rubrics) {
  return (rubrics || []).reduce((s, r) => s + (r.score || 0), 0)
}

/**
 * AI 채점 결과를 저장 가능한 모양으로 보정한다. 받은 객체를 그대로 고쳐서 돌려준다(종전 인라인 코드와 같은 방식).
 *   - scores: 배열이 아니면 배점×비율(첫 글 0.7, 수정본 0.8)로 채움. 각 점수는 0~배점으로 자름(배점이 없으면 25).
 *   - total: 숫자가 아니면 scores 합. 0~배점 합으로 자름.
 *   - overall·good·improve: 비면 기본 문구.
 *   - corrections: 배열이 아니면 [].
 *   - rubric_reasons: scores 길이에 맞춰 ''로 채우거나 자름.
 *   - improve_examples: original·suggested가 있고 글에 original이 그대로 있는 것만, 최대 3개.
 */
export function normalizeGradingResult(result, { rubrics, essay, isRewrite = false } = {}) {
  const d = isRewrite ? DEFAULTS.rewrite : DEFAULTS.first
  const text = typeof essay === 'string' ? essay : ''
  if (!Array.isArray(result.scores)) result.scores = rubrics.map(r => Math.round(r.score * d.factor))
  result.scores = result.scores.map((s, i) => {
    const max = rubrics[i]?.score || 25
    const n = Number(s) || 0
    return Math.max(0, Math.min(n, max))
  })
  if (typeof result.total !== 'number') result.total = result.scores.reduce((a, b) => a + (Number(b) || 0), 0)
  result.total = Math.max(0, Math.min(result.total, totalMaxOf(rubrics)))
  if (!result.overall) result.overall = d.overall
  if (!result.good) result.good = d.good
  if (!result.improve) result.improve = d.improve
  if (!Array.isArray(result.corrections)) result.corrections = []

  if (!Array.isArray(result.rubric_reasons)) result.rubric_reasons = []
  while (result.rubric_reasons.length < result.scores.length) {
    result.rubric_reasons.push('')
  }
  result.rubric_reasons = result.rubric_reasons.slice(0, result.scores.length)

  if (!Array.isArray(result.improve_examples)) result.improve_examples = []
  result.improve_examples = result.improve_examples
    .filter(ex => ex && typeof ex === 'object' && ex.original && ex.suggested)
    .filter(ex => text.includes(ex.original))
    .slice(0, 3)
  return result
}

// 보정된 결과 → submissions 행의 채점 필드 11개(첫 글·수정본 공통). 그 밖의 필드(user_id·essay_text·attempt…)는 호출처가 넣는다.
export function gradedRowFields(result, totalMax) {
  const usedModel = result.__usedModel || 'unknown'
  return {
    scores: result.scores,
    rubric_reasons: result.rubric_reasons,
    total_score: result.total,
    max_score: totalMax,
    feedback_overall: result.overall,
    feedback_good: result.good,
    feedback_improve: result.improve,
    improve_examples: result.improve_examples,
    corrections: result.corrections,
    graded_with_model: usedModel,
    is_fallback_graded: usedModel !== MAIN_GRADING_MODEL,
  }
}
