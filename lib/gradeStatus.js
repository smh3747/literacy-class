// step669: 채점 보류 표식 — 공용 헬퍼(순수 함수, 브라우저·Node 모두 가능). 게이트: scripts/gate-grade-pending.js
//   구글 혼잡·한도 초과로 채점이 안 될 때 글을 점수 없이 먼저 제출하고(grade_status='pending') 나중에 자동 채점한다(step670~671).
//   이 파일은 표식 판정·표시 문구·저장 필드만 모은다. step669에서는 표시 정리에만 쓰이고, 보류 행을 만드는 코드는 아직 없다.
//   표식: submissions.grade_status ('pending' | 'done' | 'failed', 기존 글은 null). SQL은 migrations/step668-grade-status.sql.
//   안전 필터 행(graded_with_model='safety_blocked', lib/safetyBlock.js)과는 별개다. 둘 다 total_score가 null이므로
//   "점수 없음" 표시를 고를 때는 보류 → 실패 → 그 밖(안전 필터) 순서로 본다.

export const GRADE_PENDING = 'pending'
export const GRADE_DONE = 'done'
export const GRADE_FAILED = 'failed'
export const GRADE_REASONS = ['busy503', 'limit', 'timeout']

export function isPendingGrade(sub) {
  return !!sub && sub.grade_status === GRADE_PENDING
}
export function isFailedGrade(sub) {
  return !!sub && sub.grade_status === GRADE_FAILED
}

// 학생 대면 문구(존댓말·쉬운 말)
export const STUDENT_PENDING_TITLE = '⏳ 글은 잘 냈어요'
export const STUDENT_PENDING_MESSAGE = '글은 잘 냈어요. AI가 바빠서 점수는 조금 뒤에 나와요.'
export const STUDENT_PENDING_SHORT = '⏳ 점수를 기다리고 있어요'
// 교사·관리자 표시
export const TEACHER_PENDING_LABEL = '⏳ 채점 대기'
export const TEACHER_PENDING_HINT = '구글 AI가 바빠서 글을 먼저 받아 두었어요. 학생이 화면을 켜 두면 자동으로 채점돼요. 급하면 재평가를 눌러 주세요.'
export const TEACHER_FAILED_LABEL = '⚠ 채점 실패'
export const TEACHER_FAILED_HINT = '기한 안에 자동 채점을 하지 못했어요. 재평가 버튼으로 다시 채점할 수 있어요.'

/**
 * 점수 없는 행(total_score null)에 붙일 짧은 표시. 보류·실패가 아니면 호출처가 준 기본 문구(안전 필터용)를 그대로 돌려준다.
 * @param sub 제출 행  @param fallback 기본 문구(예: 'AI 평가 없음')  @param who 'teacher'(기본) | 'student'
 */
export function noScoreLabel(sub, fallback, who = 'teacher') {
  if (isPendingGrade(sub)) return who === 'student' ? STUDENT_PENDING_SHORT : TEACHER_PENDING_LABEL
  if (isFailedGrade(sub)) return who === 'student' ? fallback : TEACHER_FAILED_LABEL
  return fallback
}

// 점수 없는 행의 설명(title). 보류·실패가 아니면 기본 설명을 그대로.
export function noScoreHint(sub, fallback) {
  if (isPendingGrade(sub)) return TEACHER_PENDING_HINT
  if (isFailedGrade(sub)) return TEACHER_FAILED_HINT
  return fallback
}

// 엑셀 점수 칸에 넣을 값. 점수가 있으면 점수, 없으면 보류·실패 표기 또는 빈칸(종전과 같음).
export function exportScoreCell(sub) {
  if (sub && sub.total_score != null) return sub.total_score
  if (isPendingGrade(sub)) return '채점 대기'
  if (isFailedGrade(sub)) return '채점 실패'
  return sub ? sub.total_score : null
}

// 점수 없이 먼저 저장할 때 insert에 섞는 필드(step670에서 사용). total_score는 반드시 null(0 금지) —
//   grade_avg_stats RPC·랭킹·성장 그래프가 null은 빼고 0은 평균에 넣기 때문이다. 안전 필터 blockedRowFields와 같은 방식.
export function pendingRowFields(totalMax, reason) {
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
    graded_with_model: null,
    is_fallback_graded: false,
    grade_status: GRADE_PENDING,
    grade_reason: GRADE_REASONS.includes(reason) ? reason : null,
  }
}
