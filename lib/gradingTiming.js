// step643: 채점 대기 시간 실측 — 순수 함수(클라이언트 경로 판정 + 관리자 집계). 네트워크·DB 없음.
//   게이트: scripts/gate-grading-timing.js

export const OVER_MS = 60000   // "60초 초과" 기준

/**
 * 제출 행에 적을 경로 한 값. 우선순위: error_then_retry > congestion > fallback > retry_N > pending > inline
 * @param {{ failedBefore?: boolean, congestion?: boolean|string, isFallback?: boolean, attempts?: number, strictStatus?: string }} p
 *   failedBefore: 같은 주제·같은 attempt에서 직전 시도가 실패(오류 모달)한 뒤 다시 눌러 성공
 *   congestion  : step663 서버 혼잡 전환 표식(result.__congestion: 'busy503'|'rate429'|'timeout') — 구글 혼잡으로 다른 AI가 채점
 *   isFallback  : 보조 모델로 채점됨(is_fallback_graded와 같은 판정)
 *   attempts    : 서버 총 시도 수(result.__attempts, 모델 전환 포함). 2 이상이면 retry_(attempts-1)
 *   strictStatus: result.__strictStatus ('pending'이면 피크로 전용 검사 보류)
 */
export function deriveGradingPath({ failedBefore, congestion, isFallback, attempts, strictStatus } = {}) {
  if (failedBefore) return 'error_then_retry'
  if (congestion) return 'congestion'
  if (isFallback) return 'fallback'
  const a = Number(attempts)
  if (Number.isFinite(a) && a >= 2) return `retry_${Math.floor(a) - 1}`
  if (strictStatus === 'pending') return 'pending'
  return 'inline'
}

// 경로 → 분포 묶음 키(retry_1·retry_2… → 'retry')
export function pathFamily(path) {
  if (!path) return 'unknown'
  if (String(path).startsWith('retry_')) return 'retry'
  return String(path)
}

// nearest-rank 퍼센타일. sorted는 오름차순 숫자 배열.
export function percentile(sorted, p) {
  if (!sorted || sorted.length === 0) return null
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.min(idx, sorted.length - 1)]
}

export function kstDay(iso) {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return 'unknown'
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

function stat(values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b)
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length ? sorted[sorted.length - 1] : null,
    over60: sorted.filter(v => v > OVER_MS).length,
  }
}

/**
 * 관리자 집계. rows: [{ ms, path, at(ISO), classId }]
 * @returns {{ total, byDay: [{key,...stat}](최신순), byClass: [{key,...stat}](건수 내림차순), paths: {family: n} }}
 */
export function summarizeTimings(rows) {
  const list = (rows || []).filter(r => r && Number.isFinite(Number(r.ms))).map(r => ({ ...r, ms: Number(r.ms) }))
  const dayMap = new Map(), classMap = new Map(), paths = {}
  for (const r of list) {
    const d = kstDay(r.at)
    if (!dayMap.has(d)) dayMap.set(d, [])
    dayMap.get(d).push(r.ms)
    const c = r.classId || 'unknown'
    if (!classMap.has(c)) classMap.set(c, [])
    classMap.get(c).push(r.ms)
    const f = pathFamily(r.path)
    paths[f] = (paths[f] || 0) + 1
  }
  const byDay = [...dayMap.entries()].map(([key, v]) => ({ key, ...stat(v) })).sort((a, b) => (a.key < b.key ? 1 : -1))
  const byClass = [...classMap.entries()].map(([key, v]) => ({ key, ...stat(v) })).sort((a, b) => b.n - a.n)
  return { total: stat(list.map(r => r.ms)), byDay, byClass, paths }
}

export function fmtSec(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '-'
  return (Number(ms) / 1000).toFixed(1) + 's'
}

// step654: 한글 초 표기("5.6초"). 60초 이상은 "1분 12초"처럼.
export function fmtSecKo(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '-'
  const sec = Number(ms) / 1000
  if (sec >= 60) { const m = Math.floor(sec / 60); const r = Math.round(sec - m * 60); return r > 0 ? `${m}분 ${r}초` : `${m}분` }
  return sec.toFixed(1) + '초'
}

