// 교사 마지막 로그인 시각 조회 API (관리자 전용, 읽기 전용)
// Supabase auth.users.last_sign_in_at(내장 자동 기록)을 service-role로 읽어온다.
// ★읽기 전용: listUsers만 사용. auth 데이터 update/delete 절대 안 함. PII(이메일 등) 미반환.
//
// 환경변수 필요:
// - NEXT_PUBLIC_SUPABASE_URL
// - NEXT_PUBLIC_SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE_KEY  ← 서버 전용 (다른 admin API가 이미 쓰는 그 키 재사용)

import { createClient } from '@supabase/supabase-js'

const LAST_LOGIN_BATCH = 25   // step679: 한 번에 동시에 조회하는 인원

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { accessToken } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY가 없어요.' })
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
    .select('role').eq('id', userData.user.id).maybeSingle()
  if (!requesterProfile || requesterProfile.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 조회할 수 있어요' })
  }

  // step679: 교사·관리자만 읽는다. 종전에는 인증 사용자 전원(학생 포함 4,300여 명)을 1000명씩 차례로 읽어
  //   서버가 약 2.4MB를 받고 전원의 시각(117kB)을 돌려줬다. 화면은 교사 행만 쓴다.
  //   교사·관리자 id를 profiles에서 받고, 그 id만 한 명씩 묶음(LAST_LOGIN_BATCH명 동시)으로 조회한다. 한 명이 실패해도 나머지는 돌려준다.
  const lastLogins = {}  // { userId: last_sign_in_at } — 교사·관리자만. 이메일 등 PII는 담지 않음.
  try {
    const { data: staff, error: staffErr } = await supabaseAdmin.from('profiles')
      .select('id').in('role', ['teacher', 'admin'])
    if (staffErr) return res.status(500).json({ error: '교사 목록 조회 실패' })
    const ids = (staff || []).map(p => p.id)
    for (let i = 0; i < ids.length; i += LAST_LOGIN_BATCH) {
      const got = await Promise.all(ids.slice(i, i + LAST_LOGIN_BATCH).map(id =>
        supabaseAdmin.auth.admin.getUserById(id)
          .then(r => [id, r?.data?.user?.last_sign_in_at || null])
          .catch(() => [id, null])))
      for (const [id, at] of got) lastLogins[id] = at
    }
  } catch (e) {
    return res.status(500).json({ error: '사용자 목록 조회 중 오류' })
  }

  return res.status(200).json({ lastLogins })
}
