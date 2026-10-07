// 🟣 step606: AI 안전 필터 차단 — 클라이언트 공용 헬퍼(순수 함수, 브라우저·Node 모두 가능).
//   서버(lib/gemini.js)가 code 'AI_SAFETY_BLOCKED'로 돌려준 차단을 학생 화면이 "점수 없이 저장"으로
//   처리할 때 쓰는 필드·문구·알림 인자를 한곳에 모은다. scripts/gate-safety-block.js가 검증한다.
//   표식: total_score IS NULL + graded_with_model = 'safety_blocked' (기존 컬럼만, SQL 추가 없음).
//   재평가가 성공하면 graded_with_model이 실제 모델로 덮여 표식이 자연히 사라진다.

export const SAFETY_BLOCK_CODE = 'AI_SAFETY_BLOCKED'
export const SAFETY_BLOCKED_MODEL = 'safety_blocked'

// 학생 대면 문구(존댓말·쉬운 말). 재시도 권유 없음 — 같은 글은 다시 막힌다.
export const STUDENT_BLOCKED_MESSAGE =
  'AI가 이 글을 평가하지 못했어요. 글이 잘못된 게 아니라 AI 쪽 사정이에요. 선생님께서 직접 봐주실 거예요.'
// 교사 칩 title
export const TEACHER_BLOCKED_HINT =
  'AI 안전 필터가 평가를 거절했어요. 글 내용 문제가 아닌 AI 쪽 오판일 수 있어요. 직접 읽고 코멘트를 남겨주세요.'

export function isSafetyBlockedErr(err) {
  return !!err && err.code === SAFETY_BLOCK_CODE
}

export function isBlockedSubmission(sub) {
  return !!sub && sub.graded_with_model === SAFETY_BLOCKED_MODEL
}

// 점수 없이 저장할 때 insert에 섞는 필드. 공통 필드(user_id·topic_id·essay_text·attempt…)는 호출처가 넣는다.
export function blockedRowFields(totalMax) {
  return {
    scores: null,
    rubric_reasons: null,
    total_score: null,
    max_score: typeof totalMax === 'number' ? totalMax : null,
    feedback_overall: null,
    feedback_good: null,
    feedback_improve: null,
    improve_examples: null,
    corrections: [],
    graded_with_model: SAFETY_BLOCKED_MODEL,
    is_fallback_graded: false,
  }
}

// 담임 알림(create_notification RPC 인자). type은 CHECK 11종 고정이라 'message' 재사용(step530과 동일).
//   링크는 교사 제출물 페이지의 ?topic=&student= 자동 진입(pages/teacher/submissions.js) 재사용.
export function blockedNotificationArgs({ teacherId, number, topicId, userId }) {
  if (!teacherId) return null
  const who = number ? `${number}번 학생` : '학생'
  const q = [topicId ? `topic=${encodeURIComponent(topicId)}` : null,
             userId ? `student=${encodeURIComponent(userId)}` : null].filter(Boolean).join('&')
  return {
    p_recipient: teacherId,
    p_type: 'message',
    p_title: `🟣 ${who} 글이 AI 안전 필터에 걸려 점수 없이 저장됐어요`,
    p_body: '글이 잘못된 게 아니라 AI 쪽 사정이에요. 직접 읽고 코멘트를 남겨주세요.',
    p_link: q ? `/teacher/submissions?${q}` : '/teacher/submissions',
  }
}
