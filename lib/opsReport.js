// step688: 매일 운영 보고서 — 순수 함수(브라우저·서버 공용, import 없음). 게이트: scripts/gate-ops-report.js
//   집계 구간: 보고 날짜 D의 전날 15:00 ~ D 15:00(한국 시각). 시작 포함, 끝 제외.
//   시험 반(6975)은 모든 수치에서 뺀다. 학생 실명·글 본문은 받지도 담지도 않는다(학급은 "학교 반" 이름만).
//   문장은 수치로만 조립한다. 원인을 추측하는 말을 넣지 않는다.

export const OPS_TEST_CLASS_ID = 'f0b64c29-1ec2-45a0-aa20-887b74c991b3'   // lib/testStudent.js TEST_CLASS_ID와 같은 값(게이트로 고정)
export const DAY_MS = 86400000
const HOUR_MS = 3600000
const KST_MS = 9 * HOUR_MS
export const OVER_MS = 60000            // "1분 넘음"
export const FRESH_MS = 2 * 60000       // 마지막 누름이 이보다 최근인 미완료 시도는 진행 중으로 보고 뺀다
export const STALE_PENDING_MS = 15 * 60000
export const LESSON_DAY_MIN = 20        // 수업일: 평일이면서 제출이 이 수 이상인 날
export const LESSON_DAYS = 7
export const QUIET_DAYS = 14
export const CALL_LIMIT = 500           // 학급 열쇠 하루 호출 한도(메인 모델)
export const DB_LIMIT_BYTES = 500 * 1024 * 1024   // Supabase 무료 한도 가정. 요금제가 바뀌면 이 값만 고친다.
export const QUIET_LIST_MAX = 60

// ── 판정 기준 ──
//   채점 오류·1분 넘음·95% 대기는 10/27~11/25 실제 수치에 대 본 값이다(11/03·11/05·11/10 🔴, 11/04·11/09 🟡, 나머지 🟢).
//   ⚠ open(결과 못 받음)·deferred(보류 저장)는 추정값이다. 못 받음은 11/11 이후 자료뿐이고 보류는 그때까지 2건뿐이라
//     과거 사고에 맞춰 보지 못했다. 2주 뒤(12/9 무렵) 쌓인 보고를 보고 다시 맞춘다.
//   사용량이 적다는 이유로는 🟡가 되지 않는다(전부 건수와 최소 표본 조건).
export const OPS_RULES = {
  gradeErrors: { yellow: 10, red: 60, redClass: 30 },
  over60: { yellowN: 3, yellowPct: 2, redN: 10, redPct: 5 },
  p95: { minN: 30, yellowMs: 40000, redMs: 90000 },
  open: { yellow: 5, yellowClass: 3, red: 10, redClass: 5 },      // 추정값
  deferred: { yellow: 5, red: 30, redClass: 15 },                 // 추정값
  stale: { yellow: 1, red: 10 },
  calls: { yellowPct: 80, redPct: 100 },
}

// ── 즉시 알림 기준(최근 10분, 같은 종류는 30분에 1회) ──
export const ALERT_WINDOW_MS = 10 * 60000
export const ALERT_OPEN_LOOKBACK_MS = 30 * 60000
export const ALERT_COOLDOWN_MS = 30 * 60000
export const ALERT_RULES = {
  grade_fail: { total: 10, perClass: 5 },
  deferred: { total: 5 },
  no_result: { total: 5, perClass: 3 },
}
export const ALERT_TITLE_PREFIX = '🚨 운영 알림'
// step689: 관리자 [알림 시험 보내기]용. 제목이 실제 알림과 달라서 30분 중복 판정(제목 일치)에 걸리지도, 실제 알림을 막지도 않는다.
export const ALERT_TEST_MARK = '[시험]'
export const ALERT_TEST_TITLE = `${ALERT_TEST_MARK} ${ALERT_TITLE_PREFIX}: 알림이 잘 오는지 보는 시험이에요`
export const ALERT_TEST_BODY = '관리자가 [알림 시험 보내기]를 눌러 보낸 시험 알림이에요. 실제 문제가 생긴 것이 아니에요.'
export const ALERT_TITLES = {
  grade_fail: `${ALERT_TITLE_PREFIX}: 채점 실패가 몰리고 있어요`,
  deferred: `${ALERT_TITLE_PREFIX}: 보류로 저장되는 글이 늘고 있어요`,
  no_result: `${ALERT_TITLE_PREFIX}: 결과를 못 받는 제출이 있어요`,
}

// ── 날짜 ──
export function kstToday(nowMs) { return new Date(nowMs + KST_MS).toISOString().slice(0, 10) }
export function windowOf(dateKey) {
  const endMs = Date.parse(`${dateKey}T15:00:00+09:00`)
  return { startMs: endMs - DAY_MS, endMs }
}
// 시각 → 그 시각이 들어가는 구간의 보고 날짜
export function dateKeyOfMs(ms) { return new Date(ms + KST_MS + 9 * HOUR_MS).toISOString().slice(0, 10) }
export function addDays(dateKey, n) { return new Date(Date.parse(`${dateKey}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10) }
export function weekdayOf(dateKey) { return new Date(`${dateKey}T00:00:00Z`).getUTCDay() }   // 0 일 ~ 6 토
export function isValidDateKey(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`)) }
// 크론이 만들 날짜: 구간이 이미 끝난 가장 최근 날짜
export function closedReportDate(nowMs) { const t = kstToday(nowMs); return nowMs >= windowOf(t).endMs ? t : addDays(t, -1) }
// 화면이 "있어야 한다"고 보는 날짜: 16:00(크론이 늦어도 끝나는 시각)부터 오늘, 그 전에는 어제
export function expectedReportDate(nowMs) { const t = kstToday(nowMs); return nowMs >= windowOf(t).endMs + HOUR_MS ? t : addDays(t, -1) }
const kstDateOf = (ms) => new Date(ms + KST_MS).toISOString().slice(0, 10)
const mdOf = (dateKey) => `${Number(dateKey.slice(5, 7))}/${Number(dateKey.slice(8, 10))}`

// ── 작은 도구 ──
function pctl(sorted, p) {
  if (!sorted.length) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}
