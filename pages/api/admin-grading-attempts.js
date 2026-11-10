// ============================================
// step666: 관리자 "⏱ 채점 시간" 칩용 — 채점 시도(grading_attempts) 최근 14일 읽기 (관리자 전용, 읽기 전용)
// ============================================
//   POST { accessToken } → { rows: [{ classId, startedAt, lastTryAt, finishedAt, waitMs, tries, cause }], truncated }
//   원인(cause)은 서버에서 붙인다: 같은 학생의 채점 서버 오류(error_logs api_error, grading·rewriteGrading) 중
//   첫 누름~마지막 누름 사이의 마지막 1건(lib/gradingTiming attachCauses). 응답에 학생 id·오류 원문은 싣지 않는다.
import { createClient } from '@supabase/supabase-js'
import { attachCauses } from '../../lib/gradingTiming'

const DAYS = 14
const PAGE = 1000
const MAX_PAGES = 5

async function readAll(build) {
  const out = []
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await build().range(p * PAGE, p * PAGE + PAGE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) return { rows: out, truncated: false }
  }
  return { rows: out, truncated: true }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { accessToken } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY가 없어요.' })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: userData, error: userErr } = await anon.auth.getUser(accessToken)
  if (userErr || !userData?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  const { data: me } = await admin.from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
  if (!me || me.role !== 'admin') return res.status(403).json({ error: '관리자만 조회할 수 있어요' })

  try {
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString()
    const att = await readAll(() => admin.from('grading_attempts')
      .select('user_id, class_id, started_at, last_try_at, finished_at, wait_ms, tries')
      .gte('started_at', since).order('started_at', { ascending: false }))
    const rows = att.rows.map(r => ({
      userId: r.user_id, classId: r.class_id || null, startedAt: r.started_at, lastTryAt: r.last_try_at,
      finishedAt: r.finished_at || null, waitMs: r.wait_ms, tries: r.tries,
    }))
    // 원인 매칭 재료: 미완료 행이 있을 때만, 그 학생들의 채점 서버 오류만 읽는다
    const openUsers = [...new Set(rows.filter(r => !r.finishedAt).map(r => r.userId))]
    let logs = []
    for (let i = 0; i < openUsers.length; i += 100) {
      const ids = openUsers.slice(i, i + 100)
      const got = await readAll(() => admin.from('error_logs')
        .select('user_id, created_at, context')
        .eq('error_type', 'api_error').in('user_id', ids).gte('created_at', since)
        .order('created_at', { ascending: true }))
      logs.push(...got.rows)
    }
    logs = logs.filter(l => /grading/i.test(String(l.context?.aiType || ''))).map(l => ({
      userId: l.user_id, at: l.created_at,
      status: l.context?.upstream?.status ?? null,
      quota: !!l.context?.upstream?.quota,
      timeout: !!l.context?.upstream?.timeout,
      message: String(l.context?.upstream?.message || '').slice(0, 200),
    }))
    const withCause = attachCauses(rows, logs).map(({ userId, ...rest }) => rest)   // 학생 id는 응답에서 뺀다
    return res.status(200).json({ rows: withCause, truncated: att.truncated })
  } catch (e) {
    console.error('admin-grading-attempts 오류:', e?.message || e)
    return res.status(500).json({ error: String(e?.message || e).slice(0, 200) })
  }
}
