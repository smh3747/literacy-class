// step671: "글 먼저 제출 → 나중에 자동 채점" 판정 — 순수 함수(브라우저·서버 공용). 게이트: scripts/gate-grade-pending.js
//   구글 혼잡·한도 초과·응답 지연으로 채점이 안 되면, 켜 둔 학급에 한해 오류 모달 대신 글을 점수 없이 저장하고
//   (submissions.grade_status='pending') 학생 화면이 열려 있는 동안 서버가 다시 채점한다(pages/api/grade-backfill.js).
//   꺼진 학급은 종전 그대로다(오류 모달·보조 모델 전환).

// 학급 스위치(시범). 켜진 학급만 ① 채점을 메인 모델로만 하고 ② 혼잡 실패를 보류 저장으로 넘긴다.
//   지금은 하랑초 뽀로로반(가입 코드 7420) 한 반. 전체로 넓힐 때 classes 컬럼 스위치로 옮긴다.
export const DEFER_PILOT_CLASS_IDS = ['630e95ed-efc3-4a29-919c-7896d0687dfb']

export function isDeferClass(classId) {
  return !!classId && DEFER_PILOT_CLASS_IDS.includes(String(classId))
}

// 실검증용 강제 실패 표식. 켜진 학급에서 글 안에 이 문구가 들어 있으면 서버가 구글을 부르지 않고 503을 흉내 낸다.
//   구글이 실제로 바쁘지 않아도 보류 경로(저장 → 안내 카드 → 자동 채점)를 재현하기 위한 장치다.
//   나중 채점(grade-backfill)에는 적용하지 않으므로 그 글은 곧 정상 채점된다. 꺼진 학급에서는 아무 효과가 없다.
export const FORCE_DEFER_MARKER = '#보류시험'

export function shouldForceDefer({ classId, essay } = {}) {
  return isDeferClass(classId) && typeof essay === 'string' && essay.includes(FORCE_DEFER_MARKER)
}

/**
 * 실패한 채점 요청을 보류로 넘길 이유. 넘기지 않을 실패면 null.
 * @param u { status, quota, timeout, message } — pages/api/ai.js가 error_logs에 남기는 upstream과 같은 모양
 * @returns 'busy503' | 'limit' | 'timeout' | null
 *   503(혼잡)·429(분당·일일 한도)·시간 초과만 보류. 안전 필터·키 무효·잔액 소진·로그인 만료·그 밖의 오류는 종전 흐름.
 */
export function deferReasonOf(u) {
  if (!u || typeof u !== 'object') return null
  const msg = String(u.message || '')
  if (/API_KEY_INVALID|API key not valid|prepayment|credits are depleted|billing#prepay|AI_SAFETY_BLOCKED/i.test(msg)) return null
  const st = Number(u.status)
  if (st === 503 || /\[congestion busy503|\b503\b|overloaded|high demand/i.test(msg)) return 'busy503'
  if (st === 429 || u.quota || /\[congestion rate429|\b429\b|RESOURCE_EXHAUSTED/i.test(msg)) return 'limit'
  if (u.timeout || /TIMEOUT/i.test(msg)) return 'timeout'
  return null
}

// ── 나중 채점(접속 시) 조율 ──
export const CLAIM_MS = 90 * 1000          // 한 글을 잡은 뒤 이 시간 동안은 다른 요청이 같은 글을 채점하지 않는다
export const CLASS_CAP_WINDOW_MS = 60 * 1000
export const CLASS_CAP = 4                 // 한 학급에서 60초 안에 시작하는 나중 채점 수 상한(풀리는 순간 몰림 방지)
export const POLL_FIRST_MS = 20 * 1000     // 학생 화면 폴링: 첫 시도까지
export const POLL_INTERVAL_MS = 30 * 1000  //                이후 간격
export const POLL_MAX_TRIES = 30           //                최대 횟수(약 15분)

// 지금 이 글을 잡아도 되는가(선점 판정). claimedAt이 없거나 CLAIM_MS보다 오래됐으면 가능.
export function isClaimable(claimedAt, nowMs = Date.now()) {
  if (!claimedAt) return true
  const t = new Date(claimedAt).getTime()
  if (!Number.isFinite(t)) return true
  return nowMs - t >= CLAIM_MS
}

export function underClassCap(recentClaims, cap = CLASS_CAP) {
  return (Number(recentClaims) || 0) < cap
}
