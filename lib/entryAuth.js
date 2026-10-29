// ============================================
// 진입 인증 보조 — step637
// ============================================
// 세 홈(학생·교사·관리자)의 진입 profiles 조회가 공유하는 두 가지:
//  1) queryWithAuthRetry: 조회가 401/JWT 만료로 거절되면 refreshSession 1회 → 같은 조회 1회 재시도.
//     (step573 aiClient의 401 복구를 진입 경로에도 적용. 정확히 1회 — 무한 재시도 금지.)
//     PC 시계 오차·절전 복귀로 "로컬에선 유효, 서버에선 만료"인 토큰이 바로 로그인으로 튕기던 경로를 흡수한다.
//  2) logAuthBounce: 로그인으로 쫓아내기 직전 error_logs에 error_type 'auth_bounce'로 기록.
//     step640: 기록은 서버 API(/api/auth-bounce, 서비스롤)로 — 세션이 없거나 토큰이 거절된 진입도 남는다.
//     세션 무관이라 signOut 순서와 관계없고, 발사 후 망각(호출부를 지연시키지 않음). 절대 throw하지 않는다.
// ============================================
import { supabase } from './supabase'

const BOUNCE_DEDUPE_MS = 60 * 1000
const recentBounces = new Map()   // `${screen}|${reason}` → 마지막 전송 시각(ms). 같은 사유 60초 1회(재시도 루프 도배 방지)

// 서버가 토큰을 거절한 응답인지 (PostgREST 401 · PGRST301 'JWT expired' · PGRST303 등)
export function isAuthRejected(res) {
  if (!res) return false
  if (res.status === 401) return true
  const e = res.error
  if (!e) return false
  if (typeof e.code === 'string' && /^PGRST30[0-9]$/.test(e.code)) return true
  return /JWT|expired|invalid token|UNAUTHENTICATED/i.test(String(e.message || ''))
}

/**
 * 진입 조회 1회 + (401이면) 세션 갱신 후 1회 재시도.
 * @param {() => PromiseLike<{data, error, status}>} run - 호출할 때마다 새 쿼리 빌더를 만들어 반환(같은 빌더 재사용 금지).
 *   타임아웃 래핑(withTimeout)은 run 안에서 감싸면 시도마다 적용된다. TIMEOUT 등 throw는 그대로 밖으로 나간다.
 * @returns {Promise<{data, error, status, refreshed: boolean, retried: boolean}>}
 */
export async function queryWithAuthRetry(run) {
  let res = await run()
  if (!isAuthRejected(res)) return { ...res, refreshed: false, retried: false }
  let refreshed = false
  try {
    const { data: r, error: rErr } = await supabase.auth.refreshSession()
    refreshed = !rErr && !!r?.session?.access_token
  } catch (_) { refreshed = false }
  if (!refreshed) return { ...res, refreshed: false, retried: false }
  res = await run()
  return { ...res, refreshed: true, retried: true }
}

// 로컬 세션이 보기에 토큰이 몇 초 남았는지(음수면 로컬도 만료로 봄). 시계 오차 추정용 — 네트워크 왕복 없음.
async function localExpiresIn() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.expires_at) return null
    return Math.round(session.expires_at - Date.now() / 1000)
  } catch (_) { return null }
}

/**
 * 진입 튕김 기록 — /api/auth-bounce(서비스롤)로 전송. 보내는 것: 사유·화면·상태코드·에러 코드/문구(200자)·
 *   refresh 여부·로컬 만료 잔여초·(role 불일치 때) 실제 role. user_agent는 서버가 요청 헤더에서 읽는다. PII 없음.
 *   await해도 fetch를 기다리지 않고 즉시 돌아온다(발사 후 망각, keepalive). 엿보기(?as=)면 기록하지 않는다.
 * @param {{ screen: string, reason: string, res?: {error, status, refreshed, retried}, extra?: { role?: string } }} p
 *   reason: 'no_session' | 'profile_null' | 'query_error' | 'role_mismatch'
 */
export async function logAuthBounce({ screen, reason, res, extra } = {}) {
  try {
    if (typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).has('as')) return   // 엿보기 중엔 기록하지 않음(step633 관행)
    const key = `${screen || ''}|${reason || ''}`
    const now = Date.now()
    const last = recentBounces.get(key)
    if (last && now - last < BOUNCE_DEDUPE_MS) return
    recentBounces.set(key, now)

    const err = res?.error || null
    const body = {
      reason: reason || 'unknown',
      screen: screen || null,
      status: res?.status ?? null,
      code: err?.code ? String(err.code).slice(0, 40) : null,
      error: err?.message ? String(err.message).slice(0, 200) : null,
      refreshed: !!res?.refreshed,
      retried: !!res?.retried,
      localExpiresIn: await localExpiresIn(),
      role: extra && typeof extra.role === 'string' ? extra.role : null,
    }
    fetch('/api/auth-bounce', {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})
  } catch (_) { /* 로거는 절대 throw하지 않는다 */ }
}
