// 담임 확인 도장 프리셋 (클라이언트 안전 — 비밀/IP 아님, 표시 문자열 상수)
// DB(submissions.teacher_stamp)에는 key만 저장하고, 표시할 때 key→label로 매핑한다.
// 모르는 key는 표시하지 않는다(stampLabel이 null 반환).
export const STAMPS = [
  { key: 'great',  label: '🌟 참 잘했어요' },
  { key: 'idea',   label: '💡 생각이 멋져요' },
  { key: 'effort', label: '🌱 노력이 보여요' },
  { key: 'growth', label: '📈 지난번보다 늘었어요' },
  { key: 'next',   label: '🌈 다음 글이 기대돼요' },
]

export function stampLabel(key) {
  const f = STAMPS.find(s => s.key === key)
  return f ? f.label : null
}
