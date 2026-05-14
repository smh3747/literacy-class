// 학생 비밀번호 초기화 API
// 호출 권한: 같은 학급 담임 교사 또는 admin만
//
// 환경변수 필요:
// - NEXT_PUBLIC_SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY  ← 서버 전용 (절대 클라이언트 노출 금지)

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { studentId, newPassword, accessToken } = req.body || {}

  // 입력 검증
  if (!studentId) return res.status(400).json({ error: '학생 ID가 필요해요' })
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: '비밀번호는 4자 이상이어야 해요' })
  }
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    console.error('Missing env vars:', { hasUrl: !!supabaseUrl, hasKey: !!serviceKey })
    return res.status(500).json({
      error: '서버 설정 오류: 관리자 권한 키가 없어요.\nVercel 환경변수에 SUPABASE_SERVICE_ROLE_KEY를 추가해주세요.'
    })
  }

  // Admin 클라이언트 (Service Role)
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 요청자 인증 (anon 클라이언트로 토큰 검증)
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }

  const requesterId = userData.user.id

  // 요청자의 권한 확인 (teacher 또는 admin)
  const { data: requesterProfile } = await supabaseAdmin.from('profiles')
    .select('role, class_id')
    .eq('id', requesterId)
    .maybeSingle()

  if (!requesterProfile || (requesterProfile.role !== 'teacher' && requesterProfile.role !== 'admin')) {
    return res.status(403).json({ error: '선생님 권한이 필요해요' })
  }

  // 대상 학생 정보 확인
  const { data: targetProfile } = await supabaseAdmin.from('profiles')
    .select('role, class_id, username, realname')
    .eq('id', studentId)
    .maybeSingle()

  if (!targetProfile) {
    return res.status(404).json({ error: '학생을 찾을 수 없어요' })
  }

  // 권한 체크: 같은 학급 담임이거나 admin만 가능
  if (requesterProfile.role !== 'admin') {
    if (targetProfile.class_id !== requesterProfile.class_id) {
      return res.status(403).json({ error: '같은 학급 학생만 초기화할 수 있어요' })
    }
  }

  // 학생만 가능 (다른 교사 비번 못 바꾸게)
  if (targetProfile.role !== 'student') {
    return res.status(403).json({ error: '학생 계정만 초기화할 수 있어요' })
  }

  // 비밀번호 변경
  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(studentId, {
    password: newPassword
  })

  if (updErr) {
    console.error('Password update error:', updErr)
    return res.status(500).json({ error: '비밀번호 변경 실패: ' + updErr.message })
  }

  return res.status(200).json({
    success: true,
    student: { username: targetProfile.username, realname: targetProfile.realname }
  })
}
