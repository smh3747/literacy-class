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
import { logError } from './errorLog'

export async function callAI(type, payload, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const accessToken = session?.access_token
  if (!accessToken) {
    throw new Error('로그인이 필요해요. 페이지를 새로고침 해주세요.')
  }

  // AI 호출 실패는 여기 한 군데서만 기록 (호출처마다 중복 기록 방지). 원본 메시지 사용.
  const fail = (rawMessage) => {
    logError({ page: 'api/ai', errorType: 'ai_call', message: rawMessage, context: { aiType: type } })
  }

  // 요청 1회 수행 — fetch·파싱 실패는 여기서 기존 문구 그대로 throw
  const requestOnce = async (token) => {
    let res
    try {
      res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, accessToken: token, classId: opts.classId, payload }),
      })
    } catch (e) {
      fail('fetch 실패: ' + (e?.message || e))
      throw new Error('인터넷 연결을 확인해주세요. 잠시 후 다시 시도해주세요.')
    }
    let data
    try {
      data = await res.json()
    } catch (e) {
      fail('응답 파싱 실패 (status ' + res.status + ')')
      throw new Error('서버 응답을 읽지 못했어요. 잠시 후 다시 시도해주세요.')
    }
    return { res, data }
  }

  let { res, data } = await requestOnce(accessToken)

  // 🆕 step573: 401 자동 복구 — 크롬북 절전 복귀·자연 만료·시계 오차로 서버가 토큰을 거절한 경우,
  //   세션을 갱신해 동일 요청을 정확히 1회만 재시도(인라인 — 무한 재시도 불가). 복구 성공이면
  //   error_logs에도 안 남김(사용자 입장 성공). 재시도도 401이면 아래 기존 에러 경로 그대로.
  if (res.status === 401) {
    let newToken = null
    try {
      const { data: refreshed } = await supabase.auth.refreshSession()
      newToken = refreshed?.session?.access_token || null
    } catch (e) { /* refresh 실패 — 아래 기존 401 에러 경로로 */ }
    if (newToken) {
      ({ res, data } = await requestOnce(newToken))
    }
  }

  if (!res.ok) {
    fail(data?.error || ('AI 오류 status ' + res.status))
    throw new Error(data?.error || 'AI 처리 중 오류가 발생했어요')
  }
  // 채점·주제 등은 result, 챗봇은 answer 반환
  return data.result !== undefined ? data.result : data.answer
}
