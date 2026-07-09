// step427: 문자열 보장 헬퍼 — corrections 등에 비문자열(객체·배열·숫자) 실데이터가 섞였을 때
// 화면이 죽지 않게 첫 번째 유효한 문자열만 채택한다(없으면 ''). step420 quiz.js 구현과 동일 로직.
// 표시 방어 전용 — 데이터 생성·저장 경로에서는 쓰지 않는다.
export function pickStr(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}
