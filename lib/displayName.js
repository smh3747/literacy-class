// 학생 표시 이름 헬퍼
// realname이 있으면 실명, 없으면 닉네임, 둘 다 없으면 '학생'
// (저장 로직과 무관 — 표시 전용. 동의 모델 도입 시 realname 빈값 학생은 닉네임으로 보이게 됨)
export function displayStudentName(s) {
  if (!s) return '학생'
  return (s.realname && s.realname.trim()) || s.nickname || '학생'
}
