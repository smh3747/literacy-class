// step627: 피크 판정 창 — "요청 시작 시각" 기준, 학급별 최근 60초 채점 요청 수 (서버 함수 인스턴스 메모리)
//
// 배경: 첫 채점 이중 호출(step600)의 60초 가드는 submissions.created_at(채점 완료 뒤 저장) 기준이라
//   동시 제출 초반 15~20초 동안 전원 N=0으로 보여 전용 검사가 전부 실행됐다(10/15 송림초 "AI 검토 3분").
//   이 창은 요청이 들어오는 순간 기록하므로 동시 25명도 3번째 요청부터 즉시 피크로 본다.
// 범위: 인스턴스 메모리(Map). 인스턴스가 여럿이면 각자 따로 세지만 "덜 피크로 보는" 쪽이라 안전(그 경우 저장 기준 N이 보조).
// 사용처: pages/api/ai.js grading·rewriteGrading 분기(요청마다 recordAndCount 1회). exampleEssay·기타 type은 기록하지 않는다.
// 순수 모듈 — DB·네트워크 없음. 게이트: scripts/gate-peak-window.js

export const PEAK_WINDOW_MS = 60_000
export const PEAK_THRESHOLD = 3   // 이번 요청 포함 창 내 3건째부터 피크(1~2명 반은 무영향)

const windows = new Map()   // key(classId 문자열) → 타임스탬프 오름차순 배열

function prune(arr, now, windowMs) {
  while (arr.length > 0 && arr[0] <= now - windowMs) arr.shift()
}

// 창 밖 기록을 버리고 이번 요청을 기록한 뒤, 이번 포함 창 내 건수를 돌려준다. key가 없으면 기록 없이 0.
export function recordAndCount(key, now = Date.now(), windowMs = PEAK_WINDOW_MS) {
  if (key == null || key === '') return 0
  const k = String(key)
  let arr = windows.get(k)
  if (!arr) { arr = []; windows.set(k, arr) }
  prune(arr, now, windowMs)
  arr.push(now)
  // 다른 학급의 빈 창 정리(메모리 누수 방지 — 호출마다 가볍게)
  for (const [otherKey, otherArr] of windows) {
    if (otherKey === k) continue
    prune(otherArr, now, windowMs)
    if (otherArr.length === 0) windows.delete(otherKey)
  }
  return arr.length
}

export function isPeak(count, threshold = PEAK_THRESHOLD) {
  return Number(count) >= threshold
}

// 게이트 전용 — 운영 코드에서 호출하지 않는다.
export function _reset() {
  windows.clear()
}

export function _size() {
  return windows.size
}
