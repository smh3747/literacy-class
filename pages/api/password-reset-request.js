// 비밀번호 초기화 요청 API (step156)
// 익명 직접 INSERT를 막고 이 서버 라우트가 service_role로만 INSERT한다.
// 스팸 방어: ip_hash 기준 24시간 내 3건 초과 거부 + 전체 24시간 50건 초과 시 일시 차단.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const IP_HASH_PREFIX = 'literacy-class:pwreset:' // 고정 prefix (별도 salt 환경변수 불필요)
const PER_IP_LIMIT = 3       // 같은 ip_hash 24시간 허용 건수 (초과 시 거부)
const GLOBAL_LIMIT = 50      // 전체 24시간 신규 건수 상한 (초과 시 일시 차단)
const WINDOW_MS = 24 * 60 * 60 * 1000

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for']
  if (xff) return String(xff).split(',')[0].trim()
  return req.socket?.remoteAddress || 'unknown'
}

function hashIp(ip) {
  return crypto.createHash('sha256').update(IP_HASH_PREFIX + ip).digest('hex')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { username, realname, school, contact } = req.body || {}
  if (!username || !username.trim() || !realname || !realname.trim()) {
    return res.status(400).json({ error: '아이디와 이름은 꼭 입력해주세요' })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const ipHash = hashIp(getClientIp(req))
  const cutoff = new Date(Date.now() - WINDOW_MS).toISOString()
  const tooMany = '요청이 너무 많아요. 내일 다시 시도하거나 선생님께 직접 말씀드려주세요.'

  try {
    // 1) 같은 ip_hash 24시간 내 건수
    const { count: ipCount } = await supabase.from('password_reset_requests')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gt('created_at', cutoff)
    if ((ipCount || 0) >= PER_IP_LIMIT) {
      return res.status(429).json({ error: tooMany })
    }

    // 2) 전체 24시간 신규 건수 (글로벌 캡)
    const { count: globalCount } = await supabase.from('password_reset_requests')
      .select('id', { count: 'exact', head: true })
      .gt('created_at', cutoff)
    if ((globalCount || 0) >= GLOBAL_LIMIT) {
      return res.status(429).json({ error: tooMany })
    }

    // 3) INSERT (service_role — RLS 우회)
    const { error } = await supabase.from('password_reset_requests').insert({
      username: String(username).trim().toLowerCase(),
      realname: String(realname).trim(),
      school: school ? String(school).trim() : null,
      contact: contact ? String(contact).trim() : null,
      ip_hash: ipHash,
    })
    if (error) throw error

    return res.status(200).json({ success: true })
  } catch (e) {
    console.error('password-reset-request error:', e?.message || e)
    return res.status(500).json({ error: '요청 처리 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
  }
}
