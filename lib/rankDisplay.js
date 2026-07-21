// step539: 학생 대면 순위 표시 구간화 — 하위권 동기 보호 (표시 계층 전용, 집계·저장 무접촉)
// 규칙(사용자 확정):
//   1~10등           → 등수 그대로
//   11등~상위 50%    → "상위 N%" (N = ceil(순위/전체 × 100))
//   하위 50%         → 등수·퍼센트 숫자 없이 성장형(growthText, 호출부가 양수 재료일 때만 전달)
//                      또는 격려형 로테이션. 하락 시 "-N점" 같은 부정 숫자는 절대 표시하지 않는다.
// 소비처: pages/student/ranking.js(학급 3카드) · pages/student/index.js(챌린지 카드·구획·모달) ·
//         pages/student/history.js(🏅 배지). 교사·관리자 화면은 이 헬퍼를 쓰지 않는다.

export const CHEER_MESSAGES = [
  '순위보다 중요한 건 내 글의 성장이에요. 오늘도 한 편 해냈어요!',
  '글은 쓸수록 늘어요. 꾸준히 쓰는 게 최고예요!',
  '어제의 나보다 나아지는 게 진짜 1등이에요.',
]

// 렌더마다 문구가 바뀌지 않게 날짜(일)+지점 오프셋으로 고정, 날마다 자연 로테이션
export function cheerSeed(offset = 0) {
  return new Date().getDate() + offset
}

// { rank, total, growthText, seed } → { band: 'exact'|'percent'|'cheer', text } | null
// rank·total이 없거나 유효하지 않으면 null — 호출부는 기존 '미표시' 동작을 유지한다.
export function formatMyRank({ rank, total, growthText, seed = 0 } = {}) {
  if (!rank || rank < 1) return null
  if (rank <= 10) return { band: 'exact', text: `${rank}등` }
  if (!total || total < rank) {
    // 분모를 모르면 구체 등수 노출 대신 격려형(하위권 보호가 목적이므로 안전한 쪽으로)
    return { band: 'cheer', text: growthText || CHEER_MESSAGES[Math.abs(seed) % CHEER_MESSAGES.length] }
  }
  const percent = Math.ceil((rank / total) * 100)
  if (percent <= 50) return { band: 'percent', text: `상위 ${percent}%` }
  return { band: 'cheer', text: growthText || CHEER_MESSAGES[Math.abs(seed) % CHEER_MESSAGES.length] }
}
