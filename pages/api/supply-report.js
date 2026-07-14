// 전국 공통 주제 소개 글 신고 (step487)
// 원터치 신고 → 즉시 비공개(hidden=true) + 신고자 기록. 복구·판정은 관리자 화면에서.
// supply_showcase는 RLS 전면 차단(서버 전용)이라 이 API가 유일한 신고 경로.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { accessToken, showcaseId } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (!showcaseId) return res.status(400).json({ error: 'showcaseId가 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }
  const uid = userData.user.id

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  const { data: profile } = await admin.from('profiles')
    .select('role').eq('id', uid).maybeSingle()
  if (!profile || (profile.role !== 'student' && profile.role !== 'teacher')) {
    return res.status(403).json({ error: '학생·교사만 신고할 수 있어요' })
  }

  const { error } = await admin.from('supply_showcase')
    .update({ hidden: true, reported_by: uid })
    .eq('id', showcaseId)
  if (error) {
    console.error('supply-report 실패:', error.message)
    return res.status(500).json({ error: '신고 처리에 실패했어요' })
  }
  return res.status(200).json({ ok: true })
}
