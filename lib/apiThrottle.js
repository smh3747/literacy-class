// API 호출 큐 (분당 호출 제한 보호)
//
// 같은 학급 학생들이 동시에 제출 누를 때 분당 한도(15회)를 넘지 않도록
// 클라이언트에서 호출 간격을 조절합니다.
//
// 기본 정책: 최근 1분 동안의 호출이 12회 이상이면 1초씩 지연 (15보다 약간 여유)
//
// 주의: 이건 클라이언트 사이드라 같은 학급 다른 학생끼리는 협조 안 됨.
// 하지만 한 학생이 빠르게 여러 번 누르거나, 같은 학생의 첫 글+수정본 연속
// 호출은 막아줌. 분당 한도 도달 자체를 막진 못해도 완화 효과는 있음.

const RATE_LIMIT_RPM = 12 // 분당 12회 이하로 유지 (15가 한도지만 여유)
const callTimestamps = [] // 최근 호출 시각들

/**
 * 분당 호출 한도 검사 후 필요시 지연
 * @returns {Promise<void>} 호출 가능 시 즉시, 한도 가까우면 지연 후 resolve
 */
export async function throttleApiCall() {
  const now = Date.now()
  const oneMinuteAgo = now - 60_000

  // 1분 지난 기록 제거
  while (callTimestamps.length > 0 && callTimestamps[0] < oneMinuteAgo) {
    callTimestamps.shift()
  }

  // 한도 가까우면 대기
  if (callTimestamps.length >= RATE_LIMIT_RPM) {
    // 가장 오래된 호출이 1분 지나갈 때까지 + 약간의 여유
    const waitMs = (callTimestamps[0] + 60_000) - now + 100
    if (waitMs > 0) {
      console.log(`⏳ 분당 호출 한도 보호: ${Math.ceil(waitMs/1000)}초 대기`)
      await new Promise(r => setTimeout(r, waitMs))
      // 재귀로 다시 검사
      return throttleApiCall()
    }
  }

  // 호출 기록 추가
  callTimestamps.push(Date.now())
}

/**
 * 현재 분당 호출 사용량 (정보 표시용)
 */
export function getCurrentUsage() {
  const oneMinuteAgo = Date.now() - 60_000
  const recent = callTimestamps.filter(t => t > oneMinuteAgo)
  return {
    used: recent.length,
    limit: RATE_LIMIT_RPM
  }
}
