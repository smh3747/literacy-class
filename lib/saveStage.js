// ============================================
// step684: 제출의 "저장 구간" — 채점 결과를 받은 뒤 글을 저장하는 동안의 표시와 다시 시도.
// ============================================
// 배경(11/18 09:26): 채점은 끝났는데 저장이 13초 걸렸고 그동안 화면은 "평가하고 있어요"만 보였다.
//   저장이 실패하면 받은 채점 결과를 버리고 채점부터 다시 했다.
// 원칙: 저장 순서와 저장 내용은 그대로. 바뀌는 것은 ① 저장 중임을 보여 주는 문구 ② 저장만 다시 시도하는 길
//   ③ 저장 응답으로 글 전체 대신 작은 칸만 돌려받기 ④ 저장에 20초 제한.
// 순수 값·함수만 둔다(게이트가 고정).

export const SAVE_SLOW_MS = 5000             // 저장이 이만큼 넘으면 "인터넷이 느려요" 안내
export const SAVE_TIMEOUT_MS = 20000         // 저장이 이만큼 넘으면 실패로 보고 [저장 다시 시도]
export const REWRITE_PRECHECK_TIMEOUT_MS = 10000   // 수정본 제출 전 회차 조회 제한(첫 글의 제출 전 조회와 같은 값)

export const SAVE_TEXT = {
  saving: '채점이 끝났어요. 글을 저장하고 있어요.',
  slow: '인터넷이 느려요. 화면을 닫지 말고 기다려 주세요. 글은 이 기기에도 저장돼 있어요.',
  failTitle: '글을 저장하지 못했어요',
  failBody: '채점은 끝났어요. 아래 [저장 다시 시도]를 눌러 주세요.\n글과 채점 결과는 그대로 있어요.',
  failHint: '여러 번 눌러도 안 되면 선생님께 말씀드려 주세요. 글은 이 기기에 저장돼 있어요.',
  retry: '저장 다시 시도',
  retrying: '저장하고 있어요...',
  close: '닫기',
  closeConfirm: '닫으면 채점 결과가 사라지고, 다음에 다시 제출해야 해요.\n글은 이 기기에 저장돼 있어요. 닫을까요?',
  retryCheckFail: '연결이 불안정해서 아직 저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.\n📝 글과 채점 결과는 그대로 있어요.',
  conflict: '이 주제에는 이미 제출한 글이 있어요. 화면을 새로 불러올게요.',
}

// 저장 응답으로 돌려받는 칸: DB가 채우는 값(id·시각·기본값)만. 글·피드백·교정은 방금 보낸 값을 그대로 쓴다.
export const SAVED_ROW_COLS = 'id, created_at, grade_status, reported, extra_rewrite_allowed, rewrite_requested_at, teacher_comment, teacher_comment_at, teacher_stamp, re_graded_at'

// 화면이 들고 있을 제출 행 = 보낸 값 + DB가 돌려준 값(같은 칸은 DB 값이 이긴다).
export function mergeSavedRow(sent, returned) {
  return { ...(sent || {}), ...(returned || {}) }
}

// 다시 시도 전 확인: 이미 저장된 글이 방금 저장하려던 글과 같은가(같으면 앞 저장이 늦게 성공한 것).
export function sameEssay(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a === b
}

// 단계 → 버튼 문구. 저장 단계가 아니면 null(호출부가 종전 문구를 쓴다).
export function saveStageLabel(stage) {
  return stage === 'saving' || stage === 'slow' ? SAVE_TEXT.saving : null
}
