// 🔄 AI 재평가 헬퍼
// 학생/주제 둘 다 공통 사용
// 이전 점수는 previous_* 컬럼에 백업 후 새 점수로 덮어쓰기

import { supabase } from './supabase'
import { callGeminiStructured, SCHEMAS } from './gemini'

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
    const rubrics = topic.rubrics
    const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)
    const rubricText = rubrics.map((r, i) =>
      `${i + 1}. ${r.name} (${r.score}점)${r.hint ? `\n   → 평가 포인트: ${r.hint}` : ''}`
    ).join('\n')

    const prompt = `당신은 초등 5학년 글쓰기 선생님입니다. 학생의 글을 엄정하게 평가해주세요.

📌 글쓰기 주제: ${topic.title}
${topic.description ? '📝 주제 설명: ' + topic.description : ''}

📊 평가 기준 (총 ${totalMax}점 만점):
${rubricText}

✍️ 학생이 쓴 글:
${submission.essay_text}

⚠️ 매우 중요한 채점 원칙:
1. 학생 글이 위 "글쓰기 주제"와 관련 있는지 먼저 확인하세요. 주제와 무관한 글이면 점수를 낮게 주세요.
2. 각 평가 기준의 "평가 포인트"를 글이 실제로 충족했는지 구체적으로 확인하세요.
3. **만점은 정말 뛰어난 글에만 주세요.** 평범하게 잘 쓴 글은 70~85% 수준이 적절합니다.
4. 5학년 수준이지만 채점은 엄정하게.
5. 각 점수는 절대 해당 기준의 만점을 넘으면 안 됨.

📤 응답 형식:
- scores: 평가기준 순서대로 점수 배열
- total: 합계 (만점 초과 금지)
- overall: 종합의견 (2-3문장, 격려하되 솔직하게)
- good: 잘한 점 2가지 (구체적으로)
- improve: 발전시킬 점 2가지 (구체적이고 실행 가능하게)
- corrections: 명백한 맞춤법/띄어쓰기 오류만 (학생 글에 정확히 등장하는 표현만, 없으면 빈 배열)
  ⚠️ corrections 작성 규칙 (꼭 지켜주세요):
  1. original 필드에는 학생 글에 "정확히 그대로 등장하는" 문자열만 적기 (한 글자도 다르면 안 됨)
  2. 학생이 이미 마침표/쉼표/물음표를 찍은 부분은 절대 "마침표 누락"으로 잡지 말 것
  3. 띄어쓰기 오류는 학생 글에 실제로 띄어쓰기가 없는 경우에만
  4. 확실하지 않으면 빈 배열로 반환 (오탐보다 미탐이 나음)`

    const result = await callGeminiStructured(apiKey, prompt, SCHEMAS.essayFeedback, {
      taskType: 'quality',
      maxTokens: 8000
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

    // DB 업데이트
    const { error } = await supabase.from('submissions').update({
      scores: result.scores,
      total_score: result.total,
      max_score: totalMax,
      feedback_overall: result.overall || '글을 잘 써주었어요!',
      feedback_good: result.good || '열심히 글을 썼어요.',
      feedback_improve: result.improve || '더 자세하게 써보세요.',
      corrections: Array.isArray(result.corrections) ? result.corrections : [],
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
