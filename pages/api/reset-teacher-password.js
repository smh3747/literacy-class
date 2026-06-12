// 선생님 비밀번호 초기화 API
// 호출 권한: admin만 (선생님이 비번을 잊었을 때 관리자가 초기화)
//
// 가짜 이메일 도메인(@writing.class)이라 이메일 재설정이 불가능하므로
// 관리자가 직접 새 비밀번호를 설정해서 전달하는 흐름.
//
// 환경변수 필요:
// - NEXT_PUBLIC_SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY  ← 서버 전용 (절대 클라이언트 노출 금지)

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { teacherId, newPassword, accessToken } = req.body || {}

  if (!teacherId) return res.status(400).json({ error: '선생님 ID가 필요해요' })
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: '비밀번호는 6자 이상이어야 해요' })
  }
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({
      error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY가 없어요.'
    })
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 요청자 인증
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }

  // 요청자가 admin인지
  const { data: requesterProfile } = await supabaseAdmin.from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (!requesterProfile || requesterProfile.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 선생님 비밀번호를 초기화할 수 있어요' })
  }

  // 대상이 선생님(또는 admin)인지
  const { data: targetProfile } = await supabaseAdmin.from('profiles')
    .select('role, username, realname, deleted_at')
    .eq('id', teacherId)
    .maybeSingle()

  if (!targetProfile) {
    return res.status(404).json({ error: '대상을 찾을 수 없어요' })
  }
  if (targetProfile.role === 'student') {
    return res.status(403).json({ error: '학생은 학생 관리에서 초기화해주세요' })
  }
  if (targetProfile.deleted_at) {
    return res.status(403).json({ error: '휴지통에 있는 계정이에요. 먼저 복원해주세요.' })
  }

  // 비밀번호 변경
  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(teacherId, {
    password: newPassword
  })

  if (updErr) {
    console.error('Teacher password update error:', updErr)
    return res.status(500).json({ error: '비밀번호 변경 실패: ' + updErr.message })
  }

  // step161: 초기화된 계정은 로그인 후 비번 변경을 강제 유도 (방치 방지)
  try {
    await supabaseAdmin.from('profiles')
      .update({ must_change_password: true })
      .eq('id', teacherId)
  } catch (e) {
    console.warn('must_change_password 설정 실패(무시):', e?.message || e)
  }

  return res.status(200).json({
    success: true,
    teacher: { username: targetProfile.username, realname: targetProfile.realname }
  })
}
