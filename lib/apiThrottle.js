// API 호출 큐 (분당 호출 제한 보호) — step628: 학급 키별 버킷 + 대기 상한 20초
//
// 어디서 도는가: 서버(pages/api/ai.js → lib/gemini.js)에서 실행된다. 키 서버격리(step153) 이후 클라이언트는
//   AI를 직접 부르지 않으므로 이 카운터는 Vercel 함수 인스턴스 메모리에 산다. (이전 주석 "클라이언트에서 조절"은 옛 구조.)
// 무엇을 세는가: Gemini API 키(교사 학급 키) 해시별로 최근 60초 호출 시각. 다른 학교 요청이 같은 줄에 서지 않는다.
//   step628 전엔 카운터가 인스턴스 전역 하나라 모든 학급이 12 RPM을 나눠 썼다(10/15 송림초 "AI 검토 3분" 원인의 하나).
// 한도: 14 RPM(키 15 RPM 바로 아래). 인스턴스가 여럿이면 각자 따로 세어 초과할 수 있는데, 그 초과는 상류 429 백오프
//   (gemini.js callGeminiStructured 재시도)가 처리한다. 여기서는 20초(MAX_WAIT_MS) 이상 붙잡지 않는다 — 재귀 대기 없음.
// 로그 문구 "⏳ 분당 호출 한도 보호: N초 대기"는 Vercel 집계 검색어로 쓰이므로 유지.

export const RATE_LIMIT_RPM = 14      // 분당 14회 이하로 유지 (15가 한도)
export const WINDOW_MS = 60_000
export const MAX_WAIT_MS = 20_000     // 요청 안에서 붙잡는 최대 시간. 그 이상은 상류 백오프 몫.
const DEFAULT_BUCKET = 'default'

const buckets = new Map()   // hashKey(apiKey) → 최근 호출 시각 오름차순 배열

// 원문 키를 Map 키로 쓰지 않도록 djb2 32bit 해시(16진). 보안 해시가 아니라 식별용.
export function hashKey(key) {
  const s = String(key == null ? '' : key)
  if (!s) return DEFAULT_BUCKET
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(16).padStart(8, '0')
}

function prune(arr, now, windowMs = WINDOW_MS) {
  while (arr.length > 0 && arr[0] <= now - windowMs) arr.shift()
}

// 순수: 창 안 호출 시각 배열(오름차순)과 현재 시각으로 필요한 대기 ms. 한도 미만이면 0.
export function computeWait(timestamps, now, limit = RATE_LIMIT_RPM, windowMs = WINDOW_MS) {
  const inWindow = (timestamps || []).filter(t => t > now - windowMs)
  if (inWindow.length < limit) return 0
  // 가장 오래된 호출이 창을 벗어날 때까지 + 약간의 여유
  const oldest = inWindow[inWindow.length - limit]
  return Math.max(0, oldest + windowMs - now + 100)
}

// 순수: 대기 상한 적용
export function capWait(waitMs, maxWaitMs = MAX_WAIT_MS) {
  return Math.min(Math.max(0, waitMs || 0), maxWaitMs)
}

/**
 * 분당 호출 한도 검사 후 필요시 지연(1회, 최대 MAX_WAIT_MS). 그 뒤 호출을 기록하고 돌아온다.
 * @param {string} [bucketKey] — API 키(학급 키). 없으면 'default' 버킷.
 */
export async function throttleApiCall(bucketKey) {
  const k = hashKey(bucketKey)
  const now = Date.now()
  let arr = buckets.get(k)
  if (!arr) { arr = []; buckets.set(k, arr) }
  prune(arr, now)
  // 다른 버킷의 빈 창 정리(메모리 누수 방지)
  for (const [otherKey, otherArr] of buckets) {
    if (otherKey === k) continue
    prune(otherArr, now)
    if (otherArr.length === 0) buckets.delete(otherKey)
  }

  const waitMs = capWait(computeWait(arr, now))
  if (waitMs > 0) {
    console.log(`⏳ 분당 호출 한도 보호: ${Math.ceil(waitMs / 1000)}초 대기`)
    await new Promise(r => setTimeout(r, waitMs))
  }
  arr.push(Date.now())
}

/**
 * 현재 분당 호출 사용량 (정보 표시·게이트용)
 */
export function getCurrentUsage(bucketKey) {
  const arr = buckets.get(hashKey(bucketKey)) || []
  const oneMinuteAgo = Date.now() - WINDOW_MS
  return { used: arr.filter(t => t > oneMinuteAgo).length, limit: RATE_LIMIT_RPM }
}

// 게이트 전용 — 운영 코드에서 호출하지 않는다.
export function _reset() { buckets.clear() }
export function _seed(bucketKey, timestamps) { buckets.set(hashKey(bucketKey), [...timestamps]) }
