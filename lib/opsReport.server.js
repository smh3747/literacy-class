// step688: 매일 운영 보고서 — 서버 전용(서비스 롤). 자료를 읽어 lib/opsReport.js buildReport에 넘기고 ops_reports에 저장한다.
//   읽는 컬럼에 글 본문·실명·쪽지 본문·의견 본문이 없다. 채점·저장 경로와 무관한 읽기 전용 집계다.
import { buildReport, windowOf, addDays, weekdayOf, DAY_MS } from './opsReport'

const PAGE = 1000
const MAX_PAGES = 60

async function readAll(build) {
  const out = []
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await build().range(p * PAGE, p * PAGE + PAGE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return out
}
// 실패해도 보고 전체를 막지 않는 조회(부가 항목용). 실패하면 빈 배열.
async function readSoft(build) {
  try { return await readAll(build) } catch (e) { console.warn('ops 보고 부가 조회 실패(무시):', e?.message || e); return [] }
}

// 가장 이른 보고 날짜를 받아, 그 날짜부터 지금까지의 보고를 만들 수 있는 자료를 한 번에 읽는다.
export async function loadOpsData(admin, earliestDateKey) {
  const recentFrom = new Date(windowOf(earliestDateKey).startMs - 35 * DAY_MS).toISOString()
  const recentDate = recentFrom.slice(0, 10)
  const [profiles, classes, subsAll, subs, pendingRows, reports, supplyTopics, attempts, logsRaw] = await Promise.all([
    readAll(() => admin.from('profiles').select('id, class_id, role, created_at, deleted_at').order('id')),
    readAll(() => admin.from('classes').select('id, name, school, teacher_id, created_at, deleted_at, peer_share_enabled, auto_supply_enabled').order('id')),
    readAll(() => admin.from('submissions').select('user_id, created_at').is('deleted_at', null).order('created_at').order('id')),
    readAll(() => admin.from('submissions')
      .select('id, user_id, topic_id, attempt, total_score, max_score, created_at, grading_ms, grade_reason, graded_with_model')
      .is('deleted_at', null).gte('created_at', recentFrom).order('created_at').order('id')),
    readAll(() => admin.from('submissions').select('user_id, created_at, grade_status').in('grade_status', ['pending', 'failed']).is('deleted_at', null).order('id')),
    readAll(() => admin.from('submissions').select('user_id, report_reason, reported_at, report_resolved_at').eq('reported', true).is('deleted_at', null).order('id')),
    readAll(() => admin.from('topics').select('id').not('source_supply_id', 'is', null).order('id')),
    readAll(() => admin.from('grading_attempts')
      .select('class_id, started_at, last_try_at, finished_at, wait_ms, tries, phase, precheck_ms, grade_ms, save_ms')
      .gte('started_at', recentFrom).order('started_at').order('id')),
    readAll(() => admin.from('error_logs').select('created_at, class_id, error_type, context').gte('created_at', recentFrom).order('created_at').order('id')),
  ])
  const [alerts, messages, feedback, peerViews, showcaseViews, tutor, examples] = await Promise.all([
    readSoft(() => admin.from('correction_alerts').select('detected_at').gte('detected_at', recentFrom).order('id')),
    readSoft(() => admin.from('messages').select('teacher_id, sender_id, read_at, created_at').is('deleted_at', null).order('id')),
    readSoft(() => admin.from('feedback').select('user_id, created_at, replied_at').eq('is_hidden', false).order('id')),
    readSoft(() => admin.from('peer_share_views').select('class_id, created_at').gte('created_at', recentFrom).order('id')),
    readSoft(() => admin.from('supply_showcase_views').select('student_id, created_at').gte('created_at', recentFrom).order('id')),
    readSoft(() => admin.from('tutor_chat_usage').select('user_id, used_date, count').gte('used_date', recentDate).order('id')),
    readSoft(() => admin.from('submissions').select('user_id, created_at').is('deleted_at', null).not('example_text', 'is', null).gte('created_at', recentFrom).order('id')),
  ])
  let dbBytes = null, subsRows = null
  try { const { data, error } = await admin.rpc('ops_db_size'); if (!error && data != null) dbBytes = Number(data) } catch (_) {}
  try { const { count, error } = await admin.from('submissions').select('id', { count: 'exact', head: true }); if (!error) subsRows = count } catch (_) {}
  return {
    profiles, classes, subsAll, subs, pendingRows, reports,
    supplyTopicIds: supplyTopics.map(t => t.id),
    attempts,
    // 오류 원문(context.upstream)은 넘기지 않는다. 채점 호출인지 가르는 종류 이름만 꺼낸다.
    logs: logsRaw.map(l => ({ created_at: l.created_at, class_id: l.class_id, error_type: l.error_type, ai_type: l.context?.aiType || null })),
    alerts, messages, feedback, peerViews, showcaseViews, tutor, examples, dbBytes, subsRows,
  }
}

async function readRow(admin, dateKey) {
  const { data } = await admin.from('ops_reports').select('report_date, verdict, metrics').eq('report_date', dateKey).maybeSingle()
  return data || null
}

// 한 날짜의 보고를 만들어 저장한다(같은 날짜는 덮어쓴다). data를 넘기면 다시 읽지 않는다.
export async function buildAndSaveReport(admin, dateKey, { source = 'cron', historical = false, data = null, nowMs = Date.now() } = {}) {
  const d = data || await loadOpsData(admin, dateKey)
  let prevBacklog = null
  const weekVerdicts = []
  if (!historical) {
    try { prevBacklog = (await readRow(admin, addDays(dateKey, -1)))?.metrics?.waiting?.backlog || null } catch (_) {}
  }
  if (weekdayOf(dateKey) === 5) {
    try {
      const { data: rows } = await admin.from('ops_reports').select('report_date, verdict')
        .gte('report_date', addDays(dateKey, -4)).lt('report_date', dateKey)
      for (const r of rows || []) weekVerdicts.push(r.verdict)
    } catch (_) {}
  }
  const rep = buildReport(d, dateKey, { nowMs, historical, prevBacklog, weekVerdicts })
  const row = { report_date: rep.report_date, verdict: rep.verdict, metrics: rep.metrics, lines: rep.lines, source, created_at: new Date(nowMs).toISOString() }
  const { error } = await admin.from('ops_reports').upsert(row, { onConflict: 'report_date' })
  if (error) throw error
  return row
}

// 지난 날짜 채우기: 보고가 없는 날짜만 만든다(이미 있는 날짜는 건드리지 않는다). 오래된 날짜부터 채워 금요일 주간 판정이 앞 날짜를 볼 수 있게 한다.
export async function backfillReports(admin, lastDateKey, days, nowMs = Date.now()) {
  const keys = []
  for (let i = days - 1; i >= 0; i--) keys.push(addDays(lastDateKey, -i))
  const { data: have, error } = await admin.from('ops_reports').select('report_date').gte('report_date', keys[0]).lte('report_date', keys[keys.length - 1])
  if (error) throw error
  const haveSet = new Set((have || []).map(r => r.report_date))
  const todo = keys.filter(k => !haveSet.has(k))
  if (todo.length === 0) return { made: 0, skipped: keys.length }
  const data = await loadOpsData(admin, todo[0])
  for (const k of todo) await buildAndSaveReport(admin, k, { source: 'backfill', historical: true, data, nowMs })
  return { made: todo.length, skipped: keys.length - todo.length }
}