function stat(values) {
  const s = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  return { n: s.length, p50: pctl(s, 50), p95: pctl(s, 95), max: s.length ? s[s.length - 1] : null }
}
const maxOf = (map) => { let m = 0; for (const v of map.values()) if (v > m) m = v; return m }
const inc = (map, k, n = 1) => map.set(k, (map.get(k) || 0) + n)
const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : NaN }
const num = (v) => (v == null ? NaN : Number(v))   // null을 0으로 읽지 않는다
export const isTestClass = (classId) => !!classId && classId === OPS_TEST_CLASS_ID
export function classLabel(c) {
  if (!c) return '학급 정보 없음'
  const s = `${(c.school || '').trim()} ${(c.name || '').trim()}`.trim()
  return s || '이름 없는 학급'
}
export function secText(v) {
  if (v == null || !Number.isFinite(v)) return '–'
  const s = v / 1000
  return s >= 100 ? `${Math.round(s)}초` : `${Math.round(s * 10) / 10}초`
}
function ptDay(msVal) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(msVal)) }
  catch (_) { return new Date(msVal - 8 * HOUR_MS).toISOString().slice(0, 10) }
}
function reportTagOf(reason) {
  const m = String(reason || '').trim().match(/^\[([^\]]{1,30})\]/)
  return m ? m[1] : '사유 없음'
}

// ── 판정 ──
//   s: { gradeErrors, gradeErrorsMaxClass, attempts, over60, p95, open, openMaxClass, deferred, deferredMaxClass, stale, callsPct }
//   stale·callsPct가 null이면(지난 날짜 채우기) 그 기준은 건너뛴다.
export function judgeOps(s) {
  const R = OPS_RULES
  const reasons = []
  const add = (level, key, text) => reasons.push({ level, key, text })
  const n = (v) => Number(v) || 0
  const ge = n(s.gradeErrors), gc = n(s.gradeErrorsMaxClass)
  if (ge >= R.gradeErrors.red || gc >= R.gradeErrors.redClass) add('red', 'gradeErrors', `채점 서버 오류가 ${ge}건이었고 한 학급에서 가장 많이 ${gc}건이 나왔어요.`)
  else if (ge >= R.gradeErrors.yellow) add('yellow', 'gradeErrors', `채점 서버 오류가 ${ge}건이었고 한 학급에서 가장 많이 ${gc}건이 나왔어요.`)
  const att = n(s.attempts), o60 = n(s.over60)
  const o60pct = att > 0 ? (o60 / att) * 100 : 0
  const o60txt = `결과를 받는 데 1분 넘게 걸린 제출이 ${o60}건(${Math.round(o60pct * 10) / 10}%)이었어요.`
  if (o60 >= R.over60.redN && o60pct >= R.over60.redPct) add('red', 'over60', o60txt)
  else if (o60 >= R.over60.yellowN && o60pct >= R.over60.yellowPct) add('yellow', 'over60', o60txt)
  if (att >= R.p95.minN && Number.isFinite(s.p95)) {
    const t = `제출 100건 중 95건이 결과를 받기까지 ${secText(s.p95)}가 걸렸어요.`
    if (s.p95 >= R.p95.redMs) add('red', 'p95', t)
    else if (s.p95 >= R.p95.yellowMs) add('yellow', 'p95', t)
  }
  const op = n(s.open), oc = n(s.openMaxClass)
  const opTxt = `결과를 못 받은 제출 시도가 ${op}건이었고 한 학급에서 가장 많이 ${oc}건이었어요.`
  if (op >= R.open.red || oc >= R.open.redClass) add('red', 'open', opTxt)
  else if (op >= R.open.yellow || oc >= R.open.yellowClass) add('yellow', 'open', opTxt)
  const df = n(s.deferred), dc = n(s.deferredMaxClass)
  const dfTxt = `점수 없이 먼저 저장된(보류) 글이 ${df}건이었어요.`
  if (df >= R.deferred.red || dc >= R.deferred.redClass) add('red', 'deferred', dfTxt)
  else if (df >= R.deferred.yellow) add('yellow', 'deferred', dfTxt)
  if (s.stale != null) {
    const st = n(s.stale)
    const t = `15분 넘게 점수를 기다리거나 채점에 실패한 글이 지금 ${st}건 있어요.`
    if (st >= R.stale.red) add('red', 'stale', t)
    else if (st >= R.stale.yellow) add('yellow', 'stale', t)
  }
  if (s.callsPct != null && Number.isFinite(s.callsPct)) {
    const t = `한 학급의 하루 AI 호출 추정이 한도의 ${Math.round(s.callsPct)}%였어요.`
    if (s.callsPct >= R.calls.redPct) add('red', 'calls', t)
    else if (s.callsPct >= R.calls.yellowPct) add('yellow', 'calls', t)
  }
  const verdict = reasons.some(r => r.level === 'red') ? 'red' : reasons.some(r => r.level === 'yellow') ? 'yellow' : 'green'
  return { verdict, reasons }
}

// ── 즉시 알림 판정 ──
//   c: { gradeErrors, gradeErrorsMaxClass, deferred, open, openMaxClass } (최근 10분. 못 받음은 2~30분 전에 누른 미완료 시도)
//   돌려주는 값: [{ kind, title, body }]
export function alertKindsOf(c) {
  const A = ALERT_RULES
  const n = (v) => Number(v) || 0
  const out = []
  if (n(c.gradeErrors) >= A.grade_fail.total || n(c.gradeErrorsMaxClass) >= A.grade_fail.perClass) {
    out.push({ kind: 'grade_fail', title: ALERT_TITLES.grade_fail, body: `최근 10분 동안 채점 서버 오류가 ${n(c.gradeErrors)}건이에요. 한 학급에서 가장 많이 ${n(c.gradeErrorsMaxClass)}건이에요.` })
  }
  if (n(c.deferred) >= A.deferred.total) {
    out.push({ kind: 'deferred', title: ALERT_TITLES.deferred, body: `최근 10분 동안 점수 없이 먼저 저장된 글이 ${n(c.deferred)}건이에요.` })
  }
  if (n(c.open) >= A.no_result.total || n(c.openMaxClass) >= A.no_result.perClass) {
    out.push({ kind: 'no_result', title: ALERT_TITLES.no_result, body: `2분 넘게 결과를 못 받은 제출 시도가 ${n(c.open)}건이에요. 한 학급에서 가장 많이 ${n(c.openMaxClass)}건이에요.` })
  }
  return out
}
// 같은 종류를 마지막으로 보낸 시각(없으면 null)과 지금으로 보낼지 정한다
export function alertCooldownOk(lastSentMs, nowMs) {
  return !(Number.isFinite(lastSentMs) && nowMs - lastSentMs < ALERT_COOLDOWN_MS)
}

