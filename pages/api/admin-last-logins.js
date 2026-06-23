// 교사 마지막 로그인 시각 조회 API (관리자 전용, 읽기 전용)
// Supabase auth.users.last_sign_in_at(내장 자동 기록)을 service-role로 읽어온다.
// ★읽기 전용: listUsers만 사용. auth 데이터 update/delete 절대 안 함. PII(이메일 등) 미반환.
//
// 환경변수 필요:
// - NEXT_PUBLIC_SUPABASE_URL
// - NEXT_PUBLIC_SUPABASE_ANON_KEY
// - SUPABASE_SERVICE_ROLE_KEY  ← 서버 전용 (다른 admin API가 이미 쓰는 그 키 재사용)

import { createClient } from '@supabase/supabase-js'

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

  // auth.users 전량 순회 (listUsers는 perPage 최대 1000 — 페이지네이션 필수)
  const lastLogins = {}  // { userId: last_sign_in_at }
  let page = 1
  const perPage = 1000
  let guard = 0
  try {
    while (guard++ < 100) {  // 최대 10만명 가드 (무한 루프 방지)
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
      if (error) {
        return res.status(500).json({ error: '사용자 목록 조회 실패' })
      }
      const users = data?.users || []
      users.forEach(u => {
        // id ↔ 마지막 로그인 시각만. 이메일 등 PII는 담지 않음.
        lastLogins[u.id] = u.last_sign_in_at || null
      })
      if (users.length < perPage) break
      page += 1
    }
  } catch (e) {
    return res.status(500).json({ error: '사용자 목록 조회 중 오류' })
  }

  return res.status(200).json({ lastLogins })
}
