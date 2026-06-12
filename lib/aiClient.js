// ============================================
// AI 서버 프록시 호출 헬퍼 (클라이언트용)
// ============================================
// 프롬프트는 서버(/api/ai)에서 구성하므로, 여기선 작업 종류와 데이터만 보냄.
// 프롬프트 본문이 브라우저 번들에 없어 F12로 노출되지 않음.
//
// 키 서버격리(step153~): 클라이언트는 API 키를 다루지 않는다.
//   로그인 세션 토큰만 보내면 서버가 학급 키를 조회해 호출한다.
//   (admin이 특정 학급으로 호출하려면 opts.classId 전달)
// ============================================
import { supabase } from './supabase'

export async function callAI(type, payload, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const accessToken = session?.access_token
  if (!accessToken) {
    throw new Error('로그인이 필요해요. 페이지를 새로고침 해주세요.')
  }

  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, accessToken, classId: opts.classId, payload }),
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
  // 채점·주제 등은 result, 챗봇은 answer 반환
  return data.result !== undefined ? data.result : data.answer
}
