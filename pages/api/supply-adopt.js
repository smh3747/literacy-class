// 전국 글쓰기 챌린지 주제 자동 등록 (step476)
// 오늘(KST) 발행된 공급 주제(supply_type 있는 topics)를 호출자의 학급 주제로 복사한다.
// 호출 경로: ① 학생 글쓰기 진입·교사 홈 로드 시 lazy(step507: 토글 무관 상시 호출 — OFF면 청소만 하고 disabled 반환)
//           ② 교사 홈 원클릭 카드(force: true — 토글 무관, 교사 role만 허용)
// step507: 전일 미제출 복사본 청소는 disabled 조기 반환보다 먼저 실행 — 토글 OFF(원클릭 참여) 학급도 정리된다.
// 복사본은 일반 topics 행(공급 메타 미복사) → 채점·통계·기록 로직 무변경.
// 학생 호출도 안전: 자기 담임 앞으로, 오늘 발행분만, (source_supply_id, teacher_id) 유니크로 중복 불가.
//
// 환경변수: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (서버 전용)

import { createClient } from '@supabase/supabase-js'

// 학급 학년 → 받을 수 있는 supply_grade 밴드. 미설정·1~2학년은 '공통'만.
const bandsForGrade = (grade) => {
  const bands = ['공통']
  if (grade === 3 || grade === 4) bands.push('3~4학년')
  if (grade === 5 || grade === 6) bands.push('5~6학년')
  return bands
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { accessToken, force } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  // 토큰 검증 → 호출자 uid 확보
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

  // 호출자 role·학급 → 등록 대상 담임(teacherId) 결정
  const { data: profile } = await admin.from('profiles')
    .select('role, class_id').eq('id', uid).maybeSingle()
  if (!profile || !profile.class_id) return res.status(403).json({ error: '학급 정보가 없어요' })
  if (profile.role !== 'student' && profile.role !== 'teacher') {
    return res.status(403).json({ error: '학생·교사만 사용할 수 있어요' })
  }

  const { data: cls } = await admin.from('classes')
    .select('id, teacher_id, grade, auto_supply_enabled').eq('id', profile.class_id).maybeSingle()
  if (!cls?.teacher_id) return res.status(403).json({ error: '학급 정보가 없어요' })

  let teacherId = cls.teacher_id
  if (profile.role === 'teacher') {
    // 교사는 자기 학급만 (profile.class_id와 담임 불일치면 차단)
    if (cls.teacher_id !== uid) return res.status(403).json({ error: '담임 학급이 아니에요' })
    teacherId = uid
  }

  // force는 교사 원클릭 전용 — 학생이 보내면 무시하고 토글 검사
  const isForce = force === true && profile.role === 'teacher'

  const now = new Date()
  const kstYmd = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)

  // step479: 청소 — 쓴 주제는 기록으로 남고, 안 쓴 자동 주제는 다음 날 사라진다.
  //   이 교사의 어제 이전 복사본 중 제출 0건(휴지통 글 포함, deleted_at 무관)만 삭제. 실패는 무시.
  //   step507: disabled 조기 반환보다 먼저 — 토글 OFF 학급도 호출만 되면 정리(등록 여부 무관).
  try {
    const { data: stale } = await admin.from('topics')
      .select('id').eq('teacher_id', teacherId)
      .not('source_supply_id', 'is', null).lt('date', kstYmd)
    const staleIds = (stale || []).map(t => t.id)
    if (staleIds.length > 0) {
      const { data: subs } = await admin.from('submissions')
        .select('topic_id').in('topic_id', staleIds)
      const written = new Set((subs || []).map(s => s.topic_id))
      const deletable = staleIds.filter(id => !written.has(id))
      if (deletable.length > 0) {
        await admin.from('topics').delete().in('id', deletable)
      }
    }
  } catch (e) {
    console.warn('supply-adopt 청소 실패(무시):', e?.message)
  }

  if (!isForce && cls.auto_supply_enabled !== true) {
    return res.status(200).json({ ok: true, adopted: [], reason: 'disabled' })
  }

  // 오늘(KST) 발행된 공급 주제 — 예약 발행은 date가 클릭일이라 published_at 창으로 판정
  const dayStartISO = new Date(`${kstYmd}T00:00:00+09:00`).toISOString()
  const { data: supplies, error: supplyErr } = await admin.from('topics')
    .select('id, title, description, rubrics, supply_grade')
    .not('supply_type', 'is', null)
    .gte('published_at', dayStartISO)
    .lte('published_at', now.toISOString())
  if (supplyErr) {
    console.error('supply-adopt 공급 조회 실패:', supplyErr.message)
    return res.status(500).json({ error: '공급 주제를 불러오지 못했어요' })
  }

  // 학년 매칭 (레거시 supply_grade null은 '공통' 취급)
  const bands = bandsForGrade(cls.grade)
  const targets = (supplies || []).filter(s => bands.includes(s.supply_grade || '공통'))

  const adopted = []
  for (const s of targets) {
    const { data: inserted, error: insErr } = await admin.from('topics').insert({
      date: kstYmd,
      title: s.title,
      description: s.description,
      rubrics: s.rubrics,
      teacher_id: teacherId,
      source_supply_id: s.id,
      max_rewrites: 1,   // step494: 챌린지 참여는 총 2회(첫 글+수정 1회)로 고정 — 원본 값과 무관
    }).select('id').single()
    if (!insErr && inserted) {
      adopted.push({ id: inserted.id, title: s.title })
      continue
    }
    if (insErr?.code === '23505') {
      // 이미 등록됨(유니크) — 정상. 기존 행 id 반환
      const { data: existing } = await admin.from('topics')
        .select('id').eq('teacher_id', teacherId).eq('source_supply_id', s.id).maybeSingle()
      if (existing) adopted.push({ id: existing.id, title: s.title })
      continue
    }
    console.error('supply-adopt insert 실패(건너뜀):', insErr?.message)
  }

  return res.status(200).json({ ok: true, adopted })
}
