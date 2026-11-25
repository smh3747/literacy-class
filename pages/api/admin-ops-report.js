// step688: 관리자 "📋 오늘 운영 보고" — 지금 보고 만들기 · 지난 날짜 채우기 (관리자 전용)
//   POST { accessToken, action: 'build' }            → 오늘 날짜 보고를 지금까지의 자료로 만들어 덮어쓴다(15시 전이면 중간 보고)
//   POST { accessToken, action: 'backfill' }         → 지난 30일 가운데 보고가 없는 날짜만 채운다
//   보고를 읽는 것은 화면이 ops_reports를 직접 읽는다(RLS: 관리자만).
import { createClient } from '@supabase/supabase-js'
import { kstToday, closedReportDate } from '../../lib/opsReport'
import { buildAndSaveReport, backfillReports } from '../../lib/opsReport.server'

export const config = { maxDuration: 120 }
const BACKFILL_DAYS = 30

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { accessToken, action } = req.body || {}
  if (!accessToken) return res.status(401).json({ error: '로그인이 필요해요' })
  if (action !== 'build' && action !== 'backfill') return res.status(400).json({ error: 'action이 올바르지 않아요' })
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: '서버 설정 오류: SUPABASE_SERVICE_ROLE_KEY가 없어요.' })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const anon = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: userData, error: userErr } = await anon.auth.getUser(accessToken)
  if (userErr || !userData?.user) return res.status(401).json({ error: '인증 정보가 유효하지 않아요' })
  const { data: me } = await admin.from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
  if (!me || me.role !== 'admin') return res.status(403).json({ error: '관리자만 쓸 수 있어요' })

  try {
    const now = Date.now()
    if (action === 'build') {
      const row = await buildAndSaveReport(admin, kstToday(now), { source: 'manual', nowMs: now })
      return res.status(200).json({ ok: true, date: row.report_date, verdict: row.verdict })
    }
    // 채우기 범위: 구간이 끝난 가장 최근 날짜까지 30일. 이미 보고가 있는 날짜는 건너뛴다.
    const r = await backfillReports(admin, closedReportDate(now), BACKFILL_DAYS, now)
    return res.status(200).json({ ok: true, ...r })
  } catch (e) {
    console.error('admin-ops-report 오류:', e?.message || e)
    return res.status(500).json({ error: '보고를 만들지 못했어요. ops_reports 표(step688 SQL)가 적용됐는지 확인해 주세요.' })
  }
}
