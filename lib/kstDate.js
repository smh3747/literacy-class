// KST(한국 시간) 날짜 헬퍼 — step497 확정식(step498에서 공용화)
// toISOString은 UTC 기준이므로 Date.now()에 +9h만 더하면 KST 달력 날짜가 된다.
// 주의: 구식 getTimezoneOffset 보정은 KST 브라우저에서 이중 가산(+18h)되어
//       15시 이후 다음 날을 반환했다(step497에서 제거). 그 패턴을 되살리지 말 것.

// 오늘 날짜 'YYYY-MM-DD'
export function todayStr() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

// N일 전 날짜 'YYYY-MM-DD'
export function daysAgoStr(days) {
  return new Date(Date.now() + 9 * 3600 * 1000 - days * 86400 * 1000).toISOString().slice(0, 10)
}
