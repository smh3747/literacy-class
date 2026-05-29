// 🔄 AI 재평가 헬퍼
// 학생/주제 둘 다 공통 사용
// 이전 점수는 previous_* 컬럼에 백업 후 새 점수로 덮어쓰기

import { supabase } from './supabase'
import { callGeminiStructured, SCHEMAS } from './gemini'

/**
 * 평가기준 hint가 비어있으면 AI로 자동 생성
 * (선생님이 만든 기준 이름만으로 채점 가이드 생성)
 */
async function ensureRubricHints(rubrics, topic, apiKey) {
  const needHint = rubrics.filter(r => !r.hint || r.hint.trim().length < 5)
  if (needHint.length === 0) return rubrics // 모두 hint 있음 → 그대로

  try {
    const prompt = `초등 5학년 글쓰기 평가기준의 "평가 포인트(hint)"를 만들어주세요.

📌 글쓰기 주제: ${topic.title}
${topic.description ? '📝 주제 설명: ' + topic.description : ''}

📊 평가 기준:
${rubrics.map((r, i) => `${i + 1}. ${r.name} (${r.score}점)${r.hint ? ' [기존 hint: ' + r.hint + ']' : ' [hint 없음]'}`).join('\n')}

각 평가기준마다 5학년 글을 채점할 때 구체적으로 확인할 포인트를 3-4가지 적어주세요.
- 글의 완성도 중심 (글자 수는 언급하지 말 것)
- 평가 포인트는 누가 봐도 같은 판단을 내릴 수 있을 만큼 구체적으로
- 기존 hint가 있으면 그대로 유지, 없으면 새로 생성

JSON 형식 (rubrics 배열, 각 {name, hint, score}):`

    const result = await callGeminiStructured(apiKey, prompt, SCHEMAS.rubricSet, {
      taskType: 'creative',
      maxTokens: 4000,
      temperature: 0.3
    })

    if (!Array.isArray(result.rubrics)) return rubrics

    // 기존 rubrics + AI hint 병합
    return rubrics.map((r, i) => {
      if (r.hint && r.hint.trim().length >= 5) return r // 기존 유지
      const matched = result.rubrics.find(h => h.name === r.name) || result.rubrics[i]
      return {
        ...r,
        hint: matched?.hint || r.hint || ''
      }
    })
  } catch (e) {
    console.warn('hint 자동 생성 실패 (기존 rubrics로 진행):', e.message)
    return rubrics
  }
}

/**
 * 단일 글 재평가
 * @param {Object} submission - submissions row (essay_text, topic_id 필수)
 * @param {Object} topic - topics row (rubrics 포함)
 * @param {string} apiKey - Gemini API key
 * @param {string} teacherId - 재평가를 실행한 선생님 ID
 * @returns {Promise<{success: boolean, error?: string, newScore?: number, oldScore?: number}>}
 */
