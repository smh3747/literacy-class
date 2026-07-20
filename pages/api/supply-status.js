// 전국 글쓰기 챌린지 발행 주제의 학급별 채택·참여 현황 (step530, 관리자 전용)
// 입력: supplyId(공급 원본 topics.id) → 그 원본을 source_supply_id로 가진 복사본들을
// 학급별 { 학교, 학년, 반이름, 담임 실명, 등록시각, 참여수 }로 돌려준다. 참여수 내림차순.
// ⚠️ PII 경계: 학생 이름·student_id는 절대 반환하지 않는다 — 참여 수(제출 건수)만.
// 관리자 검증: supply-showcase-admin 패턴(profiles.role !== 'admin' → 403).
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { accessToken, supplyId } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (!supplyId) return res.status(400).json({ error: 'supplyId가 필요해요' })

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

  const { data: requester } = await admin.from('profiles')
    .select('role').eq('id', uid).maybeSingle()
  if (!requester || requester.role !== 'admin') {
    return res.status(403).json({ error: '관리자만 사용할 수 있어요' })
  }

  try {
    // 복사본은 class_id 없이 teacher_id만 기록됨(supply-adopt) — 학급은 classes.teacher_id로 역추적
    const { data: copies, error: copyErr } = await admin.from('topics')
      .select('id, teacher_id, created_at')
      .eq('source_supply_id', supplyId)
    if (copyErr) throw new Error(copyErr.message)
    if (!copies || copies.length === 0) {
      return res.status(200).json({ ok: true, rows: [] })
    }

    const teacherIds = [...new Set(copies.map(c => c.teacher_id).filter(Boolean))]
    const copyIds = copies.map(c => c.id)

    const [{ data: clsRows }, { data: profs }, { data: subs }] = await Promise.all([
      admin.from('classes').select('teacher_id, school, grade, name, deleted_at').in('teacher_id', teacherIds),
      admin.from('profiles').select('id, realname').in('id', teacherIds),
      // 참여수 = 복사본 topic의 submissions 건수(휴지통 제외) — 학생 식별 정보는 조회하지 않는다
      admin.from('submissions').select('topic_id').in('topic_id', copyIds).is('deleted_at', null),
    ])

    // 교사당 학급 1개 매핑 — 비삭제 학급 우선
    const clsByTeacher = {}
    for (const c of (clsRows || [])) {
      if (!clsByTeacher[c.teacher_id] || (clsByTeacher[c.teacher_id].deleted_at && !c.deleted_at)) {
        clsByTeacher[c.teacher_id] = c
      }
    }
    const profById = Object.fromEntries((profs || []).map(p => [p.id, p]))
    const subCount = {}
    for (const s of (subs || [])) subCount[s.topic_id] = (subCount[s.topic_id] || 0) + 1

    const rows = copies.map(c => {
      const cls = clsByTeacher[c.teacher_id]
      return {
        school: cls?.school || '',
        grade: cls?.grade || null,
        className: cls?.name || '',
        teacherName: profById[c.teacher_id]?.realname || '',
        adoptedAt: c.created_at,
        participants: subCount[c.id] || 0,
      }
    }).sort((a, b) => b.participants - a.participants)

    return res.status(200).json({ ok: true, rows })
  } catch (e) {
    return res.status(500).json({ error: e?.message || '조회에 실패했어요' })
  }
}