// step654: 머리 한 줄 문장(전문 용어 없이). total = stat 결과.
export function headlineOf(total, { days = 14 } = {}) {
  if (!total || !total.n) return '아직 측정값이 없어요'
  return `최근 ${days}일 ${total.n}편 · 보통 ${fmtSecKo(total.p50)} · 거의 모든 글(95%)이 ${fmtSecKo(total.p95)} 안 · 가장 오래 ${fmtSecKo(total.max)} · 1분 넘은 글 ${total.over60}건`
}

// step654: 표 아래 한 줄 해석. over60>0이면 경고(구글 혼잡 가능성 → 오류 탭 503 확인), 아니면 안심.
export function interpretTimings(total) {
  if (!total || !total.n) return { tone: 'none', text: '' }
  if (total.over60 > 0) return { tone: 'warn', text: `⚠ 1분 넘은 글 ${total.over60}건이 있어요. 구글 혼잡일 가능성이 커요. 오류 탭에서 503을 확인해 주세요.` }
  return { tone: 'ok', text: '느리지 않았어요. 1분 넘은 글이 없어요.' }
}

// ─────────────────────────────────────────────────────────────────────────────
// step666: "제출 시작" 기준 대기 측정 — grading_attempts 집계(순수). 네트워크·DB 없음.
//   배경: grading_ms는 결과를 받은 시도만 재서 실패·포기한 시도가 어디에도 남지 않았다(11/10 한 반 미제출 10명이 칩에 0건).
//   행 1개 = 학생이 [제출]을 처음 누른 순간부터의 한 시도. 다시 누르면(30분 안) 같은 행의 tries만 늘어난다.
//   finishedAt이 없으면 "결과 못 받은 시도". 원인은 행에 쓰지 않고 서버 오류 로그와 맞춰서 붙인다(attachCauses).
// ─────────────────────────────────────────────────────────────────────────────
export const ATTEMPT_JOIN_MS = 30 * 60 * 1000   // 미완료 행에 다음 누름을 이어 붙이는 범위(승인값 30분)
export const ATTEMPT_FRESH_MS = 2 * 60 * 1000   // 마지막 누름이 이보다 최근인 미완료 행은 "진행 중"으로 보고 집계에서 뺀다
export const ATTEMPT_LONG_MS = 10 * 60 * 1000   // "10분 넘음" 기준
const CAUSE_BEFORE_MS = 5 * 1000                // 원인 매칭 창: 첫 누름 5초 전 ~
const CAUSE_AFTER_MS = 2 * 60 * 1000            //               마지막 누름 2분 뒤

// 서버 오류 로그 1건 → 원인. log: { status, quota, timeout, message }
export function causeOfLog(log) {
  if (!log) return 'unknown'
  const st = Number(log.status)
  const m = String(log.message || '')
  if (st === 503 || /\b503\b|overloaded|high demand|UNAVAILABLE/i.test(m)) return 'busy503'
  if (st === 429 || log.quota || /\b429\b|quota|RESOURCE_EXHAUSTED/i.test(m)) return 'limit'
  if (log.timeout || /TIMEOUT/i.test(m)) return 'timeout'
  return 'unknown'
}

/**
 * 미완료 행에 원인을 붙인다. 같은 학생의 서버 오류 중 [첫 누름 5초 전, 마지막 누름 2분 뒤] 안의 마지막 1건으로 판정.
 * @param rows [{ userId, startedAt, lastTryAt, finishedAt, ... }]
 * @param logs [{ userId, at, status, quota, timeout, message }]
 * @returns 같은 행 + cause('busy503'|'limit'|'timeout'|'unknown', 완료 행은 null)
 */
export function attachCauses(rows, logs) {
  const byUser = new Map()
  for (const l of logs || []) {
    if (!l || !l.userId) continue
    const t = new Date(l.at).getTime()
    if (!Number.isFinite(t)) continue
    if (!byUser.has(l.userId)) byUser.set(l.userId, [])
    byUser.get(l.userId).push({ ...l, t })
  }
  for (const list of byUser.values()) list.sort((a, b) => a.t - b.t)
  return (rows || []).map(r => {
    if (!r || r.finishedAt) return { ...r, cause: null }
    const from = new Date(r.startedAt).getTime() - CAUSE_BEFORE_MS
    const to = new Date(r.lastTryAt || r.startedAt).getTime() + CAUSE_AFTER_MS
    const hits = (byUser.get(r.userId) || []).filter(l => l.t >= from && l.t <= to)
    return { ...r, cause: hits.length ? causeOfLog(hits[hits.length - 1]) : 'unknown' }
  })
}

