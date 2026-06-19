// 이름 마스킹 유틸 (개인정보 최소화)
// 김민수 → 김*수, 홍길 → 홍*, 김 → 김(1자 이하 그대로)
export function maskName(name) {
  if (!name) return ''
  const s = String(name).trim()
  if (s.length <= 1) return s
  if (s.length === 2) return s[0] + '*'
  return s[0] + '*'.repeat(s.length - 2) + s[s.length - 1]
}

// 한국 이름 마스킹 (부모 동의 1단계 "곽○윤 학생 맞나요?" 확인용 — 가운데 글자를 ○로)
// 평문 실명은 서버에만 두고, 마스킹 결과만 클라이언트로 내려보내려고 서버(API)에서 호출한다.
//   1글자  = 그대로            (김    → 김)      ※ 가릴 가운데가 없어 그대로 노출
//   2글자  = 마지막 글자 가림  (김유  → 김○)
//   3글자  = 가운데 글자 가림  (곽민윤 → 곽○윤)
//   4글자+ = 첫·끝만 남기고 가운데 전부 가림 (남궁민수 → 남○○수)
// 빈 값/널/공백뿐이면 '' 반환.
export function maskKoreanName(name) {
  if (name == null) return ''
  const s = String(name).trim()
  if (!s) return ''
  const chars = Array.from(s)   // 서로게이트(이모지 등) 안전 분해
  const n = chars.length
  if (n === 1) return chars[0]                 // 1글자: 그대로
  if (n === 2) return chars[0] + '○'           // 2글자: 마지막 가림
  return chars[0] + '○'.repeat(n - 2) + chars[n - 1]  // 3글자+: 첫·끝만 남김
}