// ── 사실 문장 3줄 ──
export function compareWord(value, avg) {
  if (!(avg > 0)) return null
  const r = value / avg
  if (r >= 1.15) return '보다 많아요'
  if (r <= 0.85) return '보다 적어요'
  return '과 비슷해요'
}
export function buildLines(m, verdictResult) {
  const u = m.usage, s = m.stability
  const lines = []
  if (u.submissions === 0) lines.push('이 구간에는 제출이 없었어요.')
  else if (u.lessonAvg != null) lines.push(`제출 ${u.submissions}편으로 최근 ${u.lessonDays} 수업일 평균(${u.lessonAvg}편)${compareWord(u.submissions, u.lessonAvg)}.`)
  else lines.push(`제출 ${u.submissions}편이에요. 첫 글 ${u.first}편, 수정본 ${u.rewrite}편이에요.`)
  if (u.submissions === 0) lines.push(`새로 가입한 교사 ${m.growth.newTeachers}명, 새 학급 ${m.growth.newClasses}곳이에요.`)
  else if (s.attempts >= 10 && s.p95 != null) lines.push(`학급 ${u.classes}곳에서 학생 ${u.students}명이 썼고, 제출 100건 중 95건이 ${secText(s.p95)} 안에 결과를 받았어요.`)
  else lines.push(`학급 ${u.classes}곳에서 학생 ${u.students}명이 썼어요.`)
  const bad = (verdictResult.reasons || []).filter(r => r.level === verdictResult.verdict)
  if (bad.length > 0) lines.push(bad.slice(0, 2).map(r => r.text).join(' '))
  else lines.push(`채점 서버 오류 ${s.gradeErrors}건, 결과를 못 받은 시도 ${s.open}건, 보류로 저장된 글 ${s.deferred}건이에요.`)
  return lines
}