function attemptStat(list) {
  const done = list.filter(r => r.finishedAt && Number.isFinite(Number(r.waitMs)))
  const open = list.filter(r => !r.finishedAt)
  const waits = done.map(r => Number(r.waitMs)).sort((a, b) => a - b)
  const tries = list.map(r => Math.max(1, Number(r.tries) || 1)).sort((a, b) => a - b)
  const span = (r) => new Date(r.lastTryAt || r.startedAt).getTime() - new Date(r.startedAt).getTime()
  return {
    n: list.length,
    done: done.length,
    p50: percentile(waits, 50),
    p95: percentile(waits, 95),
    max: waits.length ? waits[waits.length - 1] : null,
    unfinished: open.length,
    over10: done.filter(r => Number(r.waitMs) > ATTEMPT_LONG_MS).length + open.filter(r => span(r) > ATTEMPT_LONG_MS).length,
    triesP50: percentile(tries, 50),
    triesMax: tries.length ? tries[tries.length - 1] : null,
  }
}

/**
 * 관리자 집계. rows: [{ classId, startedAt, lastTryAt, finishedAt, waitMs, tries, cause }]
 *   진행 중(미완료 + 마지막 누름이 2분 안)은 뺀다(inProgress로만 센다).
 * @returns {{ total, byDay(최신순), byClass(시도 수 내림차순), causes:{busy503,limit,timeout,unknown}, inProgress }}
 */
