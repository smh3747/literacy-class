// 학생 아이디(username) 변경 API
// - profiles.username + auth.email 둘 다 변경 (가짜 이메일 username@literacy.local)
// 호출 권한: 같은 학급 담임 교사 또는 admin만

import { createClient } from '@supabase/supabase-js'

const EMAIL_DOMAIN = '@literacy.local' // student/login.js와 동일하게 유지

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { studentId, newUsername, accessToken } = req.body || {}

  if (!studentId) return res.status(400).json({ error: '학생 ID가 필요해요' })
  if (!newUsername || !/^[a-z0-9_]{3,20}$/.test(newUsername)) {
    return res.status(400).json({ error: '아이디는 영문 소문자/숫자/_만, 3~20자' })
  }
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({
      error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락'
    })
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  // 요청자 인증
  const supabaseAnon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const { data: userData, error: userErr } = await supabaseAnon.auth.getUser(accessToken)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  }

  const requesterId = userData.user.id

  const { data: requesterProfile } = await supabaseAdmin.from('profiles')
    .select('role, class_id')
    .eq('id', requesterId)
    .maybeSingle()

  if (!requesterProfile || (requesterProfile.role !== 'teacher' && requesterProfile.role !== 'admin')) {
    return res.status(403).json({ error: '선생님 권한이 필요해요' })
  }

  const { data: targetProfile } = await supabaseAdmin.from('profiles')
    .select('role, class_id, username, realname')
    .eq('id', studentId)
    .maybeSingle()

  if (!targetProfile) {
    return res.status(404).json({ error: '학생을 찾을 수 없어요' })
  }

  if (requesterProfile.role !== 'admin') {
    if (targetProfile.class_id !== requesterProfile.class_id) {
      return res.status(403).json({ error: '같은 학급 학생만 변경할 수 있어요' })
    }
  }

  if (targetProfile.role !== 'student') {
    return res.status(403).json({ error: '학생 계정만 변경할 수 있어요' })
  }

  // 중복 검사
  const { data: existing } = await supabaseAdmin.from('profiles')
    .select('id').eq('username', newUsername).maybeSingle()
  if (existing && existing.id !== studentId) {
    return res.status(409).json({ error: '이미 사용 중인 아이디예요' })
  }

  const newEmail = `${newUsername}${EMAIL_DOMAIN}`

  // 1) auth.email 변경
  const { error: emailErr } = await supabaseAdmin.auth.admin.updateUserById(studentId, {
    email: newEmail,
    email_confirm: true  // 이메일 확인 메일 안 보내고 즉시 확인 처리
  })
  if (emailErr) {
    return res.status(500).json({ error: '이메일 변경 실패: ' + emailErr.message })
  }

  // 2) profiles.username 변경
  const { error: profileErr } = await supabaseAdmin.from('profiles')
    .update({ username: newUsername })
    .eq('id', studentId)

  if (profileErr) {
    // 롤백 (가능하면)
    await supabaseAdmin.auth.admin.updateUserById(studentId, {
      email: `${targetProfile.username}${EMAIL_DOMAIN}`,
      email_confirm: true
    })
    return res.status(500).json({ error: 'profile 변경 실패: ' + profileErr.message })
  }

  return res.status(200).json({
    success: true,
    student: { oldUsername: targetProfile.username, newUsername, realname: targetProfile.realname }
  })
}
