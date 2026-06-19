// 부모 동의 1단계 — 자녀 본인 확인 (읽기 전용, 비로그인)
//
// 마법사형 부모 동의 1페이지에서 호출. (학급코드 + 자녀번호 + 동의비밀번호)로 자녀를
// 특정해 "곽○윤 학생 맞나요?" 확인용 마스킹 이름만 돌려준다.
// ⚠️ DB 에 아무것도 쓰지 않는다(rate-limit 시도 기록만 예외). 평문 실명·studentId·enc_name
//    은 절대 응답에 넣지 않는다. 실제 잠금 해제(실명 기록)는 2페이지 최종 제출
//    /api/parent-consent 에서만 일어난다.
//
// 동의비번 폴백은 parent-consent.js 와 같은 헬퍼(effectiveConsentPassword)를 쓴다.
// rate-limit 은 최종 제출(parent_consent)과 별도 버킷(parent_consent_verify)으로 분리해
// 확인 호출이 제출 한도를 잠식하지 않게 한다.
//
// 사전 조건(SQL 적용): step187(pending_names), step193(consents + classes.consent_password),
//                      step165(api_rate_limit). NAME_ENCRYPTION_KEY 환경변수.
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NAME_ENCRYPTION_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { decryptName } from '../../lib/encryptName'
import { maskKoreanName } from '../../lib/maskName'
import { effectiveConsentPassword } from '../../lib/consentPassword'

// ── 호출 제한 (parent-consent 패턴 동일, 버킷만 분리) ──
const RL_BUCKET = 'parent_consent_verify'
const RL_IP_PREFIX = 'literacy-class:consent-verify:'   // 라우트별 고유 prefix
const RL_SHORT_LIMIT = 20                                 // 10분 내 허용(확인은 제출보다 자주)
const RL_SHORT_WINDOW_MS = 10 * 60 * 1000
const RL_DAY_LIMIT = 80                                   // 24시간 내 허용
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
    console.error('consent-verify rate limit check failed (fail-open):', e?.message || e)
    return false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { classCode, studentNumber, consentPassword } = req.body || {}

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락' })
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 1) rate-limit (제출과 별도 버킷)
  const ipHash = hashIp(getClientIp(req))
  if (await isRateLimited(supabaseAdmin, ipHash)) {
    return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' })
  }

  // 2) 입력 검증
  if (!classCode || !String(classCode).trim()) return res.status(400).json({ error: '학급 코드가 필요해요' })
  if (!studentNumber || !String(studentNumber).trim()) return res.status(400).json({ error: '자녀의 번호를 입력해주세요' })
  if (!consentPassword || !String(consentPassword).trim()) return res.status(400).json({ error: '동의 비밀번호를 입력해주세요' })

  try {
    // 3) 학급 검증 + 동의비번 폴백(parent-consent 와 동일 헬퍼)
    const normalizedCode = String(classCode).trim().toUpperCase()
    const { data: cls } = await supabaseAdmin.from('classes')
      .select('id, code, name, grade, consent_password, deleted_at')
      .eq('code', normalizedCode)
      .maybeSingle()
    if (!cls || cls.deleted_at) {
      return res.status(404).json({ error: '학급을 찾을 수 없어요. 코드를 다시 확인해주세요.' })
    }
    const effectivePw = effectiveConsentPassword(cls, normalizedCode)
    if (!effectivePw || String(consentPassword).trim() !== effectivePw) {
      return res.status(403).json({ error: '동의 비밀번호가 일치하지 않아요. 담임 선생님께 확인해주세요.' })
    }

    // 4) 자녀 특정 (class_id + number + role='student', 숨김 제외) — parent-consent 와 동일 규칙
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

    // 5) pending_names 조회 — 행이 없으면 이미 동의 완료(잠금 해제됨). 실명 미반환.
    const { data: pn } = await supabaseAdmin.from('pending_names')
      .select('enc_name')
      .eq('student_id', studentId)
      .maybeSingle()
    if (!pn) {
      return res.status(200).json({ ok: true, alreadyConsented: true })
    }

    // 6) 복호화 → 마스킹만 추출 (평문은 서버 밖으로 나가지 않음)
    const realname = pn.enc_name ? decryptName(pn.enc_name) : null
    if (!realname) {
      console.error('consent-verify decrypt 실패:', studentId)
      return res.status(500).json({ error: '학생 정보를 확인하지 못했어요. 담임 선생님께 문의해주세요.' })
    }
    const masked = maskKoreanName(realname)

    // 7) 응답 — 마스킹 이름·학년·반·번호만. studentId/enc_name/평문 실명 절대 미포함.
    return res.status(200).json({
      ok: true,
      masked,
      grade: (cls.grade ?? null),
      className: cls.name || null,
      number: String(studentNumber).trim(),
    })
  } catch (e) {
    console.error('consent-verify error:', e?.message || e)
    return res.status(500).json({ error: '처리 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
  }
}
