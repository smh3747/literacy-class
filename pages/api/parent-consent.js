// 부모 동의 제출 API (비로그인 — C방식: 학급코드 + 자녀번호 + 학급 동의비밀번호 + 부모 서명)
//
// 비로그인 부모는 세션이 없으므로 토큰 대신 (학급코드 + 자녀번호 + 동의비밀번호)로 인가하고,
// service_role 로 RLS 를 우회해 처리한다. 흐름:
//   1) rate-limit(IP) → 2) 입력 검증 → 3) classes(code)로 consent_password 검증
//   4) profiles(class_id+number+role)로 자녀 1명 특정
//   5) pending_names.enc_name → decryptName → profiles.realname/consent 기록 (잠금 해제)
//   6) consents insert → 7) pending_names 삭제
// ⚠️ 응답에 실명 등 PII 를 절대 넣지 않는다. 복호화 키(NAME_ENCRYPTION_KEY)는 서버 전용.
//
// 사전 조건(SQL 적용): step187(pending_names), step193(consents + classes.consent_password),
//                      step165(api_rate_limit). NAME_ENCRYPTION_KEY 환경변수.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NAME_ENCRYPTION_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { decryptName } from '../../lib/encryptName'

// ── step165 호출 제한 (find-teacher-id 패턴 인라인) — 무차별 시도 방지 ──
const RL_BUCKET = 'parent_consent'
const RL_IP_PREFIX = 'literacy-class:consent:'   // 라우트별 고유 prefix
const RL_SHORT_LIMIT = 10                          // 10분 내 허용 횟수(빡세게)
const RL_SHORT_WINDOW_MS = 10 * 60 * 1000
const RL_DAY_LIMIT = 40                            // 24시간 내 허용 횟수
const RL_DAY_WINDOW_MS = 24 * 60 * 60 * 1000

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
    console.error('parent-consent rate limit check failed (fail-open):', e?.message || e)
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { classCode, studentNumber, consentPassword, parentName, signature, consentItems } = req.body || {}

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락' })
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 1) rate-limit
  const ipHash = hashIp(getClientIp(req))
  if (await isRateLimited(supabaseAdmin, ipHash)) {
    return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' })
  }

  // 2) 입력 검증
  if (!classCode || !String(classCode).trim()) return res.status(400).json({ error: '학급 코드가 필요해요' })
  if (!studentNumber || !String(studentNumber).trim()) return res.status(400).json({ error: '자녀의 번호를 입력해주세요' })
  if (!consentPassword || !String(consentPassword).trim()) return res.status(400).json({ error: '동의 비밀번호를 입력해주세요' })
  if (!parentName || !String(parentName).trim()) return res.status(400).json({ error: '보호자 성함을 입력해주세요' })
  if (!signature || !String(signature).trim()) return res.status(400).json({ error: '서명을 작성해주세요' })

  try {
    // 3) 학급 검증
    const normalizedCode = String(classCode).trim().toUpperCase()
    const { data: cls } = await supabaseAdmin.from('classes')
      .select('id, consent_password, deleted_at')
      .eq('code', normalizedCode)
      .maybeSingle()
    if (!cls || cls.deleted_at) {
      return res.status(404).json({ error: '학급을 찾을 수 없어요. 코드를 다시 확인해주세요.' })
    }
    if (!cls.consent_password || String(consentPassword).trim() !== cls.consent_password) {
      return res.status(403).json({ error: '동의 비밀번호가 일치하지 않아요. 담임 선생님께 확인해주세요.' })
    }

    // 4) 자녀 특정 (class_id + number + role='student', 숨김 제외)
    const { data: kids } = await supabaseAdmin.from('profiles')
      .select('id')
      .eq('class_id', cls.id)
      .eq('number', String(studentNumber).trim())
      .eq('role', 'student')
      .or('is_hidden.is.null,is_hidden.eq.false')
    if (!kids || kids.length === 0) {
      return res.status(404).json({ error: '해당 번호의 학생을 찾을 수 없어요. 번호를 확인해주세요.' })
    }
    if (kids.length > 1) {
      return res.status(409).json({ error: '같은 번호의 학생이 둘 이상이에요. 담임 선생님께 문의해주세요.' })
    }
    const studentId = kids[0].id

    // 5) 멱등 가드: pending_names 행 존재 여부로 "이미 동의됨" 판단
    const { data: pn } = await supabaseAdmin.from('pending_names')
      .select('enc_name')
      .eq('student_id', studentId)
      .maybeSingle()

    const consentRow = {
      student_id: studentId,
      class_id: cls.id,
      parent_name: String(parentName).trim().slice(0, 100),
      signature: String(signature),
      consent_items: Array.isArray(consentItems) ? consentItems : (consentItems || null),
      consented_at: new Date().toISOString(),
    }

    if (!pn) {
      // 이미 동의됨(잠금 해제 완료 상태) → 잠금해제는 건너뛰고 동의 기록만 추가
      const { error: cErr } = await supabaseAdmin.from('consents').insert(consentRow)
      if (cErr) {
        console.error('parent-consent consents insert(이미동의) 실패:', cErr.message)
        return res.status(500).json({ error: '동의 기록 저장에 실패했어요. 잠시 후 다시 시도해주세요.' })
      }
      return res.status(200).json({ ok: true, alreadyConsented: true })
    }

    // 6) 잠금 해제 — enc_name 복호화
    const realname = pn.enc_name ? decryptName(pn.enc_name) : null
    if (!realname) {
      // 키 미설정/복호화 실패 — 실명을 못 채우므로 동의 기록도 남기지 않고 중단(담임 안내)
      console.error('parent-consent decrypt 실패:', studentId)
      return res.status(500).json({ error: '잠금 해제에 실패했어요. 담임 선생님께 문의해주세요.' })
    }

    // 7) profiles에 실명·동의 기록 (잠금 해제)
    const { error: upErr } = await supabaseAdmin.from('profiles').update({
      realname,
      consent_received: true,
      consent_received_at: new Date().toISOString(),
    }).eq('id', studentId)
    if (upErr) {
      console.error('parent-consent profiles update 실패:', upErr.message)
      return res.status(500).json({ error: '처리 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
    }

    // 8) 동의 기록 insert
    const { error: cErr } = await supabaseAdmin.from('consents').insert(consentRow)
    if (cErr) {
      // 실명은 이미 채워졌으나 동의기록 실패 — 사용자에겐 재시도 안내(다음 시도는 멱등 가드로 처리됨)
      console.error('parent-consent consents insert 실패:', cErr.message)
      return res.status(500).json({ error: '동의 기록 저장에 실패했어요. 잠시 후 다시 시도해주세요.' })
    }

    // 9) 잠금 테이블 행 삭제 (마지막 — 중간 실패 시 재시도 여지)
    const { error: delErr } = await supabaseAdmin.from('pending_names').delete().eq('student_id', studentId)
    if (delErr) {
      // 삭제 실패는 치명적 아님(다음 호출 멱등 가드에서 또 시도). 로깅만.
      console.warn('parent-consent pending_names delete 실패(무시):', delErr.message)
    }

    return res.status(200).json({ ok: true })
  } catch (e) {
    console.error('parent-consent error:', e?.message || e)
    return res.status(500).json({ error: '처리 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
  }
}
