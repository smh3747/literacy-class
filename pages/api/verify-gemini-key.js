// Gemini API 키 실호출 검증 (step157)
// 교사/admin이 키를 등록하기 "전"에 실제 작동하는지 초소형 호출 1회로 확인한다.
//
// ⚠️ 이 라우트는 클라이언트가 apiKey를 body로 보내는 유일한 예외다.
//    (아직 class_secrets에 저장 전이라 서버가 조회할 수 없음.)
//    → 키를 절대 로그에 남기지 말 것. 검증 후 서버에 보관하지 않음.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js'
import { callGemini, getFriendlyErrorMessage } from '../../lib/gemini'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, reason: 'Method not allowed' })

  const { accessToken, apiKey } = req.body || {}
  if (!accessToken) return res.status(401).json({ ok: false, reason: '로그인이 필요해요' })
  if (!apiKey || !String(apiKey).trim()) return res.status(400).json({ ok: false, reason: 'API 키가 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, reason: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  // 요청자 인증 (교사/admin만 — 아무나 키 검증 오라클로 못 쓰게)
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ ok: false, reason: '인증 정보가 유효하지 않아요. 다시 로그인해주세요.' })
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: profile } = await supabaseAdmin.from('profiles')
    .select('role').eq('id', userData.user.id).maybeSingle()
  if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
    return res.status(403).json({ ok: false, reason: '선생님 권한이 필요해요' })
  }

  // 초소형 테스트 호출 1회 (가장 가벼운 flash-lite, 토큰 최소)
  try {
    await callGemini(String(apiKey).trim(), '안녕', {
      model: 'gemini-3.1-flash-lite', // flash-lite(경량) + 가장 큰 일일 한도 → 한도성 오판 최소화
      maxTokens: 5,
      temperature: 0,
      maxRetries: 2,
    })
    return res.status(200).json({ ok: true })
  } catch (e) {
    // 원인별 친화 메시지로 변환 (키 자체는 절대 로그에 남기지 않음)
    console.error('verify-gemini-key 실패:', e?.message || e)
    return res.status(200).json({ ok: false, reason: getFriendlyErrorMessage(e) })
  }
}
