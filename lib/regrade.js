// 🔄 AI 재평가 헬퍼
// 학생/주제 둘 다 공통 사용
// 이전 점수는 previous_* 컬럼에 백업 후 새 점수로 덮어쓰기

import { supabase } from './supabase'
import { callAI } from './aiClient'
// 규칙 병합(mergeCorrections)은 서버(pages/api/ai.js)에서 수행 — 여기선 result.corrections 그대로 사용

/**
 * 평가기준 hint가 비어있으면 AI로 자동 생성
 * (선생님이 만든 기준 이름만으로 채점 가이드 생성)
 */
async function ensureRubricHints(rubrics, topic) {
  const needHint = rubrics.filter(r => !r.hint || r.hint.trim().length < 5)
  if (needHint.length === 0) return rubrics // 모두 hint 있음 → 그대로

  try {
    // 🔒 프롬프트는 서버에서 구성 (키 서버격리 step153~: 키 인자 불필요)
    const result = await callAI('rubricHint', {
      topic: { title: topic.title, description: topic.description },
      rubrics,
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
 * @param {string} teacherId - 재평가를 실행한 선생님 ID
 * @returns {Promise<{success: boolean, error?: string, newScore?: number, oldScore?: number}>}
 */
export async function regradeSubmission(submission, topic, teacherId, opts = {}) {
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
    const rubrics = await ensureRubricHints(topic.rubrics, topic)
    const totalMax = rubrics.reduce((s, r) => s + (r.score || 0), 0)

    // 🔒 프롬프트는 서버(/api/ai)에서 구성 — 핵심 IP 보호
    const result = await callAI('regrade', {
      topic: { title: topic.title, description: topic.description },
      essay: submission.essay_text,
      rubrics,
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

    // 🆕 improve_examples 검증
    if (!Array.isArray(result.improve_examples)) result.improve_examples = []
    result.improve_examples = result.improve_examples
      .filter(ex => ex && typeof ex === 'object' && ex.original && ex.suggested)
      .filter(ex => submission.essay_text.includes(ex.original))
      .slice(0, 3)

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
      improve_examples: result.improve_examples,
      total_score: result.total,
      max_score: totalMax,
      feedback_overall: result.overall || '글을 잘 써주었어요!',
      feedback_good: result.good || '열심히 글을 썼어요.',
      feedback_improve: result.improve || '더 자세하게 써보세요.',
      corrections: Array.isArray(result.corrections) ? result.corrections : [],  // 서버에서 규칙 병합 완료
      graded_with_model: usedModel,
      is_fallback_graded: isFallback,
      re_graded_at: new Date().toISOString(),
      re_graded_by: teacherId,
      ...backupUpdate
    }).eq('id', submission.id)

    if (error) throw error

    // 🆕 step261: 단일 재평가일 때만 예시 글 생성 (옵션). 실패해도 재평가 결과엔 영향 없음.
    if (opts.withExample === true) {
      try {
        const exResult = await callAI('exampleEssay', {
          topicTitle: topic.title,
          studentEssay: submission.essay_text,
        })
        if (exResult?.example) {
          await supabase.from('submissions').update({ example_text: exResult.example }).eq('id', submission.id)
        }
      } catch (exErr) {
        console.warn('재평가 예시 생성 실패 (재평가는 정상 완료):', exErr.message)
      }
    }

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
