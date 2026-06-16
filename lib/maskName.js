// 이름 마스킹 유틸 (개인정보 최소화)
// 김민수 → 김*수, 홍길 → 홍*, 김 → 김(1자 이하 그대로)
export function maskName(name) {
  if (!name) return ''
  const s = String(name).trim()
  if (s.length <= 1) return s
  if (s.length === 2) return s[0] + '*'
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]
}