// ── 보고서 만들기 ──
//   data(전부 서버가 읽어 넘긴다. 본문·실명 없음):
//     profiles [{ id, class_id, role, created_at, deleted_at }]
//     classes  [{ id, name, school, teacher_id, created_at, deleted_at, peer_share_enabled, auto_supply_enabled }]
//     subsAll  [{ user_id, created_at }]                      전 기간, 삭제 안 된 글(조용한 학급·돌아온 학급·평균용)
//     subs     [{ id, user_id, topic_id, attempt, total_score, created_at, grading_ms, grade_reason, graded_with_model }]  최근 구간, 삭제 안 된 글
//     pendingRows [{ user_id, created_at, grade_status }]     지금 pending·failed인 글
//     reports  [{ user_id, report_reason, reported_at, report_resolved_at }]   신고된 글(삭제 안 된 것)
//     supplyTopicIds [id]   전국 챌린지 주제를 받아 만든 학급 주제
//     attempts [{ class_id, started_at, last_try_at, finished_at, wait_ms, tries, phase, precheck_ms, grade_ms, save_ms }]
//     logs     [{ created_at, class_id, error_type, ai_type }]
//     alerts   [{ detected_at }]            의심 교정
//     messages [{ teacher_id, sender_id, read_at, created_at }]   삭제 안 된 쪽지
//     feedback [{ user_id, created_at, replied_at }]              숨기지 않은 의견
//     peerViews [{ class_id, created_at }] · showcaseViews [{ student_id, created_at }] · tutor [{ user_id, used_date, count }]
//     examples [{ user_id, created_at }]    예시 작품이 만들어진 글
//     dbBytes, subsRows                     숫자 또는 null
//   opts: { nowMs, historical(지난 날짜 채우기면 true), prevBacklog(전날 보고의 쌓인 수), weekVerdicts(이번 주 앞 날짜들의 판정) }
export function buildReport(data, dateKey, opts = {}) {
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now()
  const historical = !!opts.historical
  const win = windowOf(dateKey)
  const startMs = win.startMs
  const endMs = Math.min(win.endMs, nowMs)
  const partial = endMs < win.endMs
  const inWin = (t) => t >= startMs && t < endMs

  const classById = new Map((data.classes || []).map(c => [c.id, c]))
  const profById = new Map((data.profiles || []).map(p => [p.id, p]))
  const classOf = (userId) => profById.get(userId)?.class_id || null
  const nameOf = (cid) => classLabel(classById.get(cid))
  const okClass = (cid) => !isTestClass(cid)

  // 학급별 제출 시각(전 기간) + 보고 날짜별 제출 수
  const classTimes = new Map()
  const countByKey = new Map()
  for (const r of data.subsAll || []) {
    const cid = classOf(r.user_id)
    if (!okClass(cid)) continue
    const t = ms(r.created_at)
    if (!Number.isFinite(t) || t >= endMs) continue
    inc(countByKey, dateKeyOfMs(t))
    if (!cid) continue
    if (!classTimes.has(cid)) classTimes.set(cid, [])
    classTimes.get(cid).push(t)
  }
  for (const arr of classTimes.values()) arr.sort((a, b) => a - b)

  // ── 2. 사용 ──
  const winSubs = (data.subs || []).filter(r => okClass(classOf(r.user_id)) && inWin(ms(r.created_at)))
  const perClass = new Map(), students = new Set(), teachers = new Set()
  let first = 0, rewrite = 0
  for (const r of winSubs) {
    const cid = classOf(r.user_id)
    if (Number(r.attempt) > 1) rewrite++; else first++
    students.add(r.user_id)
    if (cid) { inc(perClass, cid); const t = classById.get(cid)?.teacher_id; if (t) teachers.add(t) }
  }
  const lessonCounts = []
  for (let i = 1; i <= 30 && lessonCounts.length < LESSON_DAYS; i++) {
    const k = addDays(dateKey, -i)
    const wd = weekdayOf(k)
    const c = countByKey.get(k) || 0
    if (wd >= 1 && wd <= 5 && c >= LESSON_DAY_MIN) lessonCounts.push(c)
  }
  const usage = {
    submissions: winSubs.length, first, rewrite,
    classes: perClass.size, teachers: teachers.size, students: students.size,
    lessonAvg: lessonCounts.length >= 3 ? Math.round(lessonCounts.reduce((a, b) => a + b, 0) / lessonCounts.length) : null,
    lessonDays: lessonCounts.length,
    top: [...perClass.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cid, n]) => ({ name: nameOf(cid), n })),
  }

  // ── 3. 성장 ──
  const rangeGrowth = (fromMs, toMs) => {
    const inR = (iso) => { const t = ms(iso); return t >= fromMs && t < toMs }
    return {
      teachers: (data.profiles || []).filter(p => p.role === 'teacher' && inR(p.created_at)).length,
      classes: (data.classes || []).filter(c => okClass(c.id) && inR(c.created_at)).length,
      students: (data.profiles || []).filter(p => p.role === 'student' && okClass(p.class_id) && inR(p.created_at)).length,
    }
  }
  // 그 범위에 처음 쓴 학급 / 14일 넘게 쉬다가 그 범위에 다시 쓴 학급
  const firstAndReturned = (fromMs, toMs) => {
    const firstEver = [], returned = []
    for (const [cid, arr] of classTimes.entries()) {
      const idx = arr.findIndex(t => t >= fromMs)
      if (idx < 0 || arr[idx] >= toMs) continue
      if (idx === 0) firstEver.push({ name: nameOf(cid) })
      else {
        const gap = Math.floor((arr[idx] - arr[idx - 1]) / DAY_MS)
        if (gap > QUIET_DAYS) returned.push({ name: nameOf(cid), gapDays: gap })
      }
    }
    return { firstEver, returned }
  }
  const g = rangeGrowth(startMs, endMs)
  const fr = firstAndReturned(startMs, endMs)
  const classesByTeacher = new Map()
  for (const c of data.classes || []) { if (!c.teacher_id) continue; if (!classesByTeacher.has(c.teacher_id)) classesByTeacher.set(c.teacher_id, []); classesByTeacher.get(c.teacher_id).push(c.id) }
  const recentTeachers = (data.profiles || []).filter(p => p.role === 'teacher' && ms(p.created_at) >= endMs - 14 * DAY_MS && ms(p.created_at) < endMs)
  const activated = recentTeachers.filter(p => (classesByTeacher.get(p.id) || []).some(cid => okClass(cid) && (classTimes.get(cid) || []).length > 0)).length
  let active7 = 0
  const quietAll = []
  for (const [cid, arr] of classTimes.entries()) {
    const last = arr[arr.length - 1]
    if (last >= endMs - 7 * DAY_MS) active7++
    const c = classById.get(cid)
    if (last < endMs - QUIET_DAYS * DAY_MS && c && !c.deleted_at) quietAll.push({ name: nameOf(cid), last: kstDateOf(last), total: arr.length })
  }
  quietAll.sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : 0))
  const growth = {
    newTeachers: g.teachers, newClasses: g.classes, newStudents: g.students,
    totalTeachers: historical ? null : (data.profiles || []).filter(p => p.role === 'teacher' && !p.deleted_at).length,
    totalClasses: historical ? null : (data.classes || []).filter(c => okClass(c.id) && !c.deleted_at).length,
    totalStudents: historical ? null : (data.profiles || []).filter(p => p.role === 'student' && okClass(p.class_id) && !p.deleted_at).length,
    recentTeachers14: recentTeachers.length, recentTeachersActivated: activated,
    active7, quietCount: quietAll.length, quiet: quietAll.slice(0, QUIET_LIST_MAX),
    returned: fr.returned, firstEver: fr.firstEver,
  }

  // ── 4. 글쓰기 효과 ──
  const byUserTopic = new Map()
  for (const r of data.subs || []) {
    if (!okClass(classOf(r.user_id))) continue
    byUserTopic.set(`${r.user_id}|${r.topic_id}|${Number(r.attempt) || 1}`, r)
  }
  const firstPcts = []
  const rewriteStudents = new Set()
  let up = 0, same = 0, down = 0
  for (const r of winSubs) {
    const a = Number(r.attempt) || 1
    const scored = r.total_score != null && Number.isFinite(Number(r.total_score))
    if (a === 1) {
      const mx = Number(r.max_score)
      if (scored && mx > 0) firstPcts.push((Number(r.total_score) / mx) * 100)
    } else {
      rewriteStudents.add(r.user_id)
      const prev = byUserTopic.get(`${r.user_id}|${r.topic_id}|${a - 1}`)
      if (scored && prev && prev.total_score != null) {
        const d = Number(r.total_score) - Number(prev.total_score)
        if (d > 0) up++; else if (d < 0) down++; else same++
      }
    }
  }
  const effect = {
    firstN: firstPcts.length,
    firstAvgPct: firstPcts.length ? Math.round((firstPcts.reduce((a, b) => a + b, 0) / firstPcts.length) * 10) / 10 : null,
    students: students.size, rewriteStudents: rewriteStudents.size,
    rewriteStudentPct: students.size ? Math.round((rewriteStudents.size / students.size) * 100) : null,
    compared: up + same + down, up, same, down,
  }

  // ── 5. 기능별 쓰임 ──
  const supplySet = new Set(data.supplyTopicIds || [])
  const challengeClasses = new Set()
  let challengeSubs = 0
  for (const r of winSubs) { if (supplySet.has(r.topic_id)) { challengeSubs++; const cid = classOf(r.user_id); if (cid) challengeClasses.add(cid) } }
  const peerWin = (data.peerViews || []).filter(v => okClass(v.class_id) && inWin(ms(v.created_at)))
  const showWin = (data.showcaseViews || []).filter(v => okClass(classOf(v.student_id)) && inWin(ms(v.created_at)))
  const tutorDay = (data.tutor || []).filter(t => t.used_date === dateKey && okClass(classOf(t.user_id)))
  const features = {
    peerOn: historical ? null : (data.classes || []).filter(c => okClass(c.id) && !c.deleted_at && c.peer_share_enabled).length,
    peerViews: peerWin.length, peerViewClasses: new Set(peerWin.map(v => v.class_id)).size,
    challengeClasses: challengeClasses.size, challengeSubs, showcaseViews: showWin.length,
    autoSupplyOn: historical ? null : (data.classes || []).filter(c => okClass(c.id) && !c.deleted_at && c.auto_supply_enabled).length,
    quiz: null,   // 퀴즈는 푼 기록을 남기지 않는다
    tutorUsers: new Set(tutorDay.map(t => t.user_id)).size, tutorCount: tutorDay.reduce((a, t) => a + (Number(t.count) || 0), 0),
    examples: (data.examples || []).filter(r => okClass(classOf(r.user_id)) && inWin(ms(r.created_at))).length,
  }

  // ── 6. 속도와 안정 ──
  const winAtt = (data.attempts || []).filter(a => okClass(a.class_id) && inWin(ms(a.started_at))
    && !(!a.finished_at && nowMs - ms(a.last_try_at || a.started_at) < FRESH_MS))
  const finished = winAtt.filter(a => a.finished_at)
  const openByClass = new Map()
  let open = 0
  for (const a of winAtt) { if (!a.finished_at) { open++; inc(openByClass, a.class_id || 'unknown') } }
  let waitStat = stat(finished.map(a => num(a.wait_ms)))
  let over60 = finished.filter(a => num(a.wait_ms) > OVER_MS).length
  let attemptsN = winAtt.length
  let waitSource = 'attempts'
  if (winAtt.length === 0) {
    // 시도 기록이 없던 때(11/10 이전)는 글에 적힌 채점 시간으로 대신한다. 실패한 시도는 들어 있지 않다.
    const g2 = winSubs.map(r => num(r.grading_ms)).filter(v => Number.isFinite(v))
    waitStat = stat(g2); over60 = g2.filter(v => v > OVER_MS).length; attemptsN = g2.length
    waitSource = g2.length ? 'submissions' : 'none'
  }
  const deferredRows = winSubs.filter(r => r.grade_reason)
  const deferredBy = {}, deferredByClass = new Map()
  for (const r of deferredRows) { deferredBy[r.grade_reason] = (deferredBy[r.grade_reason] || 0) + 1; inc(deferredByClass, classOf(r.user_id) || 'unknown') }
  const errors = {}, gradeErrByClass = new Map(), errByClass = new Map()
  let gradeErrors = 0
  for (const l of data.logs || []) {
    if (!okClass(l.class_id) || !inWin(ms(l.created_at))) continue
    const t = l.error_type || 'unknown'
    errors[t] = (errors[t] || 0) + 1
    if (l.class_id) inc(errByClass, l.class_id)
    if (t === 'api_error' && /grading/i.test(String(l.ai_type || ''))) { gradeErrors++; inc(gradeErrByClass, l.class_id || 'unknown') }
  }
  let pendingNow = null, stalePending = null, failedGrades = null
  if (!historical) {
    const pr = (data.pendingRows || []).filter(r => okClass(classOf(r.user_id)))
    pendingNow = pr.filter(r => r.grade_status === 'pending').length
    stalePending = pr.filter(r => r.grade_status === 'pending' && nowMs - ms(r.created_at) > STALE_PENDING_MS).length
    failedGrades = pr.filter(r => r.grade_status === 'failed').length
  }
  const stability = {
    attempts: attemptsN, waitSource, p50: waitStat.p50, p95: waitStat.p95, max: waitStat.max, over60,
    open, openMaxClass: maxOf(openByClass),
    seg: {
      precheck: stat(finished.map(a => num(a.precheck_ms))),
      grade: stat(finished.map(a => num(a.grade_ms))),
      save: stat(finished.map(a => num(a.save_ms))),
    },
    deferred: deferredRows.length, deferredBy, deferredMaxClass: maxOf(deferredByClass),
    pendingNow, stalePending, failedGrades,
    errors, gradeErrors, gradeErrorsMaxClass: maxOf(gradeErrByClass),
    clusters: [...errByClass.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([cid, n]) => ({ name: nameOf(cid), n })),
  }

  // ── 7. 품질 신호 ──
  const reportsOk = (data.reports || []).filter(r => okClass(classOf(r.user_id)))
  const winReports = reportsOk.filter(r => inWin(ms(r.reported_at)))
  const reportTags = {}
  for (const r of winReports) { const t = reportTagOf(r.report_reason); reportTags[t] = (reportTags[t] || 0) + 1 }
  const quality = {
    reports: winReports.length, reportTags,
    alertsNew: (data.alerts || []).filter(a => inWin(ms(a.detected_at))).length,
    safety: winSubs.filter(r => r.graded_with_model === 'safety_blocked').length,
  }

  // ── 8. 답을 기다리는 것 ──
  const teacherMsgs = (data.messages || []).filter(m => m.sender_id && m.sender_id === m.teacher_id)
  const newMessages = teacherMsgs.filter(m => inWin(ms(m.created_at))).length
  // 의견은 보낸 사람 역할로 나눈다(교사가 보낸 것 / 그 밖은 학생 쪽. 계정이 지워져 역할을 모르는 것도 학생 쪽에 센다)
  const isTeacherFb = (f) => profById.get(f.user_id)?.role === 'teacher'
  const winFb = (data.feedback || []).filter(f => inWin(ms(f.created_at)))
  const newFeedback = winFb.length
  const newFeedbackTeacher = winFb.filter(isTeacherFb).length
  let backlog = null, delta = null, oldest = null
  if (!historical) {
    const unread = teacherMsgs.filter(m => !m.read_at)
    const noReply = (data.feedback || []).filter(f => !f.replied_at)
    const unresolved = reportsOk.filter(r => !r.report_resolved_at)
    const noReplyTeacher = noReply.filter(isTeacherFb).length
    backlog = { messages: unread.length, feedback: noReply.length, feedbackStudent: noReply.length - noReplyTeacher, feedbackTeacher: noReplyTeacher, reports: unresolved.length }
    backlog.total = backlog.messages + backlog.feedback + backlog.reports
    const cand = [
      ...unread.map(m => ({ t: ms(m.created_at), kind: '쪽지' })),
      ...noReply.map(f => ({ t: ms(f.created_at), kind: isTeacherFb(f) ? '교사 의견' : '학생 의견' })),
      ...unresolved.map(r => ({ t: ms(r.reported_at), kind: '신고' })),
    ].filter(x => Number.isFinite(x.t)).sort((a, b) => a.t - b.t)
    if (cand.length) oldest = { date: kstDateOf(cand[0].t), kind: cand[0].kind }
    const p = opts.prevBacklog
    if (p && Number.isFinite(p.total)) {
      delta = { messages: backlog.messages - (Number(p.messages) || 0), feedback: backlog.feedback - (Number(p.feedback) || 0), reports: backlog.reports - (Number(p.reports) || 0), total: backlog.total - p.total }
      // 전날 보고에 나눈 값이 있을 때만 나눈 증감을 낸다
      if (Number.isFinite(p.feedbackStudent) && Number.isFinite(p.feedbackTeacher)) { delta.feedbackStudent = backlog.feedbackStudent - p.feedbackStudent; delta.feedbackTeacher = backlog.feedbackTeacher - p.feedbackTeacher }
    }
  }
  const waiting = { newMessages, newFeedback, newFeedbackStudent: newFeedback - newFeedbackTeacher, newFeedbackTeacher, newReports: winReports.length, newTotal: newMessages + newFeedback + winReports.length, backlog, delta, oldest }

  // ── 9. 자원 여유 ──
  //   호출 기록 표가 없어 추정한다: 학급별로 (누른 횟수 + 첫 글 수[맞춤법 검사]) 합. 한도가 미국 서부 자정에 풀려 그 하루 단위로 센다.
  const ptDays = new Set([ptDay(startMs), ptDay(Math.max(startMs, endMs - 1))])
  const calls = new Map()
  let callsSource = 'attempts'
  for (const a of data.attempts || []) {
    const t = ms(a.started_at)
    if (!okClass(a.class_id) || !a.class_id || !Number.isFinite(t) || t >= endMs) continue
    const d = ptDay(t)
    if (!ptDays.has(d)) continue
    inc(calls, `${a.class_id}|${d}`, (Number(a.tries) || 1) + (a.phase === 'first' ? 1 : 0))
  }
  if (calls.size === 0) {
    callsSource = 'submissions'   // 시도 기록이 없던 때: 제출 수 × 2
    for (const r of data.subs || []) {
      const t = ms(r.created_at), cid = classOf(r.user_id)
      if (!okClass(cid) || !cid || !Number.isFinite(t) || t >= endMs) continue
      const d = ptDay(t)
      if (!ptDays.has(d)) continue
      inc(calls, `${cid}|${d}`, 2)
    }
  }
  let callsTop = null
  for (const [k, n] of calls.entries()) { if (!callsTop || n > callsTop.calls) callsTop = { name: nameOf(k.split('|')[0]), calls: n, pct: Math.round((n / CALL_LIMIT) * 100) } }
  const dbBytes = historical || !Number.isFinite(data.dbBytes) ? null : data.dbBytes
  const resources = {
    callsTop, callsLimit: CALL_LIMIT, callsSource,
    dbBytes, dbLimitBytes: DB_LIMIT_BYTES, dbPct: dbBytes == null ? null : Math.round((dbBytes / DB_LIMIT_BYTES) * 1000) / 10,
    subsRows: historical || !Number.isFinite(data.subsRows) ? null : data.subsRows,
  }

  // ── 판정 ──
  const judged = judgeOps({
    gradeErrors, gradeErrorsMaxClass: stability.gradeErrorsMaxClass,
    attempts: attemptsN, over60, p95: waitStat.p95,
    open, openMaxClass: stability.openMaxClass,
    deferred: stability.deferred, deferredMaxClass: stability.deferredMaxClass,
    stale: historical ? null : (stalePending || 0) + (failedGrades || 0),
    callsPct: callsTop ? callsTop.pct : null,
  })

  // ── 10. 주간 정리(금요일 보고에만) ──
  let weekly = null
  if (weekdayOf(dateKey) === 5) {
    const days = [-4, -3, -2, -1, 0].map(i => { const k = addDays(dateKey, i); return { date: k, n: countByKey.get(k) || 0 } })
    const total = days.reduce((a, d) => a + d.n, 0)
    const lastTotal = [-11, -10, -9, -8, -7].reduce((a, i) => a + (countByKey.get(addDays(dateKey, i)) || 0), 0)
    const wStart = windowOf(addDays(dateKey, -4)).startMs
    const wg = rangeGrowth(wStart, endMs)
    const wf = firstAndReturned(wStart, endMs)
    const verdicts = [...(opts.weekVerdicts || []), judged.verdict]
    const reds = verdicts.filter(v => v === 'red').length, yellows = verdicts.filter(v => v === 'yellow').length
    weekly = {
      days, total, lastTotal,
      diffPct: lastTotal > 0 ? Math.round(((total - lastTotal) / lastTotal) * 100) : null,
      news: [
        `이번 주에 교사 ${wg.teachers}명, 학급 ${wg.classes}곳, 학생 ${wg.students}명이 새로 생겼어요.`,
        `처음 글을 쓴 학급이 ${wf.firstEver.length}곳, 14일 넘게 쉬다가 다시 쓴 학급이 ${wf.returned.length}곳이에요.`,
        `이번 주 판정은 빨강 ${reds}일, 노랑 ${yellows}일이에요.`,
      ],
    }
  }

  const metrics = {
    v: 1,
    window: { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), partial },
    historical,
    headline: { submissions: usage.submissions, classes: usage.classes, p95Ms: waitStat.p95, newWaiting: waiting.newTotal },
    reasons: judged.reasons,
    usage, growth, effect, features, stability, quality, waiting, resources, weekly,
  }
  return { report_date: dateKey, verdict: judged.verdict, metrics, lines: buildLines(metrics, judged) }
}

