// ============================================
// 학급 코드 조회 API (step149 RLS 동반)
// ============================================
// classes의 익명 SELECT가 RLS로 막히면서, 비로그인 경로 2가지를 대체:
//   1. { code }      → 학생 가입·QR 힌트용 학급 정보 (안전 컬럼만!)
//   2. { checkCode } → 학급 코드 중복확인 (존재 여부만)
//
// ⚠️ teacher_id, api_key 등 민감 컬럼은 절대 반환하지 말 것.
//    4자리 코드는 원래 공개 전제(학생에게 배포)라 이 라우트가 노출하는
//    정보는 기존 익명 SELECT보다 항상 적다.

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { code, checkCode } = req.body || {}

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락' })
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 모드 2: 코드 중복확인 (존재 여부만 — 교사 학급코드 발급/재발급용)
  if (checkCode) {
    const normalized = String(checkCode).trim().toUpperCase()
    const { data } = await supabaseAdmin.from('classes')
      .select('id').eq('code', normalized).limit(1).maybeSingle()
    return res.status(200).json({ exists: !!data })
  }

  // 모드 1: 학급 정보 조회 (학생 가입 + QR/로그인 힌트)
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ error: '학급 코드가 필요해요' })
  }
  const normalized = code.trim().toUpperCase()
  const { data, error } = await supabaseAdmin.from('classes')
    .select('id, name, school, is_active, deleted_at, login_hint_enabled, login_username_prefix, login_default_password, self_signup_enabled')
    .eq('code', normalized)
    .maybeSingle()

  if (error) {
    console.error('class-lookup error:', error.message)
    return res.status(500).json({ error: '학급 조회 중 오류가 발생했어요' })
  }
  if (!data) return res.status(200).json({ found: false, class: null })

  return res.status(200).json({ found: true, class: data })
}
