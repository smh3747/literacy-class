// 🗑️ 쓰레기통 자동 영구 삭제 cron
// Vercel Cron으로 매일 새벽 호출 (vercel.json에 설정)
// 각 학급의 trash_retention_days 기간 지난 글 영구 삭제

import { createClient } from '@supabase/supabase-js'

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

  try {
    // 🆕 step155: 30일 지난 에러 로그 자동 삭제 (테이블 무한 증가 방지)
    try {
      const elogCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      await supabase.from('error_logs').delete().lt('created_at', elogCutoff)
    } catch (e) {
      console.warn('error_logs 정리 실패(무시):', e?.message || e)
    }

    // 각 학급의 보관 기간 가져오기
    const { data: classes, error: classErr } = await supabase
      .from('classes')
      .select('id, trash_retention_days')
    if (classErr) throw classErr

    let totalDeleted = 0
    const perClass = []

    for (const cls of classes || []) {
      const days = cls.trash_retention_days || 30
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

      // 해당 학급 학생들 ID
      const { data: students } = await supabase
        .from('profiles')
        .select('id')
        .eq('class_id', cls.id)
        .eq('role', 'student')
      const studentIds = (students || []).map(s => s.id)
      if (studentIds.length === 0) continue

      // 만료된 글 영구 삭제
      const { data: expiredSubs } = await supabase
        .from('submissions')
        .select('id')
        .in('user_id', studentIds)
        .not('deleted_at', 'is', null)
        .lt('deleted_at', cutoff)

      if (expiredSubs && expiredSubs.length > 0) {
        const ids = expiredSubs.map(s => s.id)
        const { error: delErr } = await supabase
          .from('submissions')
          .delete()
          .in('id', ids)
        if (delErr) {
          console.error(`학급 ${cls.id} 삭제 실패:`, delErr)
          continue
        }
        totalDeleted += ids.length
        perClass.push({ classId: cls.id, deleted: ids.length, retentionDays: days })
      }
    }

    res.status(200).json({
      success: true,
      totalDeleted,
      perClass,
      runAt: new Date().toISOString()
    })
  } catch (e) {
    console.error('cron 실패:', e)
    res.status(500).json({ error: e.message })
  }
}
