// step688: 운영 즉시 알림 — 서버 전용(서비스 롤).
//   pages/api/grading-attempt.js가 학생이 [제출]을 누를 때마다(action 'start') 응답과 따로 부른다.
//   학생 화면은 그 API의 응답을 기다리지 않으므로 이 검사가 제출을 늦추지 않는다. 여기서 난 오류는 전부 삼킨다.
//   조건과 문구는 lib/opsReport.js(alertKindsOf)에 있다. 같은 종류는 30분에 1회만 보낸다.
import { alertKindsOf, alertCooldownOk, isTestClass, ALERT_WINDOW_MS, ALERT_OPEN_LOOKBACK_MS, ALERT_COOLDOWN_MS, FRESH_MS } from './opsReport'

const CHECK_EVERY_MS = 60 * 1000      // 같은 서버 인스턴스에서는 1분에 한 번만 검사한다
let lastCheckMs = 0

// 알림 보내기는 이 함수 하나로 모은다. 지금은 관리자 알림(notifications)만 넣는다.
//   나중에 이메일 등 다른 길을 붙일 때 이 함수 안에 더한다. 유형은 기존 규칙대로 'message'를 재사용한다(step541).
export async function sendOpsAlert(admin, { title, body }) {
  const { data: admins, error } = await admin.from('profiles').select('id').eq('role', 'admin').is('deleted_at', null)
  if (error) throw error
  const rows = (admins || []).map(a => ({ recipient_id: a.id, type: 'message', title, body, link: '/admin' }))
  if (rows.length === 0) return { sent: 0 }
  const { error: insErr } = await admin.from('notifications').insert(rows)
  if (insErr) throw insErr
  return { sent: rows.length }
}

const maxCount = (ids) => {
  const m = new Map(); let mx = 0
  for (const id of ids) { const k = id || 'unknown'; const n = (m.get(k) || 0) + 1; m.set(k, n); if (n > mx) mx = n }
  return mx
}

async function countRecent(admin, nowMs) {
  const since = new Date(nowMs - ALERT_WINDOW_MS).toISOString()
  const [logsRes, defRes, openRes] = await Promise.all([
    admin.from('error_logs').select('class_id, context').eq('error_type', 'api_error').gte('created_at', since).limit(500),
    admin.from('submissions').select('user_id').not('grade_reason', 'is', null).gte('created_at', since).limit(500),
    admin.from('grading_attempts').select('class_id').is('finished_at', null)
      .gte('last_try_at', new Date(nowMs - ALERT_OPEN_LOOKBACK_MS).toISOString())
      .lte('last_try_at', new Date(nowMs - FRESH_MS).toISOString()).limit(500),
  ])
  const gradeLogs = (logsRes.data || []).filter(l => !isTestClass(l.class_id) && /grading/i.test(String(l.context?.aiType || '')))
  const openRows = (openRes.data || []).filter(a => !isTestClass(a.class_id))
  let deferred = 0
  const defUsers = [...new Set((defRes.data || []).map(r => r.user_id))]
  if (defUsers.length > 0) {
    const { data: profs } = await admin.from('profiles').select('id, class_id').in('id', defUsers.slice(0, 200))
    const cls = new Map((profs || []).map(p => [p.id, p.class_id]))
    deferred = (defRes.data || []).filter(r => !isTestClass(cls.get(r.user_id))).length
  }
  return {
    gradeErrors: gradeLogs.length, gradeErrorsMaxClass: maxCount(gradeLogs.map(l => l.class_id)),
    deferred,
    open: openRows.length, openMaxClass: maxCount(openRows.map(a => a.class_id)),
  }
}

// 조건을 검사하고 필요하면 알림을 보낸다. 절대 던지지 않는다.
export async function runOpsAlertCheck(admin, nowMs = Date.now()) {
  try {
    if (nowMs - lastCheckMs < CHECK_EVERY_MS) return { skipped: 'throttled' }
    lastCheckMs = nowMs
    const kinds = alertKindsOf(await countRecent(admin, nowMs))
    if (kinds.length === 0) return { sent: [] }
    const sent = []
    for (const k of kinds) {
      const { data: last } = await admin.from('notifications').select('created_at')
        .eq('title', k.title).gte('created_at', new Date(nowMs - ALERT_COOLDOWN_MS).toISOString())
        .order('created_at', { ascending: false }).limit(1)
      const lastMs = last && last[0] ? Date.parse(last[0].created_at) : null
      if (!alertCooldownOk(lastMs, nowMs)) continue
      await sendOpsAlert(admin, k)
      sent.push(k.kind)
    }
    return { sent }
  } catch (e) {
    try { console.warn('운영 알림 검사 실패(무시):', e?.message || e) } catch (_) {}
    return { error: true }
  }
}
