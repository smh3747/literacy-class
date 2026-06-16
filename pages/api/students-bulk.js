// 학생 일괄 등록 API (엑셀 업로드)
// 호출 권한: 해당 학급 담임 교사 또는 admin만
//
// 환경변수 필요:
// - NEXT_PUBLIC_SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY  ← 서버 전용 (절대 클라이언트 노출 금지)

import { createClient } from '@supabase/supabase-js'
import { generateUniqueNickname } from '../../lib/nickname'
import { maskName } from '../../lib/maskName'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { students, classId, accessToken } = req.body || {}
  if (!Array.isArray(students) || !classId) return res.status(400).json({ error: '잘못된 요청' })
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

  // 요청자 권한 확인: 해당 학급 담임 교사 또는 admin
  const { data: requesterProfile } = await supabaseAdmin.from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .maybeSingle()

  if (!requesterProfile || (requesterProfile.role !== 'teacher' && requesterProfile.role !== 'admin')) {
    return res.status(403).json({ error: '선생님 권한이 필요해요' })
  }

  if (requesterProfile.role !== 'admin') {
    const { data: targetClass } = await supabaseAdmin.from('classes')
      .select('teacher_id')
      .eq('id', classId)
      .maybeSingle()
    if (!targetClass || targetClass.teacher_id !== userData.user.id) {
      return res.status(403).json({ error: '본인 학급에만 학생을 등록할 수 있어요' })
    }
  }

  // 학급 내 기존 닉네임 한 번에 조회 (중복 방지)
  let usedNicknames = []
  try {
    const { data: existing } = await supabaseAdmin.from('profiles')
      .select('nickname').eq('class_id', classId).eq('role', 'student')
    usedNicknames = (existing || []).map(p => p.nickname).filter(Boolean)
  } catch(e) { /* nickname 컬럼 없으면 무시 */ }

  const results = { success: [], failed: [] }

  for (const s of students) {
    try {
      if (!s.username || !s.realname) {
        results.failed.push({ ...s, error: '아이디/이름 누락' })
        continue
      }

      // step160: 서버 측 아이디 형식 검증 (소문자화 + 허용문자 + 길이)
      // 학생 로그인은 username@writing.class 합성 이메일 → 이메일 안전 문자만 허용
      const uname = String(s.username).trim().toLowerCase()
      if (!/^[a-z0-9_-]{4,20}$/.test(uname)) {
        results.failed.push({ ...s, error: '아이디 형식 오류 (영문 소문자·숫자 4~20자)' })
        continue
      }

      const email = `${uname}@writing.class`
      const password = '123456' // 초기 비밀번호 (Supabase 정책: 최소 6자)

      // 계정 생성 (service_role — RLS·이메일 확인 영향 없음)
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })
      if (error) {
        if (error.message.includes('already')) {
          results.failed.push({ ...s, error: '이미 가입된 아이디' })
        } else {
          results.failed.push({ ...s, error: error.message })
        }
        continue
      }

      // 새 닉네임 생성 (이번 배치에서 중복 안 되게)
      let nickname = null
      try {
        nickname = generateUniqueNickname(usedNicknames)
        usedNicknames.push(nickname) // 다음 학생 위해 추가
      } catch(e) {}

      // profile 추가
      const profileData = {
        id: data.user.id,
        username: uname,
        // 개인정보 최소화(1단계): 신규 학생은 마스킹된 이름으로 저장 (김민수 → 김*수)
        realname: maskName(s.realname),
        role: 'student',
        class_id: classId
      }
      if (s.number !== undefined && s.number !== null && s.number !== '') {
        profileData.number = String(s.number).trim()
      }
      if (nickname) profileData.nickname = nickname

      const { error: profErr } = await supabaseAdmin.from('profiles').insert(profileData)

      if (profErr) {
        results.failed.push({ ...s, error: 'profile: ' + profErr.message })
      } else {
        results.success.push({ ...s, nickname })
      }
    } catch(e) {
      results.failed.push({ ...s, error: e.message })
    }
  }

  return res.status(200).json(results)
}
