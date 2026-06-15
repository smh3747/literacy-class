// 교사 아이디 찾기 (자동, 마스킹 표시) — step162 / step164
//
// 이름 + 학교가 정확히 일치하는 교사를 service_role로 조회해 "마스킹된" 아이디를 반환한다.
//   - 0건  → status: 'none'            (일치 계정 없음)
//   - 1건  → status: 'found'           (maskedUsername 반환)
//   - 2건+ → status: 'need_class_code' (동명이인 — 학급 가입코드 2차 확인 요청)
//            └ 클라이언트가 class_code를 추가로 보내 재호출하면:
//               · 후보 중 그 코드의 담임 1명 확정 → 'found'
//               · 코드 불일치/여전히 복수      → 'multiple' (관리자 요청 폴백)
//
// step164: 아이디 찾기는 "교사"를 돕는 기능이므로 후보를 role='teacher'로 한정한다
//   (admin 본인은 자기 아이디를 아므로 후보에서 제외 → 불필요한 동명이인 줄임).
//
// 전체 아이디는 절대 반환하지 않는다(마스킹만). 아이디는 비밀번호 없이는 로그인에 쓸 수
// 없으므로 마스킹 표시의 위험은 낮다. 학급코드 2차 확인은 "아이디 찾기"에만 쓰며
// 비밀번호 재설정에는 절대 쓰지 않는다. 학급코드 검증은 서버에서만 한다.
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

  const { realname, school, school_code, class_code } = req.body || {}
  if (!realname || !realname.trim() || !school || !school.trim()) {
    return res.status(400).json({ error: '이름과 학교를 모두 입력해주세요' })
  }
  const code = school_code ? String(school_code).trim() : ''
  const classCode = class_code ? String(class_code).trim() : ''

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
    // step163: 표준학교코드(school_code)가 오면 코드 기준으로 먼저 매칭해 표기 흔들림
    // ('하랑초' vs '하랑초등학교')으로 인한 'none'을 없앤다.
    //   ⚠️ 단, 기존 교사는 profile.school_code가 아직 NULL일 수 있다. 이때 코드 매칭이
    //      0건이면 학교명 텍스트로 한 번 더 fallback 조회해 오인식('none')을 막는다.
    //      자동완성으로 고른 학교명은 공식명이라 텍스트 fallback도 정확도가 높다.
    // step164: 후보는 교사만 (admin 제외)
    const findBy = async (col, val) => {
      const { data, error } = await supabase.from('profiles')
        .select('id, username, deleted_at, role')
        .eq('realname', realname.trim())
        .eq(col, val)
        .eq('role', 'teacher')
      if (error) throw error
      return (data || []).filter(p => !p.deleted_at && p.username)
    }

    let active = []
    if (code) {
      active = await findBy('school_code', code)
      if (active.length === 0) active = await findBy('school', school.trim()) // 기존 교사 보완
    } else {
      active = await findBy('school', school.trim())
    }

    if (active.length === 0) return res.status(200).json({ status: 'none' })
    if (active.length === 1) return res.status(200).json({ status: 'found', maskedUsername: maskUsername(active[0].username) })

    // 동명이인(2명+) — step164: 학급 가입코드로 2차 확인
    if (!classCode) return res.status(200).json({ status: 'need_class_code' })

    // 후보 중 입력한 가입코드의 담임(휴지통 학급 제외)을 찾아 1명으로 좁힌다.
    const candidateIds = active.map(p => p.id)
    const { data: cls, error: cErr } = await supabase.from('classes')
      .select('teacher_id')
      .eq('code', classCode)
      .in('teacher_id', candidateIds)
      .is('deleted_at', null)
    if (cErr) throw cErr

    const matchedIds = [...new Set((cls || []).map(c => c.teacher_id))]
    if (matchedIds.length === 1) {
      const t = active.find(p => p.id === matchedIds[0])
      return res.status(200).json({ status: 'found', maskedUsername: maskUsername(t.username) })
    }
    // 코드 불일치 또는 여전히 복수 → 관리자 요청 폴백
    return res.status(200).json({ status: 'multiple', count: active.length })
  } catch (e) {
    console.error('find-teacher-id error:', e?.message || e)
    return res.status(500).json({ error: '조회 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
  }
}
