// ============================================
// AI 서버 프록시 호출 헬퍼 (클라이언트용)
// ============================================
// 프롬프트는 서버(/api/ai)에서 구성하므로, 여기선 작업 종류와 데이터만 보냄.
// 프롬프트 본문이 브라우저 번들에 없어 F12로 노출되지 않음.
// ============================================

export async function callAI(type, apiKey, payload) {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, apiKey, payload }),
  })

  let data
  try {
    data = await res.json()
  } catch (e) {
    throw new Error('서버 응답을 읽지 못했어요. 잠시 후 다시 시도해주세요.')
  }

  if (!res.ok) {
    throw new Error(data?.error || 'AI 처리 중 오류가 발생했어요')
  }
  return data.result
}