// ── 화면 구성("자세히"에 펼치는 2~10번). 값은 전부 글자로 만들어 넘긴다. ──
const numOr = (v, unit = '') => (v == null ? '–' : `${v}${unit}`)
const NO_PAST = '지난 날짜 보고에는 없어요'
const signed = (v) => (v > 0 ? `+${v}` : `${v}`)
export function sectionsOf(m) {
  if (!m || !m.usage) return []
  const u = m.usage, g = m.growth, e = m.effect, f = m.features, s = m.stability, q = m.quality, w = m.waiting, r = m.resources
  const past = !!m.historical
  const out = []
  out.push({ key: 'usage', title: '2. 사용', rows: [
    { label: '제출 수', value: `${u.submissions}편 (첫 글 ${u.first} · 수정본 ${u.rewrite})`, info: '전날 15:00부터 이날 15:00까지 낸 글이에요. 휴지통에 간 글과 시험 반은 빼요.' },
    { label: '쓴 학급 · 교사 · 학생', value: `${u.classes}곳 · ${u.teachers}명 · ${u.students}명`, info: '이 구간에 글이 한 편이라도 나온 학급, 그 담임, 글을 낸 학생 수예요.' },
    { label: '최근 수업일 평균', value: u.lessonAvg == null ? '비교할 수업일이 모자라요' : `${u.lessonAvg}편 (${u.lessonDays}일 평균)`, info: '수업일은 평일이면서 제출이 20편 이상인 날이에요. 앞선 30일에서 가까운 7일을 골라요.' },
  ], lists: [{ title: '많이 쓴 학급', items: u.top.map(t => `${t.name} ${t.n}편`), empty: '쓴 학급이 없어요' }] })
  out.push({ key: 'growth', title: '3. 성장', rows: [
    { label: '새 교사 · 학급 · 학생', value: `${g.newTeachers}명 · ${g.newClasses}곳 · ${g.newStudents}명`, info: '이 구간에 가입한 교사, 만든 학급, 가입한 학생이에요.' },
    { label: '누계', value: past ? '–' : `교사 ${g.totalTeachers}명 · 학급 ${g.totalClasses}곳 · 학생 ${g.totalStudents}명`, info: past ? NO_PAST : '보고를 만든 때의 전체 수예요. 삭제한 계정과 학급은 빼요.' },
    { label: '첫 수업까지 간 새 교사', value: `${g.recentTeachersActivated}명 / ${g.recentTeachers14}명`, info: '최근 14일 안에 가입한 교사 가운데, 자기 학급에서 글이 한 편이라도 나온 교사 수예요.' },
    { label: '최근 7일 활동 학급', value: `${g.active7}곳`, info: '최근 7일 안에 글이 한 편이라도 나온 학급 수예요.' },
    { label: '14일 넘게 조용한 학급', value: `${g.quietCount}곳`, info: '전에는 글이 나왔는데 14일 넘게 제출이 없는 학급이에요. 아래 목록은 최근에 멈춘 순서로 60곳까지 보여 줘요.' },
    { label: '다시 돌아온 학급', value: `${g.returned.length}곳`, info: '14일 넘게 쉬다가 이 구간에 다시 글이 나온 학급이에요.' },
  ], lists: [
    { title: '다시 돌아온 학급', items: g.returned.map(x => `${x.name} (${x.gapDays}일 만에)`), empty: '없어요' },
    { title: '처음 글을 쓴 학급', items: g.firstEver.map(x => x.name), empty: '없어요' },
    { title: '14일 넘게 조용한 학급', items: g.quiet.map(x => `${x.name} · 마지막 제출 ${x.last} · 누적 ${x.total}편`), empty: '없어요', collapsed: true },
  ] })
  out.push({ key: 'effect', title: '4. 글쓰기 효과', rows: [
    { label: '첫 글 평균 점수', value: e.firstAvgPct == null ? '–' : `${e.firstAvgPct}점 (100점으로 바꾼 값, ${e.firstN}편)`, info: '이 구간 첫 글의 점수를 만점 대비 100점으로 바꿔 평균했어요. 점수가 없는 글은 빼요.' },
    { label: '수정본을 낸 학생', value: e.rewriteStudentPct == null ? '–' : `${e.rewriteStudentPct}% (${e.rewriteStudents}명 / ${e.students}명)`, info: '이 구간에 글을 낸 학생 가운데 수정본을 한 번이라도 낸 학생 비율이에요.' },
    { label: '수정 뒤 점수', value: e.compared === 0 ? '비교할 수정본이 없어요' : `오름 ${Math.round((e.up / e.compared) * 100)}% · 같음 ${Math.round((e.same / e.compared) * 100)}% · 내림 ${Math.round((e.down / e.compared) * 100)}% (${e.compared}편)`, info: '수정본 점수를 바로 앞 글 점수와 비교했어요. 두 글 모두 점수가 있는 경우만 세요.' },
  ] })
  out.push({ key: 'features', title: '5. 기능별 쓰임', rows: [
    { label: '글 모음', value: `켠 학급 ${numOr(f.peerOn, '곳')} · 열람 ${f.peerViews}회 (${f.peerViewClasses}개 학급)`, info: '친구 글 모음을 켠 학급 수와 이 구간에 열어 본 횟수예요. 켠 학급 수는 지난 날짜 보고에는 없어요.' },
    { label: '전국 챌린지', value: `참여 학급 ${f.challengeClasses}곳 · 글 ${f.challengeSubs}편 · 상위 글 열람 ${f.showcaseViews}회`, info: '전국 주제로 글이 나온 학급 수와 글 수, 상위 글을 열어 본 횟수예요.' },
    { label: '자동 받기 켠 학급', value: numOr(f.autoSupplyOn, '곳'), info: past ? NO_PAST : '전국 주제를 자동으로 받도록 켜 둔 학급 수예요.' },
    { label: '맞춤법 퀴즈', value: '기록 없음', info: '퀴즈는 푼 기록을 남기지 않아서 셀 수 없어요.' },
    { label: '챗봇', value: `${f.tutorUsers}명 · ${f.tutorCount}회`, info: '보고 날짜 하루 동안 챗봇을 쓴 학생 수와 횟수예요. 이 줄만 15시 구간이 아니라 날짜 기준이에요.' },
    { label: '예시 작품', value: `${f.examples}편`, info: '이 구간에 낸 글 가운데 예시 작품이 만들어진 글 수예요. 열어 본 횟수는 기록이 없어요.' },
  ] })
  const segLine = (x) => (x.n ? `보통 ${secText(x.p50)} · 95% ${secText(x.p95)}` : '–')
  const errText = Object.keys(s.errors).length ? Object.entries(s.errors).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' · ') : '없어요'
  out.push({ key: 'stability', title: '6. 속도와 안정', rows: [
    { label: '진짜 대기', value: s.attempts ? `보통 ${secText(s.p50)} · 95% ${secText(s.p95)} · 가장 오래 ${secText(s.max)}` : '–', info: s.waitSource === 'submissions' ? '시도 기록이 없던 때라 글에 적힌 채점 시간으로 대신했어요. 실패한 시도는 들어 있지 않아요.' : '학생이 [제출]을 처음 누른 때부터 결과를 받을 때까지예요. 95%는 100건 중 95건이 이 시간 안에 끝났다는 뜻이에요.' },
    { label: '1분 넘음', value: `${s.over60}건 / ${s.attempts}건`, info: '결과를 받기까지 1분 넘게 걸린 제출 수예요.' },
    { label: '결과 못 받음', value: `${s.open}건 (한 학급 최대 ${s.openMaxClass}건)`, info: '누른 뒤 결과를 끝내 받지 못한 제출 시도예요. 방금 누른 진행 중 시도는 빼요.' },
    { label: '구간: 제출 전 조회', value: segLine(s.seg.precheck), info: '[제출]을 누른 뒤 이미 낸 글이 있는지 확인하는 조회 시간이에요.' },
    { label: '구간: 채점', value: segLine(s.seg.grade), info: 'AI 채점 호출에 걸린 시간이에요.' },
    { label: '구간: 저장', value: segLine(s.seg.save), info: '채점 결과를 받은 뒤 글을 저장하는 시간이에요.' },
    { label: '보류로 저장된 글', value: `${s.deferred}건${Object.keys(s.deferredBy).length ? ` (${Object.entries(s.deferredBy).map(([k, n]) => `${k} ${n}`).join(' · ')})` : ''}`, info: 'AI가 바빠서 점수 없이 먼저 저장된 글이에요. 뒤에 채점된 글도 세요.' },
    { label: '지금 점수를 기다리는 글', value: past ? '–' : `${s.pendingNow}건 (15분 넘음 ${s.stalePending}건 · 채점 실패 ${s.failedGrades}건)`, info: past ? NO_PAST : '보고를 만든 때 아직 점수가 없는 보류 글이에요.' },
    { label: '오류 기록', value: errText, info: 'error_logs에 쌓인 종류별 건수예요. 채점 서버 오류는 api_error 가운데 채점 호출만 따로 세요.' },
    { label: '채점 서버 오류', value: `${s.gradeErrors}건 (한 학급 최대 ${s.gradeErrorsMaxClass}건)`, info: '채점 호출이 서버에서 실패한 횟수예요. 판정에 쓰는 숫자예요.' },
  ], lists: [{ title: '오류가 3건 이상 몰린 학급', items: s.clusters.map(c => `${c.name} ${c.n}건`), empty: '없어요' }] })
  out.push({ key: 'quality', title: '7. 품질 신호', rows: [
    { label: '신고', value: `${q.reports}건${Object.keys(q.reportTags).length ? ` (${Object.entries(q.reportTags).map(([k, n]) => `${k} ${n}`).join(' · ')})` : ''}`, info: '이 구간에 학생이 피드백을 신고한 건수와 사유별 수예요.' },
    { label: '의심 교정 신규', value: `${q.alertsNew}건`, info: '이 구간에 자동 감시가 새로 잡은 맞춤법 오교정 의심 건수예요.' },
    { label: '안전 필터', value: `${q.safety}건`, info: 'AI 안전 필터가 채점을 거절해 점수 없이 저장된 글 수예요.' },
  ] })
  const b = w.backlog, d = w.delta
  const withDelta = (v, dv) => (d && Number.isFinite(dv) ? `${v}건 (${signed(dv)})` : `${v}건`)
  out.push({ key: 'waiting', title: '8. 답을 기다리는 것', rows: [
    { label: '오늘 새로 온 것', value: `${w.newTotal}건 (교사 쪽지 ${w.newMessages} · 학생 의견 ${w.newFeedbackStudent ?? w.newFeedback} · 교사 의견 ${w.newFeedbackTeacher ?? 0} · 신고 ${w.newReports})`, info: '이 구간 안에 들어온 교사 쪽지, 의견, 신고예요. 의견은 보낸 사람이 학생인지 교사인지로 나눠요.' },
    { label: '쌓인 것', value: b ? `${withDelta(b.total, d?.total)}` : '–', info: b ? '보고를 만든 때 아직 답이 없는 것의 합이에요. 괄호는 전날 보고와의 차이예요.' : NO_PAST },
    { label: '읽지 않은 교사 쪽지', value: b ? withDelta(b.messages, d?.messages) : '–', info: b ? '교사가 보낸 쪽지 가운데 관리자가 아직 읽지 않은 것이에요.' : NO_PAST },
    { label: '답 없는 학생 의견', value: b ? withDelta(b.feedbackStudent ?? b.feedback, d?.feedbackStudent) : '–', info: b ? '학생이 보낸 의견 가운데 숨기지 않았고 답글이 없는 것이에요. 계정이 지워져 보낸 사람을 모르는 것도 여기에 세요.' : NO_PAST },
    { label: '답 없는 교사 의견', value: b ? withDelta(b.feedbackTeacher ?? 0, d?.feedbackTeacher) : '–', info: b ? '교사가 보낸 의견 가운데 숨기지 않았고 답글이 없는 것이에요.' : NO_PAST },
    { label: '미해결 신고', value: b ? withDelta(b.reports, d?.reports) : '–', info: b ? '신고된 글 가운데 처리 표시가 없는 것이에요.' : NO_PAST },
    { label: '가장 오래 기다린 것', value: w.oldest ? `${w.oldest.date}에 온 ${w.oldest.kind}` : (b ? '없어요' : '–'), info: b ? '답이 없는 것 가운데 가장 먼저 들어온 날짜예요.' : NO_PAST },
  ] })
  const mb = (v) => `${Math.round(v / 1024 / 1024)}MB`
  out.push({ key: 'resources', title: '9. 자원 여유', rows: [
    { label: '하루 AI 호출 추정 최고 학급', value: r.callsTop ? `${r.callsTop.name} 약 ${r.callsTop.calls}회 (한도 ${r.callsLimit}회의 ${r.callsTop.pct}%)` : '–', info: r.callsSource === 'submissions' ? '추정값이에요. 시도 기록이 없던 때라 제출 수의 2배로 셌어요.' : '추정값이에요. 누른 횟수에 첫 글 수(맞춤법 검사)를 더했어요. 한도가 풀리는 미국 서부 하루 단위예요.' },
    { label: 'DB 용량', value: r.dbBytes == null ? '–' : `${mb(r.dbBytes)} / ${mb(r.dbLimitBytes)} (${r.dbPct}%)`, info: past ? NO_PAST : '보고를 만든 때의 DB 전체 용량이에요. 한도는 무료 요금제 500MB로 가정했어요.' },
    { label: 'submissions 줄 수', value: r.subsRows == null ? '–' : `${r.subsRows.toLocaleString('en-US')}줄`, info: past ? NO_PAST : '글 표의 전체 줄 수예요. 휴지통에 간 글도 들어 있어요.' },
  ] })
  if (m.weekly) {
    const wk = m.weekly
    const wdName = ['일', '월', '화', '수', '목', '금', '토']
    out.push({ key: 'weekly', title: '10. 주간 정리', rows: [
      { label: '한 주 합계', value: `${wk.total}편 (지난주 ${wk.lastTotal}편${wk.diffPct == null ? '' : `, ${signed(wk.diffPct)}%`})`, info: '월요일 보고부터 금요일 보고까지의 제출 수 합이에요.' },
      { label: '요일별 제출', value: wk.days.map(x => `${wdName[weekdayOf(x.date)]} ${x.n}`).join(' · '), info: '보고 날짜 기준이에요. 전날 15시 뒤에 낸 글은 다음 날에 들어가요.' },
    ], lists: [{ title: '새로 생긴 일', items: wk.news, empty: '없어요' }] })
  }
  return out
}

export const VERDICT_LABEL = { green: '🟢 평소와 같아요', yellow: '🟡 살펴볼 것이 있어요', red: '🔴 문제가 있었어요' }
export function headlineOf(m) {
  const h = (m && m.headline) || {}
  return [
    { label: '제출 수', value: `${h.submissions ?? '–'}편`, info: '전날 15:00부터 이날 15:00까지 낸 글 수예요.' },
    { label: '쓴 학급', value: `${h.classes ?? '–'}곳`, info: '이 구간에 글이 나온 학급 수예요.' },
    { label: '거의 모두(95%) 대기', value: secText(h.p95Ms), info: '제출 100건 중 95건이 이 시간 안에 결과를 받았어요.' },
    { label: '오늘 새로 온 것', value: `${h.newWaiting ?? '–'}건`, info: '이 구간에 들어온 교사 쪽지, 의견, 신고의 합이에요. 쌓인 것은 자세히 8번에 있어요.' },
  ]
}
export { mdOf }
