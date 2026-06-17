// 피드백 답변 읽음 처리 (step205-C)
// feedback UPDATE 정책은 admin-only(fb_update)라 작성자가 직접 못 씀.
// → 이 서비스롤 라우트가 "본인(user_id=auth.uid())의 답변 달린 미열람 의견"만 reply_read_at 갱신한다.
//   ★ user_id 가드로 다른 사람 행은 절대 못 건드림. reply_text/reply_by 등 답변 내용은 변경하지 않음.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { accessToken } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  // 토큰 검증 → 본인 user_id 확보
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }
  const uid = userData.user.id

  // service_role로 본인 행만 읽음 처리 (★ user_id 가드 — 다른 행 불가)
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { error } = await supabaseAdmin.from('feedback')
    .update({ reply_read_at: new Date().toISOString() })
    .eq('user_id', uid)
    .not('reply_text', 'is', null)
    .is('reply_read_at', null)
  if (error) {
    console.error('feedback-mark-read error:', error.message)
    return res.status(500).json({ error: '읽음 처리 중 오류가 생겼어요.' })
  }
  return res.status(200).json({ ok: true })
}
