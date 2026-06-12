// ============================================
// 에러 로깅 헬퍼 (클라이언트용) — step155
// ============================================
// logError({ page, errorType, message, context }) 하나로 통일.
//
// 설계 원칙 (반드시 지킬 것):
//  1) 로거 자신은 절대 throw하지 않는다. 실패해도 console.warn까지만.
//  2) 무한 루프 방지: 로거 내부 에러는 로깅하지 않음. 같은 message는 60초 내 1회만 전송.
//  3) 개인정보 금지: 학생 글 본문/토큰/API키/비밀번호를 넣지 말 것. message는 500자로 자름.
//  4) 자동 수집: 세션에서 role/user_id/class_id를 가져와 자동 첨부 (비로그인이면 unknown/null).
// ============================================
import { supabase } from './supabase'

const DEDUPE_WINDOW_MS = 60 * 1000
const recentMessages = new Map() // message → 마지막 전송 시각(ms)

// 프로필(role/class_id) 캐시 — 매 에러마다 DB 조회하지 않도록 user_id별 1회 캐시
let cachedProfile = null // { userId, role, classId }

function isDuplicate(message) {
  const now = Date.now()
  const last = recentMessages.get(message)
  if (last && now - last < DEDUPE_WINDOW_MS) return true
  recentMessages.set(message, now)
  // 맵이 과도하게 커지지 않게 오래된 항목 정리
  if (recentMessages.size > 200) {
    for (const [k, t] of recentMessages) {
      if (now - t > DEDUPE_WINDOW_MS) recentMessages.delete(k)
    }
  }
  return false
}

async function resolveIdentity() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id || null
    if (!userId) return { role: 'unknown', userId: null, classId: null }
    if (cachedProfile && cachedProfile.userId === userId) {
      return { role: cachedProfile.role, userId, classId: cachedProfile.classId }
    }
    const { data: profile } = await supabase.from('profiles')
      .select('role, class_id').eq('id', userId).maybeSingle()
    const role = profile?.role || 'unknown'
    const classId = profile?.class_id || null
    cachedProfile = { userId, role, classId }
    return { role, userId, classId }
  } catch (e) {
    return { role: 'unknown', userId: null, classId: null }
  }
}

export async function logError({ page, errorType, message, context } = {}) {
  try {
    let msg = (message == null ? '' : String(message)).slice(0, 500)
    if (!msg) return
    if (isDuplicate(msg)) return

    const { role, userId, classId } = await resolveIdentity()

    const row = {
      role,
      user_id: userId,
      class_id: classId,
      page: page ? String(page).slice(0, 200) : null,
      error_type: errorType || 'js_error',
      message: msg,
      context: context && typeof context === 'object' ? context : null,
      user_agent: (typeof navigator !== 'undefined' && navigator.userAgent)
        ? navigator.userAgent.slice(0, 300) : null,
    }

    // 비로그인(anon)은 RLS로 INSERT가 막히지만, 실패해도 조용히 무시되므로 안전
    await supabase.from('error_logs').insert(row)
  } catch (e) {
    // 로깅 실패가 앱을 깨뜨리면 본말전도 — 절대 throw하지 않음
    try { console.warn('logError 실패(무시):', e?.message || e) } catch (_) {}
  }
}
