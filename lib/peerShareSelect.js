// 📚 step619: 우리 반 글 모음 — 후보 선정(순수 함수, 서버·스크립트 공용, DB·네트워크 없음).
//   규칙(확정): 주제별 학생 최고점 글(attempt ≤ 2 — 첫 글·1차 수정본) 상위 5편. 동점은 먼저 제출 순.
//   제외: total_score null(안전 필터 차단) · paste_detected · 숨김 학생 · 동의 미완료(realname 부재) · 삭제 글.
//   교사 선택(overrides): exclude = 자동 선정에서 뺌 / add = 자격(attempt 무관)을 산출 시점에 다시 검증해 추가
//   (동의 철회·삭제·점수 null이면 자동 탈락). 순서 = 자동 순위 → 추가분 created_at 순.
//   scripts/gate-peer-share.js가 검증한다.

export const PEER_SHARE_LIMIT = 5

// 동의 완료 = realname이 비어 있지 않음(앱 전역 규칙: showcaseRanking·supply-ranking·submissions.js isConsentLocked)
export function hasConsent(profile) {
  return !!profile && !!String(profile.realname == null ? '' : profile.realname).trim()
}

// 글 하나가 공유 자격이 있는지(attempt 무관). profile은 작성자 profiles 행.
export function isEligible(sub, profile) {
  if (!sub || !profile) return false
  if (sub.deleted_at) return false
  if (sub.total_score == null) return false
  if (sub.paste_detected === true) return false
  if (profile.is_hidden) return false
  if (!hasConsent(profile)) return false
  return true
}

const timeOf = (s) => {
  const t = new Date(s?.created_at || 0).getTime()
  return Number.isFinite(t) ? t : 0
}

// 입력: submissions(한 주제의 제출 행들), profiles(작성자 행 배열 또는 id→행 맵), overrides([{submission_id, action}])
// 출력: { auto: [submissionId…](제외 전 자동 5편), shown: [{ submissionId, userId, score, attempt, createdAt, source }],
//         excludedAutoIds: [submissionId…], addedIds: [submissionId…] }
export function selectPeerShare({ submissions, profiles, overrides, limit = PEER_SHARE_LIMIT } = {}) {
  const subs = Array.isArray(submissions) ? submissions.filter(Boolean) : []
  const profById = Array.isArray(profiles)
    ? Object.fromEntries(profiles.filter(p => p && p.id).map(p => [p.id, p]))
    : (profiles && typeof profiles === 'object' ? profiles : {})
  const ov = Array.isArray(overrides) ? overrides.filter(o => o && o.submission_id) : []
  const excludeSet = new Set(ov.filter(o => o.action === 'exclude').map(o => o.submission_id))
  const addSet = new Set(ov.filter(o => o.action === 'add').map(o => o.submission_id))
  const subById = Object.fromEntries(subs.filter(s => s.id).map(s => [s.id, s]))

  // 자동 후보: 자격 + attempt ≤ 2 → 학생별 최고점 1건(동점은 먼저 제출)
  const bestByUser = {}
  for (const s of subs) {
    if (!isEligible(s, profById[s.user_id])) continue
    const attempt = Number(s.attempt) || 1
    if (attempt > 2) continue
    const cur = bestByUser[s.user_id]
    if (!cur) { bestByUser[s.user_id] = s; continue }
    const a = Number(s.total_score) || 0, b = Number(cur.total_score) || 0
    if (a > b || (a === b && timeOf(s) < timeOf(cur))) bestByUser[s.user_id] = s
  }
  const ranked = Object.values(bestByUser)
    .sort((x, y) => (Number(y.total_score) || 0) - (Number(x.total_score) || 0) || timeOf(x) - timeOf(y))
  const auto = ranked.slice(0, Math.max(0, Number(limit) || PEER_SHARE_LIMIT)).map(s => s.id)
  const autoSet = new Set(auto)

  const toItem = (s, source) => ({
    submissionId: s.id, userId: s.user_id,
    score: s.total_score == null ? null : Number(s.total_score),
    attempt: Number(s.attempt) || 1, createdAt: s.created_at || null, source,
  })
  const shown = []
  const seen = new Set()
  const excludedAutoIds = []
  for (const id of auto) {
    if (excludeSet.has(id)) { excludedAutoIds.push(id); continue }
    shown.push(toItem(subById[id], 'auto')); seen.add(id)
  }
  // 추가분: 자격 재검증(attempt 무관), 자동에 이미 있으면 중복 제거, created_at 순
  const addedIds = []
  const adds = [...addSet]
    .map(id => subById[id]).filter(Boolean)
    .filter(s => !seen.has(s.id) && !autoSet.has(s.id) && isEligible(s, profById[s.user_id]))
    .sort((x, y) => timeOf(x) - timeOf(y))
  for (const s of adds) { shown.push(toItem(s, 'added')); seen.add(s.id); addedIds.push(s.id) }

  return { auto, shown, excludedAutoIds, addedIds }
}
