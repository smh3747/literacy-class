// 📝 AI 피드백 텍스트를 보기 좋게 항목으로 분리
// - "- " 시작 항목 우선
// - 못 찾으면 "키워드: 내용" 패턴
// - 못 찾으면 문장 단위로 분리 (2개 이상이면)

/**
 * 피드백 텍스트를 항목 배열로 분리
 * @param {string} text - AI가 준 피드백 텍스트
 * @returns {string[]} 항목 배열 (1개 이상)
 */
export function splitFeedbackItems(text) {
  if (!text || typeof text !== 'string') return []
  const cleaned = text.trim()
  if (!cleaned) return []

  // 패턴 1: "- " 또는 "* " 시작 항목 (가장 명확)
  const dashMatches = cleaned.match(/(?:^|\n)\s*[-*•]\s+([^\n]+)/g)
  if (dashMatches && dashMatches.length >= 2) {
    return dashMatches
      .map(m => m.replace(/^[\n\s]*[-*•]\s+/, '').trim())
      .filter(s => s.length > 0)
  }

  // 패턴 2: "1. ", "2. " 같은 번호 시작
  const numberMatches = cleaned.match(/(?:^|\n)\s*\d+\.\s+([^\n]+)/g)
  if (numberMatches && numberMatches.length >= 2) {
    return numberMatches
      .map(m => m.replace(/^[\n\s]*\d+\.\s+/, '').trim())
      .filter(s => s.length > 0)
  }

  // 패턴 3: "키워드: 내용" 형태가 두 개 이상 (예: "솔직한 표현: ... 참신한 관점: ...")
  // 한글 단어 + 콜론(:) + 내용 패턴
  const colonMatches = cleaned.match(/([가-힣A-Za-z0-9 ]{2,15}):\s*([^:]+?)(?=\s+[가-힣A-Za-z0-9 ]{2,15}:|$)/g)
  if (colonMatches && colonMatches.length >= 2) {
    return colonMatches
      .map(s => s.trim().replace(/[,.]$/, '').trim())
      .filter(s => s.length > 0)
  }

  // 패턴 4: 줄바꿈으로 분리
  if (cleaned.includes('\n')) {
    const lines = cleaned.split('\n').map(s => s.trim()).filter(s => s.length > 0)
    if (lines.length >= 2) return lines
  }

  // 분리 못 함 → 전체를 한 항목으로
  return [cleaned]
}
