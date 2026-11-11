// step671: "글 먼저 제출 → 나중에 자동 채점" 판정 — 순수 함수(브라우저·서버 공용). 게이트: scripts/gate-grade-pending.js
//   구글 혼잡·한도 초과·응답 지연으로 채점이 안 되면, 켜 둔 학급에 한해 오류 모달 대신 글을 점수 없이 저장하고
//   (submissions.grade_status='pending') 학생 화면이 열려 있는 동안 서버가 다시 채점한다(pages/api/grade-backfill.js).
//   꺼진 학급은 종전 그대로다(오류 모달·보조 모델 전환). step675부터 전 학급 기본 켜짐.

// 학급 스위치(step675: 전 학급 기본 켜짐 + 끄는 목록). 켜진 학급은 ① 채점을 메인 모델로만 하고 ② 혼잡 실패를 보류 저장으로 넘긴다.
//   끄는 방법 두 가지(둘 다 서버에서만 읽는다. 브라우저는 서버 응답의 defer 표식만 따른다):
//   ① 서버 환경변수 GRADE_DEFER_OFF: "all"이면 전체 끔, 학급 id를 쉼표로 적으면 그 반만 끔. 코드 수정 없이 Vercel에서 값을 바꾸고 Redeploy.
//   ② 아래 DEFER_OFF_CLASS_IDS 상수에 학급 id 추가(코드 수정 + push).
//   DEFER_DEFAULT_ON을 false로 바꾸면 환경변수와 무관하게 전체가 꺼진다.
export const DEFER_DEFAULT_ON = true
export const DEFER_OFF_CLASS_IDS = []
export const DEFER_OFF_ENV = 'GRADE_DEFER_OFF'

// 환경변수 값 해석. "all"(대소문자 무관) → 전체 끔. 그 밖은 쉼표·공백으로 나눈 학급 id 목록.
export function parseDeferOff(raw) {
  const parts = String(raw == null ? '' : raw).split(/[\s,]+/).map(x => x.trim()).filter(Boolean)
  return { all: parts.some(x => x.toLowerCase() === 'all'), ids: parts.filter(x => x.toLowerCase() !== 'all') }
}

// offRaw: 서버가 process.env.GRADE_DEFER_OFF를 넘긴다. 넘기지 않으면 상수만 본다.
export function isDeferClass(classId, offRaw) {
  if (!classId || !DEFER_DEFAULT_ON) return false
  const id = String(classId)
  if (DEFER_OFF_CLASS_IDS.includes(id)) return false
  const off = parseDeferOff(offRaw)
  if (off.all || off.ids.includes(id)) return false
  return true
}

// 실검증용 강제 실패 표식. 시험 반(6975)에서만, 글 안에 이 문구가 들어 있으면 서버가 구글을 부르지 않고 503을 흉내 낸다.
//   구글이 실제로 바쁘지 않아도 보류 경로(저장 → 안내 카드 → 자동 채점)를 재현하기 위한 장치다.
//   나중 채점(grade-backfill)에는 적용하지 않으므로 그 글은 곧 정상 채점된다.
//   step675: 전 학급 적용과 함께 시험 반으로 좁혔다. 실제 학급 학생이 글에 이 문구를 써도 아무 효과가 없다.
export const FORCE_DEFER_MARKER = '#보류시험'
export const FORCE_DEFER_CLASS_ID = 'f0b64c29-1ec2-45a0-aa20-887b74c991b3'   // 시험 반(6975). lib/testStudent.js TEST_CLASS_ID와 같은 값(게이트로 고정)

export function shouldForceDefer({ classId, essay } = {}) {
  return !!classId && String(classId) === FORCE_DEFER_CLASS_ID && typeof essay === 'string' && essay.includes(FORCE_DEFER_MARKER)
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
