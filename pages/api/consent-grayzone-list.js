// 회색지대 학생 목록 조회 API — 인증된 담임이 자기 학급의 "증빙 공백" 학생을 본다.
//
// 회색지대 = consent_received=true 인데 consents 행이 없고, realname 평문이 있고, pending_names 가 없는 학생.
//   (✓는 켜졌는데 동의서 기록이 없어 실명이 노출된 상태 — 종이 동의 확인 또는 재잠금 필요)
// 인증: 교사 accessToken → 본인 학급(classes.teacher_id) 만. admin 은 classId 자유(우회).
// ★실명은 students.js 가 교사에게 보여주는 것과 동일 수위(담임 본인 학급만) — 인증 맥락이라 [{id, number, realname}] 반환.
//   다른 반·is_hidden 학생은 제외. 쓰기 전혀 없음(읽기 전용).
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { classId, accessToken } = req.body || {}
  if (!classId) return res.status(400).json({ error: '학급 정보가 필요해요' })
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY 누락' })
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  // 교사 인증
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: ud, error: ue } = await anon.auth.getUser(accessToken)
  if (ue || !ud?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  const uid = ud.user.id
  const { data: requester } = await admin.from('profiles').select('role').eq('id', uid).maybeSingle()
  if (!requester || (requester.role !== 'teacher' && requester.role !== 'admin')) {
    return res.status(403).json({ error: '선생님 권한이 필요해요' })
  }
  // 담임 검증 (admin 우회)
  if (requester.role !== 'admin') {
    const { data: cls } = await admin.from('classes').select('teacher_id').eq('id', classId).maybeSingle()
    if (!cls || cls.teacher_id !== uid) return res.status(403).json({ error: '본인 학급만 볼 수 있어요' })
  }

  try {
    // 1) 후보: consent_received=true + realname 평문 있음 + 숨김 아님
    const { data: studs } = await admin.from('profiles')
      .select('id, number, realname, consent_received, is_hidden, role')
      .eq('class_id', classId).eq('role', 'student')
    const candidates = (studs || []).filter(s =>
      !s.is_hidden && s.consent_received === true && s.realname && String(s.realname).trim()
    )
    const ids = candidates.map(s => s.id)
    if (ids.length === 0) return res.status(200).json({ ok: true, students: [] })

    // 2) pending_names 있는 학생(잠긴 적 있음 → 제외)
    const { data: pns } = await admin.from('pending_names').select('student_id').in('student_id', ids)
    const lockedSet = new Set((pns || []).map(p => p.student_id))

    // 3) consents 있는 학생(증빙 있음 → 제외)
    const { data: cons } = await admin.from('consents').select('student_id').in('student_id', ids)
    const tracedSet = new Set((cons || []).map(c => c.student_id))

    // 4) 회색지대 = 후보 중 pending_names 없고 consents 없음
    const gray = candidates
      .filter(s => !lockedSet.has(s.id) && !tracedSet.has(s.id))
      .map(s => ({ id: s.id, number: s.number, realname: s.realname }))
      .sort((a, b) => (parseInt(a.number) || 999) - (parseInt(b.number) || 999))

    return res.status(200).json({ ok: true, students: gray })
  } catch (e) {
    console.error('consent-grayzone-list error:', e?.message || e)
    return res.status(500).json({ error: '조회 중 오류가 생겼어요. 잠시 후 다시 시도해주세요.' })
  }
}
