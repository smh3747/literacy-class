// step629: 시간 잠금 유예 판정(순수 함수 — 클라이언트 pages/student/index.js 전용, 게이트 공용)
//
// 배경: 잠금 판정은 제출 버튼 시점(클라이언트)이라 채점이 3분 걸려도 통과는 유지된다. 문제는 채점이 **실패**한 뒤
//   재시도하는 순간이 잠금 종료 이후일 때 — "수업 시간이 끝났어요"에 막혀 그 수업 안에 점수를 못 받는다.
// 규칙: 버튼 시점에 잠금을 통과한 시각(passedAt)을 세션 안에 기억해 두고, 종료('after')로 막혔더라도
//   passedAt부터 5분 안이면 1회 허용. 서버 저장은 바꾸지 않는다. 호출처가 passedAt을 지워 1회로 끝낸다.
export const LOCK_GRACE_MS = 5 * 60 * 1000

export function canUseLockGrace({ lock, passedAt, now = Date.now(), graceMs = LOCK_GRACE_MS } = {}) {
  if (!lock || lock.allowed) return false          // 막히지 않았으면 유예가 필요 없다
  if (lock.code !== 'after') return false           // 시작 전('before')·기한 지남 등은 유예 대상 아님
  if (passedAt == null || !Number.isFinite(Number(passedAt))) return false
  const elapsed = now - Number(passedAt)
  return elapsed >= 0 && elapsed <= graceMs
}
