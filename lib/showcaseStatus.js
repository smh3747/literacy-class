// step632: 전국 소개(supply_showcase) 상태 매퍼 — 서버 API(pages/api/showcase-status.js)와 게이트 공용 순수 함수
//   입력: supply_showcase 행 [{ submission_id, review_status, review_reason, hidden }]
//   출력: { items: { [submissionId]: { status, hidden, reason?, nicknameIssue? } }, counts: { showing, pending, held } }
//   - status: 'approved' | 'pending' | 'rejected' (그 외 값은 pending 취급)
//   - reason: rejected일 때만, 120자 절단. 닉네임 문구가 있으면 nicknameIssue=true(화면은 "닉네임을 바꾸면 다시 검토돼요"로 대체)
//   - showing = approved && !hidden / held = rejected 또는 approved && hidden
export const REASON_MAX = 120
const NICK_RE = /닉네임/

export function buildShowcaseStatusMap(rows) {
  const items = {}
  const counts = { showing: 0, pending: 0, held: 0 }
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r || !r.submission_id) continue
    const raw = String(r.review_status || 'pending')
    const status = raw === 'approved' || raw === 'rejected' ? raw : 'pending'
    const hidden = r.hidden === true
    const item = { status, hidden }
    if (status === 'rejected') {
      const reason = String(r.review_reason == null ? '' : r.review_reason).trim()
      if (reason) item.reason = reason.length > REASON_MAX ? reason.slice(0, REASON_MAX) + '…' : reason
      if (NICK_RE.test(reason)) item.nicknameIssue = true
    }
    items[r.submission_id] = item
    if (status === 'approved' && !hidden) counts.showing++
    else if (status === 'pending') counts.pending++
    else counts.held++
  }
  return { items, counts }
}

// 화면 배지 재료(순수). 상태 없음 → null(배지 미표시).
export function showcaseBadge(item) {
  if (!item) return null
  if (item.status === 'approved' && !item.hidden) {
    return { text: '🌏 전국에 소개 중', tone: 'sky', title: '확인을 거쳐 닉네임으로 전국에 소개되고 있어요' }
  }
  if (item.status === 'pending') {
    return { text: '🔍 전국 소개 검토 중', tone: 'gray', title: '확인이 끝나면 전국에 소개돼요' }
  }
  if (item.status === 'rejected') {
    const title = item.nicknameIssue ? '닉네임을 바꾸면 다시 검토돼요' : (item.reason || '확인 결과 이번에는 소개하지 않아요')
    return { text: '🚫 전국 소개 보류', tone: 'red', title }
  }
  // approved && hidden — 신고·운영자 비공개
  return { text: '🚫 전국 소개 보류', tone: 'red', title: '신고 또는 운영자 확인으로 지금은 비공개예요' }
}
