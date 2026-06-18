// 학생 표시 이름 헬퍼
// realname 있으면 실명 → 없으면 닉네임 → 둘 다 없으면 seed로 만든 고정 닉네임
// (저장 로직과 무관 — 표시 전용)
import { nicknameFromSeed } from './nickname'

export function displayStudentName(s) {
  if (!s) return '학생'
  const real = s.realname && s.realname.trim()
  if (real) return real
  if (s.nickname && s.nickname.trim()) return s.nickname
  return nicknameFromSeed(s.username || s.id)
}