export function summarizeAttempts(rows, nowMs = Date.now()) {
  const valid = (rows || []).filter(r => r && Number.isFinite(new Date(r.startedAt).getTime()))
  const isFresh = (r) => !r.finishedAt && nowMs - new Date(r.lastTryAt || r.startedAt).getTime() < ATTEMPT_FRESH_MS
  const list = valid.filter(r => !isFresh(r))
  const dayMap = new Map(), classMap = new Map()
  const causes = { busy503: 0, limit: 0, timeout: 0, unknown: 0 }
  for (const r of list) {
    const d = kstDay(r.startedAt)
    if (!dayMap.has(d)) dayMap.set(d, [])
    dayMap.get(d).push(r)
    const c = r.classId || 'unknown'
    if (!classMap.has(c)) classMap.set(c, [])
    classMap.get(c).push(r)
    if (!r.finishedAt) causes[Object.prototype.hasOwnProperty.call(causes, r.cause) ? r.cause : 'unknown']++
  }
  return {
    total: attemptStat(list),
    byDay: [...dayMap.entries()].map(([key, v]) => ({ key, ...attemptStat(v) })).sort((a, b) => (a.key < b.key ? 1 : -1)),
    byClass: [...classMap.entries()].map(([key, v]) => ({ key, ...attemptStat(v) })).sort((a, b) => b.n - a.n),
    causes,
    inProgress: valid.length - list.length,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// step668: 구간별 시간 — 쓰로틀 대기(queue)·맞춤법 전용 검사(strict)·채점 호출(grade)·그 밖(other).
//   배경(11/10 분석): 혼잡 오류 없는 날에도 약 10%가 15초를 넘는데 호출 횟수·글 길이·동시 제출로 설명되지 않았다.
//   그 밖 = 처음 누른 뒤 결과까지(waitMs) − 세 구간 합. 네트워크·서버 함수 기동·제출 전 조회·서버 안 DB 조회가 들어간다.
//   한 번만 눌러 결과를 받은 시도만 본다(다시 누른 시도는 실패한 앞 요청 시간이 '그 밖'에 섞인다).
// ─────────────────────────────────────────────────────────────────────────────
export const SEGMENT_SLOW_MS = 15000        // "15초 넘음" 기준
export const SEGMENT_MAX_MS = 600000        // 저장 허용 상한(10분)
export const SEGMENT_KEYS = ['queue', 'strict', 'grade', 'other']

// 서버 응답 __timing → grading_attempts 컬럼. 0~10분 범위의 유한한 숫자만 통과(나머지는 그 칸을 뺀다).
export function segmentFields(timing) {
  const out = {}
  if (!timing || typeof timing !== 'object') return out
  const put = (col, v) => {
    if (v === null || v === undefined || v === '') return
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0 && n <= SEGMENT_MAX_MS) out[col] = Math.round(n)
  }
  put('queue_ms', timing.queueMs); put('strict_ms', timing.strictMs); put('grade_ms', timing.gradeMs); put('server_ms', timing.serverMs)
  return out
}

/**
 * rows: [{ finishedAt, waitMs, tries, queueMs, strictMs, gradeMs, serverMs }]
 * @returns {{ measured, multiPress, seg:{queue,strict,grade,other:{p50,p95}}, slow:{ n, dominant:{queue,strict,grade,other} } }}
 *   measured  : 한 번 눌러 결과를 받았고 채점 구간 값이 있는 시도 수
 *   multiPress: 구간 값은 있지만 여러 번 눌러서 제외한 시도 수
 */
export function summarizeSegments(rows) {
  const has = (r) => r && r.finishedAt && Number.isFinite(Number(r.waitMs)) && r.gradeMs !== null && r.gradeMs !== undefined && Number.isFinite(Number(r.gradeMs))
  const all = (rows || []).filter(has)
  const list = all.filter(r => (Number(r.tries) || 1) <= 1).map(r => {
    const queue = Math.max(0, Number(r.queueMs) || 0), strict = Math.max(0, Number(r.strictMs) || 0), grade = Math.max(0, Number(r.gradeMs) || 0)
    return { wait: Number(r.waitMs), queue, strict, grade, other: Math.max(0, Number(r.waitMs) - queue - strict - grade) }
  })
  const seg = {}
  for (const k of SEGMENT_KEYS) { const v = list.map(r => r[k]).sort((a, b) => a - b); seg[k] = { p50: percentile(v, 50), p95: percentile(v, 95) } }
  const slowRows = list.filter(r => r.wait > SEGMENT_SLOW_MS)
  const dominant = { queue: 0, strict: 0, grade: 0, other: 0 }
  for (const r of slowRows) { let top = 'grade'; for (const k of SEGMENT_KEYS) if (r[k] > r[top]) top = k; dominant[top]++ }
  return { measured: list.length, multiPress: all.length - list.length, seg, slow: { n: slowRows.length, dominant } }
}

// 구간 표 아래 한 줄. 센 숫자만.
export function segmentsVerdict(s) {
  if (!s || !s.measured) return ''
  if (!s.slow.n) return '15초 넘은 시도가 없어요.'
  const d = s.slow.dominant
  return `15초 넘은 시도 ${s.slow.n}건: 가장 오래 걸린 구간이 채점 호출 ${d.grade}건·쓰로틀 대기 ${d.queue}건·맞춤법 검사 ${d.strict}건·그 밖 ${d.other}건`
}

// 머리 한 줄. total = attemptStat 결과.
export function attemptsHeadline(total, { days = 14 } = {}) {
  if (!total || !total.n) return '아직 기록이 없어요'
  return `최근 ${days}일 ${total.n}번 시도 · 보통 ${fmtSecKo(total.p50)} · 거의 모두(95%) ${fmtSecKo(total.p95)} 안 · 가장 오래 ${fmtSecKo(total.max)} · 결과 못 받음 ${total.unfinished}건 · 10분 넘음 ${total.over10}건`
}

// 표 아래 한 줄. 추측 없이 센 숫자만. 시간 초과는 있을 때만 적는다.
export function attemptsVerdict(summary) {
  const t = summary && summary.total
  if (!t || !t.n) return { tone: 'none', text: '' }
  if (!t.unfinished) return { tone: 'ok', text: '결과 못 받은 시도가 없어요.' }
  const c = summary.causes || {}
  const parts = [`503 ${c.busy503 || 0}건`, `한도 초과 ${c.limit || 0}건`]
  if (c.timeout) parts.push(`시간 초과 ${c.timeout}건`)
  parts.push(`원인 불명 ${c.unknown || 0}건`)
  return { tone: 'warn', text: `결과 못 받은 시도 ${t.unfinished}건, 그중 ${parts.join('·')}` }
}
