// 진입 튕김 익명 기록 — step640
//
// 세 홈(학생·교사·관리자)이 로그인으로 쫓아내기 직전 부른다(lib/entryAuth.js logAuthBounce).
// step637의 클라이언트 insert 경로는 RLS(elog_insert: authenticated 전용) 때문에
//   ① 세션이 아예 없는 진입(브라우저 정책으로 저장소가 지워진 PC 등)
//   ② 서버가 토큰을 거절한 진입(시계 오차·절전 복귀, refresh까지 실패)
// 을 기록하지 못했다. 둘 다 "엣지 튕김" 규명에서 가장 알고 싶은 경우라 서비스롤로 쓴다.
//
// 원칙
//  - 토큰 불필요(익명 허용). 그래서 신원은 기록하지 않는다: role 'unknown', user_id·class_id null.
//  - PII 없음: 사유·화면·상태코드·에러 문구(200자)·refresh 여부·로컬 만료 잔여초·user_agent만.
//    user_agent는 본문이 아니라 요청 헤더에서 읽는다(위조 입력 차단). IP는 저장하지 않는다(제한용 해시만 별도 테이블).
//  - 호출 제한: step165 api_rate_limit(DB 기반, 서비스롤 전용) 패턴을 그대로 — 버킷 'auth_bounce'.
//    한 학교가 NAT 1개 IP를 쓰므로 수업 시작 동시 튕김이 잘리지 않게 분당 30건·일 300건으로 잡았다.
//  - 입력은 전부 화이트리스트·길이 제한. 저장 실패도 200 { ok:false } — 호출부가 반응할 일이 없고 절대 throw하지 않는다.
//  - message 형식은 step637과 동일('진입 튕김: …') → 관리자 분류기 '🟤 진입 튕김' 라벨이 그대로 맞는다.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const RL_BUCKET = 'auth_bounce'
const RL_IP_PREFIX = 'literacy-class:authbounce:'   // 다른 버킷과 다른 prefix(해시 교차 불가)
const RL_SHORT_LIMIT = 30                            // 1분 내 허용 횟수 / IP
const RL_SHORT_WINDOW_MS = 60 * 1000
const RL_DAY_LIMIT = 300                             // 24시간 내 허용 횟수 / IP
const RL_DAY_WINDOW_MS = 24 * 60 * 60 * 1000

const REASONS = new Set(['no_session', 'profile_null', 'query_error', 'role_mismatch'])
const SCREENS = new Set(['/student', '/teacher', '/admin'])
const ROLES = new Set(['student', 'teacher', 'admin'])

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(RL_IP_PREFIX + ip).digest('hex')
}

// true면 한도 초과(차단). 내부 오류는 fail-open(false).
async function isRateLimited(supabase, ipHash) {
  try {
    const countSince = async (windowMs) => {
      const cutoff = new Date(Date.now() - windowMs).toISOString()
      const { count } = await supabase.from('api_rate_limit')
        .select('id', { count: 'exact', head: true })
        .eq('bucket', RL_BUCKET).eq('ip_hash', ipHash).gt('created_at', cutoff)
      return count || 0
    }
    if (await countSince(RL_SHORT_WINDOW_MS) >= RL_SHORT_LIMIT) return true
    if (await countSince(RL_DAY_WINDOW_MS) >= RL_DAY_LIMIT) return true
    await supabase.from('api_rate_limit').insert({ bucket: RL_BUCKET, ip_hash: ipHash })
    return false
  } catch (e) {
    console.error('auth-bounce rate limit check failed (fail-open):', e?.message || e)
    return false
  }
}

// ── 입력 정제(화이트리스트·길이 제한). 어떤 입력이 와도 throw하지 않는다. ──
const str = (v, max) => (typeof v === 'string' && v.length > 0) ? v.slice(0, max) : null
const int = (v) => Number.isInteger(v) ? v : (typeof v === 'string' && /^-?\d+$/.test(v) ? parseInt(v, 10) : null)

export function sanitizeBounce(body) {
  const b = body && typeof body === 'object' ? body : {}
  const reason = REASONS.has(b.reason) ? b.reason : 'unknown'
  const screen = SCREENS.has(b.screen) ? b.screen : null
  const status = (() => { const n = int(b.status); return n !== null && n >= 100 && n <= 599 ? n : null })()
  const localExpiresIn = (() => { const n = int(b.localExpiresIn); return n !== null && Math.abs(n) < 10000000 ? n : null })()
  return {
    reason, screen, status,
    code: str(b.code, 40),
    error: str(b.error, 200),
    refreshed: b.refreshed === true,
    retried: b.retried === true,
    localExpiresIn,
    role: ROLES.has(b.role) ? b.role : null,
  }
}

export function bounceMessage(c) {
  return `진입 튕김: ${c.reason}${c.status ? ` (${c.status})` : ''}${c.error ? ` ${c.error}` : ''}`.slice(0, 500)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const ipHash = hashIp(getClientIp(req))
  if (await isRateLimited(supabase, ipHash)) {
    return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' })
  }

  try {
    const c = sanitizeBounce(req.body)
    const ua = req.headers['user-agent']
    const row = {
      role: 'unknown',          // 신원 미검증(익명 허용) — 화면은 page·context.screen으로 구분
      user_id: null,
      class_id: null,
      page: c.screen,
      error_type: 'auth_bounce',
      message: bounceMessage(c),
      context: { ...c, via: 'api' },
      user_agent: ua ? String(ua).slice(0, 300) : null,
    }
    const { error } = await supabase.from('error_logs').insert(row)
    if (error) {
      console.warn('auth-bounce insert 실패(무시):', error.message)
      return res.status(200).json({ ok: false })
    }
    return res.status(200).json({ ok: true })
  } catch (e) {
    console.warn('auth-bounce 처리 실패(무시):', e?.message || e)
    return res.status(200).json({ ok: false })
  }
}