export async function regradeSubmission(submission, topic, apiKey, teacherId) {
  if (!submission || !topic) {
    return { success: false, error: '제출물/주제 정보 누락' }
  }
  if (!topic.rubrics || topic.rubrics.length === 0) {
    return { success: false, error: '평가기준이 없는 주제' }
  }
  if (!submission.essay_text) {
    return { success: false, error: '글 내용 없음' }
  }

  try {
    // 🆕 평가기준 hint 자동 보강 (없으면 AI가 만들어줌)
    const rubrics = await ensureRubricHints(topic.rubrics, topic, apiKey)
    const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)
    const rubricText = rubrics.map((r, i) =>
      `${i + 1}. ${r.name} (${r.score}점)${r.hint ? `\n   → 평가 포인트: ${r.hint}` : ''}`
    ).join('\n')

    const prompt = `당신은 초등 5학년 글쓰기 선생님입니다. 학생의 글을 일관되고 엄정하게 평가해주세요.

📌 글쓰기 주제: ${topic.title}
${topic.description ? '📝 주제 설명: ' + topic.description : ''}

📊 평가 기준 (총 ${totalMax}점 만점):
${rubricText}

✍️ 학생이 쓴 글:
${submission.essay_text}

⚠️ 채점 원칙 (꼭 지켜주세요):
1. 각 평가 기준의 "평가 포인트"를 글이 실제로 충족했는지 하나하나 확인하세요.
2. 평가 포인트를 모두 충족했으면 만점, 일부만 충족했으면 비례하여 감점.
3. **평가 기준의 의도를 그대로 따르세요.**
   - 기준 이름이 "상상력", "창의성", "기발함" 등이면 → 비현실적이거나 엉뚱한 설정 자체는 절대 감점 사유로 삼지 마세요.
   - 기준 이름이 "논리력", "근거", "설득력" 등이면 → 그때만 현실성/타당성을 보세요.
4. 주제와 무관한 글이면 점수를 크게 낮추세요.
5. **글의 완성도가 평가의 핵심**입니다. 글자 수가 아니라 짜임새와 의미를 보세요.
6. **모든 학급/모든 학생에게 같은 기준을 적용**하세요. 채점 일관성이 가장 중요합니다.
7. 각 점수는 절대 해당 기준의 만점을 넘으면 안 됨.

📤 응답 형식:
- scores: 평가기준 순서대로 점수 배열
- rubric_reasons: 평가기준 순서대로 점수 근거 배열 (scores와 길이 같아야 함)
   ⚠️ 각 항목은 한 문장 (40-80자). 학생 글의 구체적 부분을 짚어주세요.
- total: 합계 (만점 초과 금지)
- overall: 종합의견 3-4문장 (5학년이 알아듣는 쉬운 말로, 따뜻하지만 솔직하게)
- good: 잘한 점 2가지를 "- 항목1\n- 항목2" 형식 (50-70자, 구체적으로)
- improve: 발전시킬 점 2가지를 "- 항목1\n- 항목2" 형식 (60-80자, 다음에 어떻게 하면 좋을지까지)
- corrections: 맞춤법/띄어쓰기 오류 — **명백한 오류는 빠짐없이 모두 잡아내세요.**
  1. original은 학생 글에 "정확히 그대로 등장하는" 문자열만
  2. 이미 마침표/쉼표/물음표 찍힌 부분은 "마침표 누락"으로 잡지 말 것
  3. 띄어쓰기 오류는 실제로 띄어쓰기가 없는 경우에만
  4. 같은 오류가 여러 번 나오면 각각 다 잡아주세요`

    const result = await callGeminiStructured(apiKey, prompt, SCHEMAS.essayFeedback, {
      taskType: 'grading',   // 🎯 단일 모델 (gemini-3.1-flash-lite만) - 일관성 보장
      maxTokens: 8000,
      temperature: 0.2       // 🎯 낮은 temperature - 일관성 강화
    })

    // 점수 검증 및 캡
    if (!Array.isArray(result.scores)) {
      result.scores = rubrics.map(r => Math.round(r.score * 0.7))
    }
    result.scores = result.scores.map((s, i) => {
      const max = rubrics[i]?.score || 25
      const n = Number(s) || 0
      return Math.max(0, Math.min(n, max))
    })
    if (typeof result.total !== 'number') {
      result.total = result.scores.reduce((a, b) => a + (Number(b) || 0), 0)
    }
    result.total = Math.max(0, Math.min(result.total, totalMax))

    // 🆕 rubric_reasons 검증: scores와 길이 맞추기
    if (!Array.isArray(result.rubric_reasons)) result.rubric_reasons = []
    while (result.rubric_reasons.length < result.scores.length) {
      result.rubric_reasons.push('')
    }
    result.rubric_reasons = result.rubric_reasons.slice(0, result.scores.length)

    // 이전 점수가 백업 안 된 경우만 백업 (재평가를 또 해도 최초 점수는 보존)
    const backupUpdate = {}
    if (submission.previous_scores === null || submission.previous_scores === undefined) {
      backupUpdate.previous_scores = submission.scores
      backupUpdate.previous_total_score = submission.total_score
      backupUpdate.previous_max_score = submission.max_score
      backupUpdate.previous_feedback_overall = submission.feedback_overall
      backupUpdate.previous_feedback_good = submission.feedback_good
      backupUpdate.previous_feedback_improve = submission.feedback_improve
    }

    // 🆕 어떤 모델로 채점됐는지 기록 (폴백 여부 판단)
    const usedModel = result.__usedModel || 'unknown'
    const MAIN_GRADING_MODEL = 'gemini-3.1-flash-lite'
    const isFallback = usedModel !== MAIN_GRADING_MODEL

    // DB 업데이트
    const { error } = await supabase.from('submissions').update({
      scores: result.scores,
      rubric_reasons: result.rubric_reasons,
      total_score: result.total,
      max_score: totalMax,
      feedback_overall: result.overall || '글을 잘 써주었어요!',
      feedback_good: result.good || '열심히 글을 썼어요.',
      feedback_improve: result.improve || '더 자세하게 써보세요.',
      corrections: Array.isArray(result.corrections) ? result.corrections : [],
      graded_with_model: usedModel,
      is_fallback_graded: isFallback,
      re_graded_at: new Date().toISOString(),
      re_graded_by: teacherId,
      ...backupUpdate
    }).eq('id', submission.id)

    if (error) throw error

    return {
      success: true,
      newScore: result.total,
      oldScore: submission.total_score,
      maxScore: totalMax
    }
  } catch (e) {
    return { success: false, error: e.message || String(e) }
  }
}
