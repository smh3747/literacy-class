// 🗑️ 관리자 휴지통 자동 영구 삭제 cron (B4)
// Vercel Cron으로 매일 호출 (vercel.json에 설정)
// 30일 지난 선생님·학급을 영구삭제

import { createClient } from '@supabase/supabase-js'

const RETENTION_DAYS = 30

export default async function handler(req, res) {
  // Vercel Cron만 호출 가능 (인증) — CRON_SECRET 미설정 시 무조건 거부
  const authHeader = req.headers.authorization
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return res.status(500).json({ error: '서버 설정 누락 (CRON_SECRET 없음)' })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  }

  const supabase = createClient(supabaseUrl, serviceKey)
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString()

  const result = {
    cutoff,
    teachersDeleted: 0,
    classesDeleted: 0,
    submissionsDeleted: 0,
    topicsDeleted: 0,
    errors: []
  }

  try {
    // ============================================
    // 1. 30일 지난 학급 영구삭제 (먼저 — cascade 필요)
    // ============================================
    const { data: oldClasses, error: classErr } = await supabase
      .from('classes')
      .select('id, name, teacher_id')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff)
    if (classErr) throw classErr

    for (const cls of oldClasses || []) {
      try {
        // 1.1) 학급에 속한 주제들 찾기 (teacher_id 기준)
        //      step482: 공급 원본(supply_type 있음)은 학급 소속이 아니므로 삭제 대상에서 제외
        const { data: classTopics } = await supabase
          .from('topics').select('id').eq('teacher_id', cls.teacher_id)
          .is('supply_type', null)
        const topicIds = (classTopics || []).map(t => t.id)

        // 1.2) 주제들의 제출물 삭제
        if (topicIds.length > 0) {
          const { count: subCount } = await supabase
            .from('submissions').delete({ count: 'exact' }).in('topic_id', topicIds)
          result.submissionsDeleted += subCount || 0
          // 1.3) 주제 삭제
          const { count: topicCount } = await supabase
            .from('topics').delete({ count: 'exact' }).in('id', topicIds)
          result.topicsDeleted += topicCount || 0
        }

        // 1.4) 학급의 학생 profile.class_id = null
        await supabase.from('profiles').update({ class_id: null }).eq('class_id', cls.id)

        // 1.5) 학급 삭제
        const { error: delErr } = await supabase.from('classes').delete().eq('id', cls.id)
        if (delErr) throw delErr
        result.classesDeleted++
      } catch (e) {
        result.errors.push(`class ${cls.id} (${cls.name}): ${e.message}`)
      }
    }

    // ============================================
    // 2. 30일 지난 선생님 영구삭제
    // ============================================
    const { data: oldTeachers, error: teacherErr } = await supabase
      .from('profiles')
      .select('id, realname, role')
      .not('deleted_at', 'is', null)
      .lt('deleted_at', cutoff)
      .in('role', ['teacher', 'admin'])
    if (teacherErr) throw teacherErr

    for (const t of oldTeachers || []) {
      try {
        // FK 설정대로:
        // - topic_suggestion_logs.teacher_id ON DELETE CASCADE → 자동
        // - feedback.user_id ON DELETE SET NULL → 자동
        // 학급은 그대로 둠 (학생 데이터 보호 — 이미 학급은 별도 휴지통)
        const { error: delErr } = await supabase.from('profiles').delete().eq('id', t.id)
        if (delErr) throw delErr
        // 🆕 step387: auth 계정도 함께 삭제 — 고아 계정이 같은 이메일 재가입을 막던 반쪽 삭제 수정
        const { error: authErr } = await supabase.auth.admin.deleteUser(t.id)
        if (authErr) throw new Error('auth 삭제 실패: ' + authErr.message)
        result.teachersDeleted++
      } catch (e) {
        result.errors.push(`teacher ${t.id} (${t.realname}): ${e.message}`)
      }
    }

    return res.status(200).json({
      ok: true,
      ...result
    })
  } catch (e) {
    console.error('cron-admin-trash-cleanup 오류:', e)
    return res.status(500).json({ error: e.message, ...result })
  }
}
