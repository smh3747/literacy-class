// 교사 아이디 찾기 (자동, 마스킹 표시) — step162
//
// 이름 + 학교가 정확히 일치하는 교사를 service_role로 조회해 "마스킹된" 아이디를 반환한다.
//   - 0건  → status: 'none'      (일치 계정 없음)
//   - 1건  → status: 'found'     (maskedUsername 반환)
//   - 2건+ → status: 'multiple'  (동명이인 — 자동확정 불가, 수동 요청으로 폴백)
//
// 전체 아이디는 절대 반환하지 않는다(마스킹만). 아이디는 비밀번호 없이는 로그인에 쓸 수
// 없으므로 마스킹 표시의 위험은 낮다. PIN 등 추가 본인확인은 두지 않는다(테스트 운영용).
//
// profiles RLS(prof_select)는 to authenticated라 비로그인은 0행 → 반드시 service_role 경유.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'

function maskUsername(u) {
  const s = String(u || '')
  if (s.length <= 1) return '***'
  if (s.length <= 4) return s[0] + '***' + s.slice(-1)
  return s.slice(0, 3) + '***' + s.slice(-2)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { realname, school } = req.body || {}
  if (!realname || !realname.trim() || !school || !school.trim()) {
    return res.status(400).json({ error: '이름과 학교를 모두 입력해주세요' })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })

  try {
    // 이름 + 학교 정확 일치 (클라이언트가 trim해서 보냄). 휴지통 계정은 제외.
    const { data, error } = await supabase.from('profiles')
      .select('username, deleted_at, role')
      .eq('realname', realname.trim())
      .eq('school', school.trim())
      .in('role', ['teacher', 'admin'])
    if (error) throw error

    const active = (data || []).filter(p => !p.deleted_at && p.username)
    if (active.length === 0) return res.status(200).json({ status: 'none' })
    if (active.length > 1) return res.status(200).json({ status: 'multiple', count: active.length })
    return res.status(200).json({ status: 'found', maskedUsername: maskUsername(active[0].username) })
  } catch (e) {
    console.error('find-teacher-id error:', e?.message || e)
    return res.status(500).json({ error: '조회 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
  }
}
