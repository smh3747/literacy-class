// step441: HTML 이스케이프 공용판(&<>"' 전부) — 밑줄 data-correction 속성·본문 텍스트 공용.
// step440에서 파일별 사본의 구현 편차(따옴표 누락)로 툴팁이 잘렸던 것의 재발 방지 공용화.
export function escapeHtml(text) {
  if (!text) return ''
  return String(text).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]))
}
