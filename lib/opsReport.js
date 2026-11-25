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
export const ALERT_TITLE_PREFIX = '🚨 경보'
export const ALERT_BAND_PATTERN = '%경보%'   // 카드 빨간 띠가 잡는 제목(실제 경보와 연습 경보 모두 "경보"가 들어간다)
// step689: 관리자 [알림 시험 보내기]용. 제목이 실제 알림과 달라서 30분 중복 판정(제목 일치)에 걸리지도, 실제 알림을 막지도 않는다.
export const ALERT_TEST_MARK = '[연습]'
export const ALERT_TEST_TITLE = `${ALERT_TEST_MARK} 경보가 잘 뜨는지 확인하는 중이에요`
export const ALERT_TEST_BODY = '관리자가 눌러서 보낸 연습용 경보예요. 실제 문제가 아니에요.'
export const ALERT_TITLES = {
  grade_fail: `${ALERT_TITLE_PREFIX}: 채점 실패가 몰리고 있어요`,
  deferred: `${ALERT_TITLE_PREFIX}: AI가 바빠서 점수가 늦어지는 글이 늘고 있어요`,
  no_result: `${ALERT_TITLE_PREFIX}: 결과를 못 받는 학생이 있어요`,
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
  const geTxt = `채점 실패가 ${ge}번 있었고, 한 반에서 가장 많이 ${gc}번이었어요.`
  if (ge >= R.gradeErrors.red || gc >= R.gradeErrors.redClass) add('red', 'gradeErrors', geTxt)
  else if (ge >= R.gradeErrors.yellow) add('yellow', 'gradeErrors', geTxt)
  const att = n(s.attempts), o60 = n(s.over60)
  const o60pct = att > 0 ? (o60 / att) * 100 : 0
  const o60txt = `제출 ${att}번 중 ${o60}번은 결과를 1분 넘게 기다렸어요.`
  if (o60 >= R.over60.redN && o60pct >= R.over60.redPct) add('red', 'over60', o60txt)
  else if (o60 >= R.over60.yellowN && o60pct >= R.over60.yellowPct) add('yellow', 'over60', o60txt)
  if (att >= R.p95.minN && Number.isFinite(s.p95)) {
    const t = `거의 모든 학생이 결과를 받기까지 ${secText(s.p95)}가 걸렸어요.`
    if (s.p95 >= R.p95.redMs) add('red', 'p95', t)
    else if (s.p95 >= R.p95.yellowMs) add('yellow', 'p95', t)
  }
  const op = n(s.open), oc = n(s.openMaxClass)
  const opTxt = `결과를 못 받은 경우가 ${op}번 있었고, 한 반에서 가장 많이 ${oc}번이었어요.`
  if (op >= R.open.red || oc >= R.open.redClass) add('red', 'open', opTxt)
  else if (op >= R.open.yellow || oc >= R.open.yellowClass) add('yellow', 'open', opTxt)
  const df = n(s.deferred), dc = n(s.deferredMaxClass)
  const dfTxt = `AI가 바빠서 나중에 채점한 글이 ${df}편 있었어요.`
  if (df >= R.deferred.red || dc >= R.deferred.redClass) add('red', 'deferred', dfTxt)
  else if (df >= R.deferred.yellow) add('yellow', 'deferred', dfTxt)
  if (s.stale != null) {
    const st = n(s.stale)
    const t = `점수를 15분 넘게 기다리거나 끝내 채점하지 못한 글이 지금 ${st}편 있어요.`
    if (st >= R.stale.red) add('red', 'stale', t)
    else if (st >= R.stale.yellow) add('yellow', 'stale', t)
  }
  if (s.callsPct != null && Number.isFinite(s.callsPct)) {
    const t = `한 반이 구글 AI 하루 한도의 ${Math.round(s.callsPct)}%를 쓴 것으로 어림돼요.`
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
    out.push({ kind: 'grade_fail', title: ALERT_TITLES.grade_fail, body: `최근 10분 동안 채점 실패가 ${n(c.gradeErrors)}번 있었어요. 한 반에서 가장 많이 ${n(c.gradeErrorsMaxClass)}번이에요.` })
  }
  if (n(c.deferred) >= A.deferred.total) {
    out.push({ kind: 'deferred', title: ALERT_TITLES.deferred, body: `최근 10분 동안 AI가 바빠서 점수 없이 먼저 받아 둔 글이 ${n(c.deferred)}편이에요.` })
  }
  if (n(c.open) >= A.no_result.total || n(c.openMaxClass) >= A.no_result.perClass) {
    out.push({ kind: 'no_result', title: ALERT_TITLES.no_result, body: `제출을 누르고 2분 넘게 결과를 못 받은 경우가 ${n(c.open)}번이에요. 한 반에서 가장 많이 ${n(c.openMaxClass)}번이에요.` })
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
  if (u.submissions === 0) lines.push('이 기간에는 쓴 글이 없었어요.')
  else if (u.lessonAvg != null) lines.push(`글 ${u.submissions}편을 썼어요. 평소 하루 평균(${u.lessonAvg}편)${compareWord(u.submissions, u.lessonAvg)}.`)
  else lines.push(`글 ${u.submissions}편을 썼어요. 처음 낸 글 ${u.first}편, 고쳐 낸 글 ${u.rewrite}편이에요.`)
  if (u.submissions === 0) lines.push(`새로 온 선생님 ${m.growth.newTeachers}명, 새 반 ${m.growth.newClasses}곳이에요.`)
  else if (s.attempts >= 10 && s.p95 != null) lines.push(`반 ${u.classes}곳에서 학생 ${u.students}명이 썼고, 거의 모두 ${secText(s.p95)} 안에 결과를 받았어요.`)
  else lines.push(`반 ${u.classes}곳에서 학생 ${u.students}명이 썼어요.`)
  const bad = (verdictResult.reasons || []).filter(r => r.level === verdictResult.verdict)
  if (bad.length > 0) lines.push(bad.slice(0, 2).map(r => r.text).join(' '))
  else lines.push(`채점 실패 ${s.gradeErrors}번, 결과를 못 받은 경우 ${s.open}번, AI가 바빠서 나중에 채점한 글 ${s.deferred}편이에요.`)
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
      ...unread.map(m => ({ t: ms(m.created_at), kind: '선생님 쪽지' })),
      ...noReply.map(f => ({ t: ms(f.created_at), kind: isTeacherFb(f) ? '선생님 의견' : '학생 의견' })),
      ...unresolved.map(r => ({ t: ms(r.reported_at), kind: '학생 신고' })),
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
        `이번 주에 선생님 ${wg.teachers}명, 반 ${wg.classes}곳, 학생 ${wg.students}명이 새로 생겼어요.`,
        `처음 글을 쓴 반이 ${wf.firstEver.length}곳, 2주 넘게 쉬다가 다시 쓰기 시작한 반이 ${wf.returned.length}곳이에요.`,
        `이번 주에 문제가 있었던 날은 ${reds}일, 살펴볼 일이 있었던 날은 ${yellows}일이에요.`,
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

// ── 화면 구성(step691: 용어·가독성 정리. 표시만 바꾼다. 집계·판정·저장 구조는 그대로) ──
//   원칙: 영어·개발 용어·표 이름을 화면에 쓰지 않는다. 반은 "곳", 사람은 "명", 글은 "편", 시도는 "번".
//         한 줄에 값 하나. 값이 없는 줄은 숨긴다. 0은 흐리게, 판정에 걸린 값은 색과 굵기로.
//   저장된 문장(lines)·사유(metrics.reasons)는 옛 용어일 수 있어 화면은 수치로 다시 조립한다(displayLines·judgeFromMetrics).
export const VERDICT_LABEL = { green: '🟢 평소와 같아요', yellow: '🟡 살펴볼 일이 있었어요', red: '🔴 문제가 있었어요' }
export const VERDICT_LEGEND = '초록 평소 · 노랑 살펴볼 일 · 빨강 문제'
export const HIDDEN_NOTE = '지난 날짜라 남아 있지 않은 값은 숨겼어요'
const WD_NAMES = ['일', '월', '화', '수', '목', '금', '토']
export function dateLabel(dateKey) { return `${mdOf(dateKey)}(${WD_NAMES[weekdayOf(dateKey)]})` }
export function titleOf(dateKey, nowMs) { return dateKey === kstToday(nowMs) ? '📋 오늘 운영 보고' : '📋 운영 보고' }
export function periodText(dateKey, nowMs) {
  if (dateKey === kstToday(nowMs)) return '어제 오후 3시부터 오늘 오후 3시까지의 기록이에요.'
  return `${dateLabel(addDays(dateKey, -1))} 오후 3시부터 ${dateLabel(dateKey)} 오후 3시까지의 기록이에요.`
}
export function madeText(source, createdAtIso) {
  if (source === 'backfill') return '나중에 채운 보고예요'
  const t = Date.parse(createdAtIso)
  if (!Number.isFinite(t)) return ''
  const k = new Date(t + KST_MS).toISOString()
  const when = `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))} ${k.slice(11, 16)}`
  return source === 'manual' ? `${when}에 새로 고쳤어요` : `${when}에 자동으로 만들었어요`
}
export const PARTIAL_NOTE = '아직 오후 3시 전이라 오늘 하루가 다 들어 있지 않아요.'

// 옛 보고에 글자로 저장된 말(주간 정리의 "새로 생긴 일", 가장 오래 기다린 것의 종류)을 새 용어로 바꾼다
export function modernize(text) {
  return String(text || '')
    .replace(/이번 주 판정은 빨강 (\d+)일, 노랑 (\d+)일이에요\./, '이번 주에 문제가 있었던 날은 $1일, 살펴볼 일이 있었던 날은 $2일이에요.')
    .replace(/14일 넘게 쉬다가 다시 쓴 학급/g, '2주 넘게 쉬다가 다시 쓰기 시작한 반')
    .replace(/교사/g, '선생님').replace(/학급/g, '반')
}
const OLDEST_KIND = { '쪽지': '선생님 쪽지', '신고': '학생 신고', '의견': '의견', '학생 의견': '학생 의견', '교사 의견': '선생님 의견' }

const ERROR_TYPES = {
  api_error: ['AI 서버 오류', 'AI에게 맡긴 일이 서버에서 실패한 경우예요. 채점이 아닌 다른 일도 들어 있어요.'],
  ai_call: ['학생 화면 AI 오류', '화면에서 AI에게 맡긴 일이 실패했다고 뜬 경우예요.'],
  auth_bounce: ['로그인 튕김', '로그인 정보를 확인하지 못해 로그인 화면으로 돌아간 경우예요.'],
  js_error: ['화면 오류', '화면이 움직이다가 잠깐 문제가 생긴 경우예요.'],
  notify_fail: ['알림 보내기 실패', '선생님이나 학생에게 알림을 보내려다 실패한 경우예요.'],
  strict_backfill: ['맞춤법 보완 실패', '맞춤법 밑줄을 나중에 채우려다 실패한 경우예요. 글과 점수는 그대로예요.'],
  supply_ranking: ['전국 챌린지 순위 오류', '전국 챌린지 순위를 불러오다 실패한 경우예요.'],
}
const ERROR_OTHER = ['그 밖의 오류', '위 종류에 들지 않는 오류예요.']
export function errorTypeLabel(type) { return (ERROR_TYPES[type] || ERROR_OTHER)[0] }

// 저장된 수치로 판정을 다시 계산한다(규칙은 judgeOps 그대로). 새 용어의 사유 문장을 얻는 용도다.
export function judgeInputsOf(m) {
  const s = m.stability || {}, past = !!m.historical
  return {
    gradeErrors: s.gradeErrors, gradeErrorsMaxClass: s.gradeErrorsMaxClass,
    attempts: s.attempts, over60: s.over60, p95: s.p95,
    open: s.open, openMaxClass: s.openMaxClass,
    deferred: s.deferred, deferredMaxClass: s.deferredMaxClass,
    stale: past || s.stalePending == null ? null : (s.stalePending || 0) + (s.failedGrades || 0),
    callsPct: m.resources && m.resources.callsTop ? m.resources.callsTop.pct : null,
  }
}
export function judgeFromMetrics(m) { return judgeOps(judgeInputsOf(m)) }
export function displayLines(m) { return m && m.usage ? buildLines(m, judgeFromMetrics(m)) : [] }

const cnt = (v) => Number(v).toLocaleString('en-US')
const fullDate = (key) => `${Number(key.slice(0, 4))}년 ${Number(key.slice(5, 7))}월 ${Number(key.slice(8, 10))}일`
const pctOf = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)

export function headlineOf(m) {
  const h = (m && m.headline) || {}
  const flags = {}
  if (m && m.usage) for (const r of judgeFromMetrics(m).reasons) flags[r.key] = r.level
  return [
    { label: '오늘 쓴 글', value: h.submissions == null ? '없어요' : `${cnt(h.submissions)}편`, info: '학생들이 낸 글 수예요. 처음 낸 글과 고쳐 낸 글을 합쳤어요.' },
    { label: '쓴 반', value: h.classes == null ? '없어요' : `${cnt(h.classes)}곳`, info: '글이 한 편이라도 나온 반의 수예요.' },
    { label: '결과까지 걸린 시간(거의 모두)', value: h.p95Ms == null ? '기록 없음' : secText(h.p95Ms), info: '학생 100명 중 95명은 이 시간 안에 결과를 받았어요.', tone: flags.p95 || null },
    { label: '새로 온 문의', value: h.newWaiting == null ? '없어요' : `${cnt(h.newWaiting)}건`, info: '새로 들어온 선생님 쪽지, 의견, 학생 신고를 합친 수예요.' },
  ]
}

// 부분 목록. 돌려주는 값:
//   [{ key, title, summary, rows: [{ heading } | { label, value, info, tone('zero'|'yellow'|'red'|null), note, sub }], lists: [{ title, items, collapsed }], hiddenNote }]
export function sectionsOf(m) {
  if (!m || !m.usage) return []
  const u = m.usage, g = m.growth, e = m.effect, f = m.features, s = m.stability, q = m.quality, w = m.waiting, r = m.resources
  const past = !!m.historical
  const flags = {}
  for (const x of judgeFromMetrics(m).reasons) flags[x.key] = x.level
  const row = (label, value, info, o = {}) => (value == null ? null : { label, value, info, tone: o.flag || (o.n === 0 ? 'zero' : null), note: o.note || null, sub: !!o.sub })
  const head = (label) => ({ heading: label })
  const list = (title, items, collapsed) => ({ title, items: items || [], collapsed: !!collapsed })
  const sec = (key, title, summary, items, lists = []) => {
    const hidden = items.filter(x => x === null).length
    const kept = items.filter(Boolean)
    // 아래에 값이 하나도 남지 않은 묶음 제목은 뺀다
    const rows = kept.filter((x, i) => !x.heading || (kept[i + 1] && kept[i + 1].sub))
    return { key, title, summary, rows, lists: lists.filter(l => l.items.length > 0), hiddenNote: past && hidden > 0 }
  }
  const out = []

  // 얼마나 썼나요
  out.push(sec('usage', '얼마나 썼나요',
    u.submissions === 0 ? '이 기간에는 쓴 글이 없었어요.' : `반 ${cnt(u.classes)}곳에서 학생 ${cnt(u.students)}명이 글 ${cnt(u.submissions)}편을 썼어요.`, [
      row('쓴 글', `${cnt(u.submissions)}편`, '학생들이 낸 글 수예요. 처음 낸 글과 고쳐 낸 글을 합쳤어요.', { n: u.submissions }),
      row('그중 처음 낸 글', `${cnt(u.first)}편`, '주제마다 학생이 처음으로 낸 글이에요.', { n: u.first, sub: true }),
      row('고쳐 낸 글', `${cnt(u.rewrite)}편`, '조언을 읽고 다시 고쳐서 낸 글이에요.', { n: u.rewrite, sub: true }),
      row('쓴 반', `${cnt(u.classes)}곳`, '글이 한 편이라도 나온 반의 수예요.', { n: u.classes }),
      row('쓴 선생님', `${cnt(u.teachers)}명`, '글이 나온 반의 담임 선생님 수예요.', { n: u.teachers }),
      row('쓴 학생', `${cnt(u.students)}명`, '글을 한 편이라도 낸 학생 수예요.', { n: u.students }),
      row('평소 하루 평균', u.lessonAvg == null ? '아직 견줄 날이 모자라요' : `${cnt(u.lessonAvg)}편`, '최근 수업한 7일 동안 하루에 쓴 글 수예요.'),
    ], [list('많이 쓴 반', (u.top || []).map(t => `${t.name} ${cnt(t.n)}편`))]))

  // 빠르고 잘 됐나요
  const segRows = (name, x, info) => [
    row(`${name} 보통`, x && x.n ? secText(x.p50) : null, info, { sub: true }),
    row(`${name} 거의 모두`, x && x.n ? `${secText(x.p95)} 안` : null, info, { sub: true }),
  ]
  const errRows = []
  const errByLabel = new Map()
  for (const [k, n] of Object.entries(s.errors || {})) {
    const [label, info] = ERROR_TYPES[k] || ERROR_OTHER
    const cur = errByLabel.get(label) || { n: 0, info }
    cur.n += Number(n) || 0
    errByLabel.set(label, cur)
  }
  for (const [label, v] of [...errByLabel.entries()].sort((a, b) => b[1].n - a[1].n)) errRows.push(row(label, `${cnt(v.n)}번`, v.info, { sub: true }))
  const hasWait = s.attempts > 0 && s.p95 != null
  out.push(sec('stability', '빠르고 잘 됐나요',
    !hasWait ? `결과를 못 받은 경우는 ${cnt(s.open)}번, 채점 실패는 ${cnt(s.gradeErrors)}번이었어요.`
      : `제출 ${cnt(s.attempts)}번 가운데 거의 모두가 ${secText(s.p95)} 안에 결과를 받았고, 결과를 못 받은 경우는 ${cnt(s.open)}번이었어요.`, [
      head('결과까지 기다린 시간'),
      row('보통', hasWait ? secText(s.p50) : null, '학생 절반은 이 시간 안에 결과를 받았어요.', { sub: true }),
      row('거의 모두', hasWait ? `${secText(s.p95)} 안` : null, '학생 100명 중 95명은 이 시간 안에 결과를 받았어요.', { sub: true, flag: flags.p95 }),
      row('가장 오래', hasWait ? secText(s.max) : null, '가장 오래 기다린 학생이 기다린 시간이에요.', { sub: true }),
      row('1분 넘게 기다린 경우', s.attempts > 0 ? `${cnt(s.attempts)}번 중 ${cnt(s.over60)}번` : null, '제출을 누르고 결과를 받기까지 1분 넘게 걸린 경우예요.', { n: s.over60, flag: flags.over60 }),
      row('결과를 못 받은 경우', `${cnt(s.open)}번`, '제출을 눌렀지만 끝내 점수를 못 본 경우예요.', { n: s.open, flag: flags.open }),
      s.openMaxClass >= 2 ? row('가장 많았던 반', `${cnt(s.openMaxClass)}번`, '결과를 못 받은 경우가 가장 많이 몰린 반에서 일어난 횟수예요.', { sub: true }) : undefined,
      head('어디서 시간이 걸렸나'),
      ...segRows('제출 확인', s.seg && s.seg.precheck, '제출을 누른 뒤 이미 낸 글이 있는지 살펴보는 시간이에요.'),
      ...segRows('AI 채점', s.seg && s.seg.grade, 'AI가 글을 읽고 점수를 매기는 시간이에요.'),
      ...segRows('글 저장', s.seg && s.seg.save, '점수가 나온 뒤 글을 저장하는 시간이에요.'),
      row('AI가 바빠서 나중에 채점한 글', `${cnt(s.deferred)}편`, '구글 AI가 바빠서 글을 먼저 받아 두고 점수는 뒤에 매긴 글이에요.', { n: s.deferred, flag: flags.deferred }),
      row('아직 점수를 기다리는 글', s.pendingNow == null ? null : `${cnt(s.pendingNow)}편`, '글은 받았지만 아직 점수가 나오지 않은 글이에요.', { n: s.pendingNow, flag: flags.stale }),
      s.stalePending > 0 ? row('그중 15분 넘게 기다린 글', `${cnt(s.stalePending)}편`, '점수를 15분 넘게 기다리고 있는 글이에요.', { sub: true, flag: flags.stale }) : undefined,
      s.failedGrades > 0 ? row('끝내 채점하지 못한 글', `${cnt(s.failedGrades)}편`, '여러 번 시도했지만 점수를 매기지 못한 글이에요.', { sub: true, flag: flags.stale }) : undefined,
      row('채점 실패', `${cnt(s.gradeErrors)}번`, 'AI가 채점을 끝내지 못하고 실패한 횟수예요.', { n: s.gradeErrors, flag: flags.gradeErrors }),
      s.gradeErrorsMaxClass >= 2 ? row('가장 많았던 반', `${cnt(s.gradeErrorsMaxClass)}번`, '채점 실패가 가장 많이 몰린 반에서 일어난 횟수예요.', { sub: true, flag: flags.gradeErrors }) : undefined,
      head('오류'),
      ...(errRows.length ? errRows : [row('기록된 오류', '0번', '이 기간에 기록된 오류가 없어요.', { n: 0, sub: true })]),
    ].filter(x => x !== undefined), [list('오류가 몰린 반', (s.clusters || []).map(c => `${c.name} ${cnt(c.n)}번`))]))

  // 답을 기다리는 사람
  const b = w.backlog, d = w.delta
  const deltaNote = (dv) => (!d || !Number.isFinite(dv) ? null : dv > 0 ? `어제보다 ${cnt(dv)}건 늘었어요` : dv < 0 ? `어제보다 ${cnt(-dv)}건 줄었어요` : '어제와 같아요')
  const newStudentFb = w.newFeedbackStudent ?? w.newFeedback
  const backStudentFb = b ? (b.feedbackStudent ?? b.feedback) : null
  out.push(sec('waiting', '답을 기다리는 사람',
    b ? `새로 온 문의는 ${cnt(w.newTotal)}건이고, 답을 기다리는 것은 모두 ${cnt(b.total)}건이에요.` : `새로 온 문의는 ${cnt(w.newTotal)}건이에요.`, [
      head('오늘 새로 온 것'),
      row('모두 합쳐', `${cnt(w.newTotal)}건`, '새로 들어온 선생님 쪽지, 의견, 학생 신고를 합친 수예요.', { n: w.newTotal, sub: true }),
      row('선생님 쪽지', `${cnt(w.newMessages)}건`, '선생님이 관리자에게 보낸 쪽지예요.', { n: w.newMessages, sub: true }),
      row('학생 의견', `${cnt(newStudentFb)}건`, '학생이 의견 보내기로 남긴 글이에요.', { n: newStudentFb, sub: true }),
      row('선생님 의견', w.newFeedbackTeacher == null ? null : `${cnt(w.newFeedbackTeacher)}건`, '선생님이 의견 보내기로 남긴 글이에요.', { n: w.newFeedbackTeacher, sub: true }),
      row('학생 신고', `${cnt(w.newReports)}건`, '학생이 AI 조언이 이상하다고 알린 것이에요.', { n: w.newReports, sub: true }),
      head('쌓여 있는 것'),
      row('모두 합쳐', b ? `${cnt(b.total)}건` : null, '아직 답하지 않은 것을 모두 합친 수예요.', { n: b && b.total, sub: true, note: deltaNote(d && d.total) }),
      row('읽지 않은 선생님 쪽지', b ? `${cnt(b.messages)}건` : null, '선생님이 보낸 쪽지 가운데 아직 열어 보지 않은 것이에요.', { n: b && b.messages, sub: true, note: deltaNote(d && d.messages) }),
      row('답 없는 학생 의견', b ? `${cnt(backStudentFb)}건` : null, '학생이 남긴 의견 가운데 아직 답하지 않은 것이에요.', { n: backStudentFb, sub: true, note: deltaNote(d && d.feedbackStudent) }),
      row('답 없는 선생님 의견', b && b.feedbackTeacher != null ? `${cnt(b.feedbackTeacher)}건` : null, '선생님이 남긴 의견 가운데 아직 답하지 않은 것이에요.', { n: b && b.feedbackTeacher, sub: true, note: deltaNote(d && d.feedbackTeacher) }),
      row('처리 안 한 신고', b ? `${cnt(b.reports)}건` : null, '학생 신고 가운데 아직 처리했다고 표시하지 않은 것이에요.', { n: b && b.reports, sub: true, note: deltaNote(d && d.reports) }),
      row('가장 오래 기다린 것', w.oldest ? `${fullDate(w.oldest.date)}에 온 ${OLDEST_KIND[w.oldest.kind] || modernize(w.oldest.kind)}` : null, '답하지 않은 것 가운데 가장 먼저 들어온 것이에요.', { sub: true }),
    ]))

  // 쓰는 반이 늘고 있나요
  const quiet = g.quiet || []
  out.push(sec('growth', '쓰는 반이 늘고 있나요',
    `새로 온 선생님은 ${cnt(g.newTeachers)}명, 새 반은 ${cnt(g.newClasses)}곳이고 최근 7일 동안 반 ${cnt(g.active7)}곳이 글을 썼어요.`, [
      row('새로 온 선생님', `${cnt(g.newTeachers)}명`, '이 기간에 가입한 선생님 수예요.', { n: g.newTeachers }),
      row('새 반', `${cnt(g.newClasses)}곳`, '이 기간에 새로 만든 반의 수예요.', { n: g.newClasses }),
      row('새 학생', `${cnt(g.newStudents)}명`, '이 기간에 가입한 학생 수예요.', { n: g.newStudents }),
      row('전체 선생님', g.totalTeachers == null ? null : `${cnt(g.totalTeachers)}명`, '지금까지 가입한 선생님 수예요.'),
      row('전체 반', g.totalClasses == null ? null : `${cnt(g.totalClasses)}곳`, '지금까지 만든 반의 수예요.'),
      row('전체 학생', g.totalStudents == null ? null : `${cnt(g.totalStudents)}명`, '지금까지 가입한 학생 수예요.'),
      g.recentTeachers14 > 0 ? row('첫 수업을 한 새 선생님', `${cnt(g.recentTeachers14)}명 중 ${cnt(g.recentTeachersActivated)}명`, '최근 2주 안에 가입한 선생님 가운데 반에서 글이 한 편이라도 나온 선생님이에요.') : undefined,
      row('최근 7일 동안 쓴 반', `${cnt(g.active7)}곳`, '최근 7일 안에 글이 한 편이라도 나온 반이에요.', { n: g.active7 }),
      row('2주 넘게 쉬는 반', `${cnt(g.quietCount)}곳`, '전에는 글을 썼는데 2주 넘게 새 글이 없는 반이에요.', { n: g.quietCount }),
      row('다시 쓰기 시작한 반', `${cnt((g.returned || []).length)}곳`, '2주 넘게 쉬다가 다시 글을 쓴 반이에요.', { n: (g.returned || []).length }),
      row('처음 써 본 반', `${cnt((g.firstEver || []).length)}곳`, '이 기간에 처음으로 글을 쓴 반이에요.', { n: (g.firstEver || []).length }),
    ].filter(x => x !== undefined), [
      list('다시 쓰기 시작한 반', (g.returned || []).map(x => `${x.name} · ${cnt(x.gapDays)}일 만에 다시 썼어요`)),
      list('처음 써 본 반', (g.firstEver || []).map(x => x.name)),
      list(g.quietCount > quiet.length ? `2주 넘게 쉬는 반 (${cnt(g.quietCount)}곳 중 최근에 멈춘 ${cnt(quiet.length)}곳)` : '2주 넘게 쉬는 반',
        quiet.map(x => `${x.name} · 마지막 글 ${fullDate(x.last)} · 지금까지 ${cnt(x.total)}편`), true),
    ]))

  // 아이들 글이 나아졌나요
  out.push(sec('effect', '아이들 글이 나아졌나요',
    e.compared > 0 ? `고쳐 낸 글 ${cnt(e.compared)}편 가운데 ${pctOf(e.up, e.compared)}%가 앞 글보다 점수가 올랐어요.`
      : e.firstAvgPct != null ? `처음 낸 글의 평균은 ${e.firstAvgPct}점이에요.` : '이 기간에는 점수가 나온 글이 없었어요.', [
      row('처음 낸 글 평균', e.firstAvgPct == null ? null : `${e.firstAvgPct}점`, '처음 낸 글의 점수를 100점 만점으로 맞춰 평균 낸 값이에요.'),
      row('고쳐 쓴 학생', e.students > 0 ? `${cnt(e.students)}명 중 ${cnt(e.rewriteStudents)}명` : null, '글을 쓴 학생 가운데 한 번이라도 고쳐서 다시 낸 학생이에요.', { n: e.rewriteStudents }),
      head('고친 뒤 점수'),
      row('올랐어요', e.compared > 0 ? `${pctOf(e.up, e.compared)}%` : null, '고쳐 쓴 글의 점수가 앞 글보다 올랐는지 본 거예요.', { sub: true }),
      row('그대로예요', e.compared > 0 ? `${pctOf(e.same, e.compared)}%` : null, '고쳐 쓴 글의 점수가 앞 글과 같은 경우예요.', { sub: true, n: e.same }),
      row('내려갔어요', e.compared > 0 ? `${pctOf(e.down, e.compared)}%` : null, '고쳐 쓴 글의 점수가 앞 글보다 낮아진 경우예요.', { sub: true, n: e.down }),
    ]))

  // 어떤 기능을 썼나요
  out.push(sec('features', '어떤 기능을 썼나요',
    `우리 반 글 모음을 ${cnt(f.peerViews)}번 열어 봤고, 챗봇은 학생 ${cnt(f.tutorUsers)}명이 썼어요.`, [
      head('우리 반 글 모음'),
      row('켠 반', f.peerOn == null ? null : `${cnt(f.peerOn)}곳`, '친구들 글을 함께 보는 기능을 켜 둔 반이에요.', { sub: true, n: f.peerOn }),
      row('열어 본 횟수', `${cnt(f.peerViews)}번`, '학생들이 글 모음을 열어 본 횟수예요.', { sub: true, n: f.peerViews, note: f.peerViews > 0 ? `반 ${cnt(f.peerViewClasses)}곳에서 열어 봤어요` : null }),
      head('전국 챌린지'),
      row('참여한 반', `${cnt(f.challengeClasses)}곳`, '전국 주제로 글을 쓴 반이에요.', { sub: true, n: f.challengeClasses }),
      row('쓴 글', `${cnt(f.challengeSubs)}편`, '전국 주제로 쓴 글 수예요.', { sub: true, n: f.challengeSubs }),
      row('상위 글 열어 본 횟수', `${cnt(f.showcaseViews)}번`, '전국에서 잘 쓴 글을 학생들이 열어 본 횟수예요.', { sub: true, n: f.showcaseViews }),
      row('주제 자동 받기를 켠 반', f.autoSupplyOn == null ? null : `${cnt(f.autoSupplyOn)}곳`, '전국 주제가 나오면 저절로 받도록 켜 둔 반이에요.', { n: f.autoSupplyOn }),
      row('맞춤법 퀴즈', '아직 세지 않아요', '퀴즈를 푼 횟수는 아직 기록하지 않아요.', { n: 0 }),
      head('챗봇'),
      row('쓴 학생', `${cnt(f.tutorUsers)}명`, '보고 날짜 하루 동안 챗봇에게 물어본 학생 수예요.', { sub: true, n: f.tutorUsers }),
      row('질문', `${cnt(f.tutorCount)}번`, '보고 날짜 하루 동안 챗봇에게 물어본 횟수예요.', { sub: true, n: f.tutorCount }),
      row('예시 작품 만든 수', `${cnt(f.examples)}편`, 'AI가 본보기 글을 만들어 준 글의 수예요.', { n: f.examples }),
    ]))

  // AI 채점에 이상은 없었나요
  const tagRows = Object.entries(q.reportTags || {}).sort((a, b2) => b2[1] - a[1]).map(([k, n]) => row(k, `${cnt(n)}건`, '학생이 신고하면서 고른 까닭이에요.', { sub: true }))
  out.push(sec('quality', 'AI 채점에 이상은 없었나요',
    `학생 신고 ${cnt(q.reports)}건, 맞춤법 교정이 의심스러운 글 ${cnt(q.alertsNew)}건, AI가 평가를 거절한 글 ${cnt(q.safety)}편이에요.`, [
      row('학생 신고', `${cnt(q.reports)}건`, '학생이 AI 조언이 이상하다고 알린 횟수예요.', { n: q.reports }),
      ...tagRows,
      row('맞춤법 교정이 의심스러운 글', `${cnt(q.alertsNew)}건`, 'AI가 맞춤법을 잘못 고친 것 같다고 자동으로 표시된 글이에요.', { n: q.alertsNew }),
      row('AI가 평가를 거절한 글', `${cnt(q.safety)}편`, 'AI가 글을 평가하지 않겠다고 해서 점수 없이 저장된 글이에요.', { n: q.safety }),
    ]))

  // 한도까지 여유
  const mb = (v) => `${cnt(Math.round(v / 1024 / 1024))}MB`
  const top = r.callsTop
  out.push(sec('resources', '한도까지 여유',
    top ? `구글 AI를 가장 많이 쓴 반이 하루 한도의 ${top.pct}%를 쓴 것으로 어림돼요.` : '이 기간에는 구글 AI를 쓴 기록이 없어요.', [
      head('구글 AI를 가장 많이 쓴 반(추정)'),
      row('반 이름', top ? top.name : null, '하루 동안 구글 AI를 가장 많이 쓴 것으로 어림되는 반이에요.', { sub: true }),
      row('쓴 횟수', top ? `약 ${cnt(top.calls)}번` : null, '반마다 하루에 쓸 수 있는 횟수가 정해져 있어요. 가장 많이 쓴 반이 얼마나 썼는지 어림한 값이에요.', { sub: true, flag: flags.calls, note: top ? `하루 한도 ${cnt(r.callsLimit)}번의 ${top.pct}%` : null }),
      row('저장 공간', r.dbBytes == null ? null : mb(r.dbBytes), '지금까지 쌓인 자료의 크기예요. 한도 500MB는 추정이에요.', { note: r.dbBytes == null ? null : `한도 ${mb(r.dbLimitBytes)}의 ${Math.round(r.dbPct)}%` }),
      row('쌓인 글 수', r.subsRows == null ? null : `${cnt(r.subsRows)}편`, '지금까지 학생들이 낸 글을 모두 센 수예요. 휴지통에 있는 글도 들어 있어요.'),
    ]))

  // 이번 주 정리(금요일)
  if (m.weekly) {
    const wk = m.weekly
    out.push(sec('weekly', '이번 주 정리',
      `이번 주에 글 ${cnt(wk.total)}편을 썼어요. 지난주는 ${cnt(wk.lastTotal)}편이었어요.`, [
        row('이번 주에 쓴 글', `${cnt(wk.total)}편`, '월요일 보고부터 금요일 보고까지 쓴 글을 합친 수예요.', { n: wk.total }),
        row('지난주에 쓴 글', `${cnt(wk.lastTotal)}편`, '지난주 월요일 보고부터 금요일 보고까지 쓴 글을 합친 수예요.', { n: wk.lastTotal }),
        head('요일마다 쓴 글'),
        ...(wk.days || []).map(x => row(`${WD_NAMES[weekdayOf(x.date)]}요일`, `${cnt(x.n)}편`, '그날 보고에 들어간 글 수예요. 전날 오후 3시 뒤에 낸 글은 다음 날에 들어가요.', { sub: true, n: x.n })),
      ], [list('새로 생긴 일', (wk.news || []).map(modernize))]))
  }
  return out
}

// 화면에 나가는 글자를 한데 모은다(게이트가 영어·개발 용어가 없는지 볼 때 쓴다)
export function allDisplayText(m) {
  const parts = [...displayLines(m), ...judgeFromMetrics(m).reasons.map(x => x.text)]
  for (const h of headlineOf(m)) parts.push(h.label, h.value, h.info)
  for (const sc of sectionsOf(m)) {
    parts.push(sc.title, sc.summary)
    for (const x of sc.rows) parts.push(x.heading || '', x.label || '', x.value || '', x.info || '', x.note || '')
    for (const l of sc.lists) parts.push(l.title, ...l.items)
  }
  return parts.filter(Boolean)
}
export { mdOf }
