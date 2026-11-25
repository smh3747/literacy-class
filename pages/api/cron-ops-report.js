// step688: 매일 운영 보고서 cron — vercel.json에 매일 06:00 UTC(15:00 KST)로 등록.
//   Hobby 요금제는 지정한 시각부터 59분 안에 실행되므로 15:00~15:59 KST 사이에 만들어진다.
//   집계 구간은 실행 시각과 무관하게 "전날 15:00 ~ 당일 15:00"로 고정이고, 같은 날짜는 덮어쓰므로 두 번 실행돼도 1행이다.
import { createClient } from '@supabase/supabase-js'
import { closedReportDate } from '../../lib/opsReport'
import { buildAndSaveReport } from '../../lib/opsReport.server'

export const config = { maxDuration: 120 }

export default async function handler(req, res) {
  // Vercel Cron만 호출 가능 — CRON_SECRET 미설정 시 무조건 거부(기존 크론과 같은 방식)
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(500).json({ error: '서버 설정 누락 (CRON_SECRET 없음)' })
  if (req.headers.authorization !== `Bearer ${cronSecret}`) return res.status(401).json({ error: 'Unauthorized' })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: '서버 설정 누락 (SERVICE_ROLE_KEY 없음)' })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

  try {
    const dateKey = closedReportDate(Date.now())
    const row = await buildAndSaveReport(admin, dateKey, { source: 'cron' })
    return res.status(200).json({ ok: true, date: row.report_date, verdict: row.verdict })
  } catch (e) {
    console.error('cron-ops-report 오류:', e?.message || e)
    return res.status(500).json({ error: '보고를 만들지 못했어요' })
  }
}
