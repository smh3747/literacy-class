// step649: 피드백 신고 사유 구조화 — 사유 칩 5개 + 선택 입력(40자)을 기존 report_reason 문자열 한 칸에 "[태그] 상세"로 담는다(SQL 없음).
//   순수 함수(네트워크·DB 없음). 게이트: scripts/gate-report-reason.js
//   담임 신고함(pages/teacher/feedback-reports.js)은 문자열을 그대로 보여주므로 표시 불변, 관리자 목록은 parseReportReason으로 배지 분리.

export const REPORT_TAGS = [
  { key: 'score', label: '점수가 이상해요' },
  { key: 'spell', label: '맞춤법 지적이 틀렸어요' },
  { key: 'content', label: '내 글에 없는 말을 해요' },
  { key: 'unclear', label: '무슨 말인지 모르겠어요' },
  { key: 'other', label: '기타' },
]
export const REPORT_DETAIL_MAX = 40      // 선택 입력 글자 수 상한
export const REPORT_DAILY_LIMIT = 3      // 하루(KST) 신고 상한(글당 1회는 reported 플래그가 담당)

const TAG_LABELS = new Set(REPORT_TAGS.map(t => t.label))

// 칩 라벨 + 선택 입력 → 저장 문자열. 태그가 목록에 없으면 null(저장 거부 신호). 상세는 공백 정리·40자 절단.
export function buildReportReason(tagLabel, detail) {
  if (!TAG_LABELS.has(tagLabel)) return null
  const d = String(detail || '').replace(/\s+/g, ' ').trim().slice(0, REPORT_DETAIL_MAX)
  return d ? `[${tagLabel}] ${d}` : `[${tagLabel}]`
}

// 저장 문자열 → { tag, text }. 태그 접두가 없으면(구 신고·자유 입력) tag null, text 원문.
export function parseReportReason(reason) {
  const s = String(reason || '').trim()
  if (!s) return { tag: null, text: '' }
  const m = s.match(/^\[([^\]]{1,30})\]\s*([\s\S]*)$/)
  if (!m) return { tag: null, text: s }
  return { tag: m[1], text: m[2].trim() }
}

// 오늘(KST) 신고 건수가 상한 이상인지
export function isDailyLimitReached(todayCount, limit = REPORT_DAILY_LIMIT) {
  const n = Number(todayCount)
  return Number.isFinite(n) && n >= limit
}
